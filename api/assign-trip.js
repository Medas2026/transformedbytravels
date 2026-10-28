// Assign a coach-owned draft trip to a customer.
// - Updates the Trip's Traveler Email
// - Auto-adds the customer's Partner as Co-traveler (if Traveler has Partner set)
// - Sends the customer a notification email
//
// Usage: POST /api/assign-trip { tripId, newEmail, coachEmail }

const https = require('https');
const BASE_ID = 'appdlxcWb45dIqNK2';

function airtable(table, method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`,
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

async function sendAssignmentEmail({ toEmail, toName, coachName, tripName, tripId }) {
  const tripUrl = 'https://app.transformedbytravels.com/portal.html?page=planning&tripId=' + encodeURIComponent(tripId);
  const html = `
    <div style="max-width:640px;margin:0 auto;font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="background:#fff;border-radius:12px;padding:32px 34px;">
        <h1 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 8px;">${escapeHtml(coachName)} designed a trip for you</h1>
        <p style="font-size:15px;color:#0f172a;line-height:1.7;margin:0 0 14px;">Hi ${escapeHtml((toName || '').split(' ')[0] || toName || 'traveler')},</p>
        <p style="font-size:15px;color:#0f172a;line-height:1.7;margin:0 0 14px;">
          ${escapeHtml(coachName)} has designed <strong>${escapeHtml(tripName)}</strong> for you and moved it to your account. Take a look and let ${escapeHtml(coachName.split(' ')[0])} know what you think.
        </p>
        <div style="margin:24px 0;text-align:center;">
          <a href="${tripUrl}" style="display:inline-block;background:#2dd4bf;color:#0a1628;text-decoration:none;font-family:Arial,sans-serif;font-weight:800;font-size:15px;padding:14px 32px;border-radius:8px;">See My Trip →</a>
        </div>
        <p style="font-size:13px;color:#64748b;line-height:1.6;margin:0;">
          If the button doesn't work, paste this into your browser:<br>
          <a href="${tripUrl}" style="color:#2dd4bf;word-break:break-all;">${tripUrl}</a>
        </p>
      </div>
    </div>`;
  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from:    'ThreeRealms@transformedbytravels.com',
      to:      toEmail,
      subject: `${coachName} designed a trip for you: ${tripName}`,
      html,
      reply_to: undefined,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Resend error ' + resp.status);
  return data;
}

// The coach's other Active/Committed trips (via their linked customers).
async function getCoachActiveTrips(coachEmail, excludeTripId) {
  if (!coachEmail) return [];
  const t = await airtable('Traveler', 'GET',
    `?filterByFormula=${encodeURIComponent(`LOWER({Coach Email})="${coachEmail}"`)}&fields[]=Traveler%20Email`);
  const emails = [...new Set((t.body.records || []).map(r => (r.fields['Traveler Email'] || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];
  const orEmails = emails.map(e => `LOWER({Traveler Email})="${e.replace(/"/g, '')}"`).join(',');
  const formula  = `AND(OR(${orEmails}),OR({Status of Trip}="Active",{Status of Trip}="Committed"))`;
  const tr = await airtable('Trips', 'GET', `?filterByFormula=${encodeURIComponent(formula)}`);
  return (tr.body.records || [])
    .filter(r => r.id !== excludeTripId)
    .map(r => ({
      name:     r.fields['Trip Name'] || r.fields['Destination'] || 'Trip',
      dest:     r.fields['Destination'] || '',
      traveler: r.fields['Traveler Email'] || '',
      status:   r.fields['Status of Trip'] || '',
    }));
}

async function sendCoachAssignmentEmail({ coachEmail, coachName, custName, tripName, tripId, startDate, endDate, otherTrips }) {
  const dash  = 'https://app.transformedbytravels.com/portal.html?page=planner';
  const dates = [startDate, endDate].filter(Boolean).join(' – ');
  const others = (otherTrips || []).length
    ? `<p style="font-size:14px;color:#0f172a;font-weight:bold;margin:22px 0 8px;">Your other active trips (${otherTrips.length}):</p>
       <ul style="font-size:14px;color:#334155;line-height:1.7;margin:0;padding-left:18px;">
       ${otherTrips.map(t => `<li><strong>${escapeHtml(t.name)}</strong>${t.dest ? ' — ' + escapeHtml(t.dest) : ''}${t.traveler ? ` <span style="color:#94a3b8;">· ${escapeHtml(t.traveler)}</span>` : ''}${t.status ? ` <span style="color:#94a3b8;">(${escapeHtml(t.status)})</span>` : ''}</li>`).join('')}
       </ul>`
    : `<p style="font-size:13px;color:#94a3b8;margin:22px 0 0;">This is your only active trip right now.</p>`;
  const html = `
    <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="background:#0d1520;padding:20px 32px;border-bottom:3px solid #2dd4bf;">
          <img src="https://threerealmstravel.com/threerealms/realm-symbols/logo.png" height="44" alt="Three Realms Travel" style="display:block;margin:0 0 10px;" />
          <p style="font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0;">Three Realms Travel · Coach</p>
        </div>
        <div style="padding:28px 32px;">
          <h1 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 12px;">New trip created</h1>
          <p style="font-size:15px;color:#0f172a;line-height:1.7;margin:0;">Hi ${escapeHtml((coachName || 'Coach').split(' ')[0])}, you've set up <strong>${escapeHtml(tripName)}</strong> for <strong>${escapeHtml(custName)}</strong>${dates ? ` (${escapeHtml(dates)})` : ''}. Their startup email is on its way.</p>
          ${others}
          <div style="text-align:center;margin:26px 0 4px;">
            <a href="${dash}" style="display:inline-block;background:#2dd4bf;color:#0a1628;text-decoration:none;font-weight:800;font-size:15px;padding:13px 32px;border-radius:8px;">Open Your Coaching Dashboard →</a>
          </div>
        </div>
      </div>
    </div>`;
  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: 'ThreeRealms@transformedbytravels.com', to: coachEmail, subject: `New trip created for ${custName}: ${tripName}`, html }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Resend error ' + resp.status);
  return data;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = req.body || {};
  const tripId     = String(b.tripId     || '').trim();
  const newEmail   = String(b.newEmail   || '').toLowerCase().trim();
  const coachEmail = String(b.coachEmail || '').toLowerCase().trim();
  if (!tripId || !newEmail) return res.status(400).json({ error: 'tripId and newEmail required' });

  try {
    // 1. Look up the customer's Traveler record for name + Partner
    const custFilter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${newEmail}"`)}&maxRecords=1`;
    const custData   = await airtable('Traveler', 'GET', custFilter);
    const custRec    = (custData.body.records || [])[0];
    if (!custRec) return res.status(404).json({ error: 'Customer not found — create them as a client first' });
    const custName   = custRec.fields['Traveler Name'] || newEmail;

    // 2. Look up coach's name for the email
    let coachName = 'Your coach';
    if (coachEmail) {
      const coachData = await airtable('Traveler', 'GET',
        `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${coachEmail}"`)}&maxRecords=1`
      );
      const coachRec = (coachData.body.records || [])[0];
      if (coachRec) coachName = coachRec.fields['Traveler Name'] || coachName;
    }

    // 3. PATCH the Trip with the new Traveler Email
    const patch = await airtable('Trips', 'PATCH', `/${tripId}`, {
      fields: {
        'Traveler Email': newEmail,
        'Last Modified':  new Date().toISOString().split('T')[0],
      },
    });
    if (patch.body.error) return res.status(500).json({ error: patch.body.error.message || JSON.stringify(patch.body.error) });
    const tripName = (patch.body.fields && (patch.body.fields['Trip Name'] || patch.body.fields['Destination'])) || 'Your trip';

    // 4a. Auto-add the customer as a Trip Member with role Traveler
    try {
      await fetch('https://app.transformedbytravels.com/api/trip-members', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tripId,
          tripName,
          inviterEmail: coachEmail || newEmail,
          inviterName:  coachName,
          inviteeEmail: newEmail,
          role:         'Traveler',
          status:       'Accepted',
          skipEmail:    true, // owner doesn't need an invite; they get the assignment email instead
        }),
      });
    } catch(e) { console.warn('[assign-trip] traveler add failed:', e); }

    // 4b. Auto-add Partner if the customer has one
    let partnerId = null, partnerEmail = null;
    const partnerRaw = custRec.fields['Partner'];
    if (Array.isArray(partnerRaw) && partnerRaw.length) {
      const v = partnerRaw[0];
      if (typeof v === 'string' && v.startsWith('rec')) partnerId = v;
      else if (typeof v === 'string' && v.includes('@')) partnerEmail = v.toLowerCase();
    } else if (typeof partnerRaw === 'string') {
      if (partnerRaw.includes('@')) partnerEmail = partnerRaw.toLowerCase();
      else if (partnerRaw.startsWith('rec')) partnerId = partnerRaw;
    }
    if (partnerId) {
      try {
        const pData = await airtable('Traveler', 'GET', `/${partnerId}`);
        partnerEmail = (pData.body.fields && pData.body.fields['Traveler Email'] || '').toLowerCase() || partnerEmail;
      } catch(e) {}
    }
    if (partnerEmail && partnerEmail !== newEmail) {
      try {
        await fetch('https://app.transformedbytravels.com/api/trip-members', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            tripId,
            tripName,
            inviterEmail: newEmail,
            inviterName:  custName,
            inviteeEmail: partnerEmail,
            role:         'Co-traveler',
            status:       'Accepted',
            skipEmail:    false,
          }),
        });
      } catch(e) { console.warn('[assign-trip] partner add failed:', e); }
    }

    // 5. Send notification email to the customer (always)
    try {
      await sendAssignmentEmail({ toEmail: newEmail, toName: custName, coachName, tripName, tripId });
    } catch(e) { console.warn('[assign-trip] notification email failed:', e); }

    // 5b. Notify the coach — the new trip + their other active trips + dashboard link
    if (coachEmail) {
      try {
        const tf         = patch.body.fields || {};
        const otherTrips = await getCoachActiveTrips(coachEmail, tripId);
        await sendCoachAssignmentEmail({
          coachEmail, coachName, custName, tripName, tripId,
          startDate: tf['Start Date'] || '', endDate: tf['End Date'] || '',
          otherTrips,
        });
      } catch(e) { console.warn('[assign-trip] coach notification failed:', e); }
    }

    return res.status(200).json({ ok: true, tripId, newEmail });
  } catch(e) {
    console.error('[assign-trip]', e);
    return res.status(500).json({ error: e.message });
  }
};
