// Coach creates a stub Traveler record for a new client, then sends a welcome
// email inviting them to complete their account via the standard login flow.
//
// - If a Traveler already exists for the email, we DO NOT overwrite anything
//   and DO NOT send an email — we just return the existing record so the coach
//   can add them to their client list.
// - Also stamps the Coach linked-record field on the new Traveler so the
//   persistent Coach ↔ Traveler relationship is established from day one.
//
// Usage: POST /api/coach-add-client { name, email, coachEmail }

const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const TRAVELER_TBL  = 'Traveler';

function airtable(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(TRAVELER_TBL)}${path}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + process.env.AIRTABLE_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }); }
        catch(e) { reject(new Error('parse: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function sendWelcomeEmail({ email, name, coachName }) {
  const loginUrl = 'https://app.transformedbytravels.com/login.html?email=' + encodeURIComponent(email);
  const from     = coachName || 'your travel coach';
  const html = `
    <div style="max-width:640px;margin:0 auto;font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="background:#fff;border-radius:12px;padding:32px 34px;">
        <h1 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 8px;">Welcome to Transformed by Travels</h1>
        <p style="font-size:15px;color:#0f172a;line-height:1.7;margin:0 0 16px;">
          Hi ${escapeHtml(name.split(' ')[0] || name)},
        </p>
        <p style="font-size:15px;color:#0f172a;line-height:1.7;margin:0 0 16px;">
          ${escapeHtml(from)} is planning a trip for you and has created an account on your behalf. Complete your setup and you'll be able to follow the plan, save notes, and log sightings from your phone.
        </p>
        <div style="margin:24px 0;text-align:center;">
          <a href="${loginUrl}" style="display:inline-block;background:#2dd4bf;color:#0a1628;text-decoration:none;font-family:Arial,sans-serif;font-weight:800;font-size:15px;padding:14px 32px;border-radius:8px;">Complete My Account →</a>
        </div>
        <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0;">
          If the button doesn't work, paste this into your browser:<br>
          <a href="${loginUrl}" style="color:#2dd4bf;word-break:break-all;">${loginUrl}</a>
        </p>
      </div>
    </div>
  `;
  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'ThreeRealms@transformedbytravels.com',
      to:      email,
      subject: `${from} is planning a trip for you`,
      html,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Resend error ' + resp.status);
  return data;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = req.body || {};
  const email      = String(b.email      || '').toLowerCase().trim();
  const name       = String(b.name       || '').trim();
  const coachEmail = String(b.coachEmail || '').toLowerCase().trim();
  if (!email || !name) return res.status(400).json({ error: 'name and email required' });

  try {
    // 1. Check for existing Traveler by email
    const filter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${email}"`)}&maxRecords=1`;
    const found  = await airtable('GET', filter);
    if (found.body.error) return res.status(500).json({ error: found.body.error.message || JSON.stringify(found.body.error) });

    const existingRec = (found.body.records || [])[0];
    if (existingRec) {
      // If Coach Email isn't set on the existing record, set it now — this is
      // the field the Coach dashboard filters by (along with Coach Pairing Status).
      const currentCoachEmail = (existingRec.fields['Coach Email'] || '').toLowerCase();
      if (!currentCoachEmail && coachEmail) {
        try {
          await airtable('PATCH', '/' + existingRec.id, {
            fields: {
              'Coach Email':          coachEmail,
              'Coach Pairing Status': 'Linked',
            },
            typecast: true,
          });
        } catch(e) { console.warn('[coach-add-client] set Coach Email failed:', e); }
      }
      return res.status(200).json({ ok: true, wasExisting: true, record: existingRec });
    }

    // 2. Create a stub Traveler
    const today = new Date().toISOString().split('T')[0];
    const fields = {
      'Traveler Email':       email,
      'Traveler Name':        name,
      'DNA Guides To Date':   0,
      'DNA Guides Remaining': 5,
      'Package Status':       'Free',
      'Created Date':         today,
      'Has Auth Account':     false,
    };
    if (coachEmail) {
      // Fields the Coach dashboard queries for the client roster
      fields['Coach Email']          = coachEmail;
      fields['Coach Pairing Status'] = 'Linked';
    }

    const created = await airtable('POST', '', { fields, typecast: true });
    if (created.body.error) return res.status(500).json({ error: created.body.error.message || JSON.stringify(created.body.error) });

    // 3. Send welcome email (best-effort; don't fail if email fails)
    try {
      // Look up the coach's name for a warmer greeting
      let coachName = '';
      if (coachEmail) {
        const coachFilter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${coachEmail}"`)}&maxRecords=1`;
        const coachData   = await airtable('GET', coachFilter);
        const coachRec    = (coachData.body.records || [])[0];
        if (coachRec) coachName = coachRec.fields['Traveler Name'] || '';
      }
      await sendWelcomeEmail({ email, name, coachName });
    } catch(e) { console.error('[coach-add-client] welcome email failed:', e); }

    return res.status(200).json({ ok: true, wasExisting: false, record: created.body });
  } catch(e) {
    console.error('[coach-add-client] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
