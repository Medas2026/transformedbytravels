const https = require('https');
const crypto = require('crypto');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Traveler';

// ── Airtable helpers ─────────────────────────────────────────────────────────

function airtableGet(filter) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const options = {
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${filter}`,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function airtablePatch(recordId, fields) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const body   = JSON.stringify({ fields });
    console.log('airtablePatch recordId:', recordId, 'fields:', JSON.stringify(fields));
    const options = {
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${recordId}`,
      method: 'PATCH',
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        console.log('airtablePatch response status:', res.statusCode, 'body:', d.slice(0, 400));
        try {
          const parsed = JSON.parse(d);
          if (res.statusCode >= 400) {
            reject(new Error('Airtable error ' + res.statusCode + ': ' + (parsed.error && parsed.error.message ? parsed.error.message : d.slice(0, 200))));
          } else {
            resolve(parsed);
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getByEmail(email) {
  const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
  const data   = await airtableGet(filter);
  return (data.records || [])[0] || null;
}

async function getByToken(token) {
  const filter = `?filterByFormula=${encodeURIComponent(`({Partner Link Token}="${token}")`)}`;
  const data   = await airtableGet(filter);
  return (data.records || [])[0] || null;
}

// ── Email ────────────────────────────────────────────────────────────────────

function sendInviteEmail(toEmail, fromName, acceptUrl) {
  return new Promise((resolve, reject) => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#0d1520;padding:28px 40px;text-align:center;border-bottom:3px solid #2dd4bf;">
        <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 6px;">Transformed by Travels</p>
        <p style="font-family:Georgia,serif;font-size:20px;color:#ffffff;margin:0;">Travel Partner Invitation</p>
      </td></tr>
      <tr><td style="padding:36px 40px 28px;">
        <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 16px;">You've been invited!</h2>
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 16px;">
          <strong>${fromName}</strong> has invited you to connect as travel partners on Transformed by Travels.
        </p>
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 28px;">
          Once connected, you'll be able to see a compatibility report showing how your travel archetypes and dimensions complement each other — and get insights into how you travel best together.
        </p>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${acceptUrl}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Accept Invitation →
          </a>
        </td></tr></table>
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:28px 0 0;">
          This invitation expires in 7 days. If you don't have a Transformed by Travels account yet, you'll be prompted to create one after clicking the link.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    const payload = JSON.stringify({
      from:    'TravelForGrowth@transformedbytravels.com',
      to:      toEmail,
      subject: `${fromName} invited you to connect on Transformed by Travels`,
      html
    });

    const options = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { resolve(); });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Claude partner bullets ────────────────────────────────────────────────────

function buildPartnerBullets(travelerA, travelerB) {
  const nameA = (travelerA['Traveler Name'] || 'Traveler A').split(' ')[0];
  const nameB = (travelerB['Traveler Name'] || 'Traveler B').split(' ')[0];

  const prompt = `You are a travel psychology expert. Based on the profiles below, write 4 to 5 bullet points that capture how ${nameA} and ${nameB} relate to travel together as partners. Focus on their complementary strengths, shared values, where they'll naturally align, and what makes their travel partnership special. Be warm, specific, and personal — use their first names.

${nameA}:
- Archetype: ${travelerA['Archetype'] || 'Unknown'}
- Passions: ${travelerA['Passions'] || 'Not specified'}
- Dimension scores (out of 7): Curiosity ${travelerA['DS-1 Curiosity'] || 0}, Adventure ${travelerA['DS-2 Adventure'] || 0}, Reflection ${travelerA['DS-3 Reflection'] || 0}, Connection ${travelerA['DS-4 Connection'] || 0}, Travel Purpose ${travelerA['DS-5 Intention'] || 0}

${nameB}:
- Archetype: ${travelerB['Archetype'] || 'Unknown'}
- Passions: ${travelerB['Passions'] || 'Not specified'}
- Dimension scores (out of 7): Curiosity ${travelerB['DS-1 Curiosity'] || 0}, Adventure ${travelerB['DS-2 Adventure'] || 0}, Reflection ${travelerB['DS-3 Reflection'] || 0}, Connection ${travelerB['DS-4 Connection'] || 0}, Travel Purpose ${travelerB['DS-5 Intention'] || 0}

Output only the bullet points, one per line, each starting with a bullet character •. Keep each bullet to 10 words or fewer. No headers, no intro sentence, no trailing text.`;

  const body = JSON.stringify({
    model:      'claude-sonnet-4-6',
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }]
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const text = (parsed.content && parsed.content[0] && parsed.content[0].text) || '';
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Claude compatibility report ───────────────────────────────────────────────

function buildCompatibilityReport(travelerA, travelerB) {
  const dims = ['Curiosity', 'Adventure', 'Reflection', 'Connection', 'Travel Purpose'];
  const scoresA = {
    Curiosity:        travelerA['DS-1 Curiosity']  || 0,
    Adventure:        travelerA['DS-2 Adventure']  || 0,
    Reflection:       travelerA['DS-3 Reflection'] || 0,
    Connection:       travelerA['DS-4 Connection'] || 0,
    'Travel Purpose': travelerA['DS-5 Intention']  || 0
  };
  const scoresB = {
    Curiosity:        travelerB['DS-1 Curiosity']  || 0,
    Adventure:        travelerB['DS-2 Adventure']  || 0,
    Reflection:       travelerB['DS-3 Reflection'] || 0,
    Connection:       travelerB['DS-4 Connection'] || 0,
    'Travel Purpose': travelerB['DS-5 Intention']  || 0
  };

  return new Promise((resolve, reject) => {
    const prompt = `You are an expert travel psychology consultant. Two travelers want to understand how they'll travel together.

Traveler A: ${travelerA['Traveler Name'] || 'Traveler A'}
- Archetype: ${travelerA['Archetype'] || 'Unknown'}
- Passions: ${travelerA['Passions'] || 'Not specified'}
- Dimension scores (out of 7): Curiosity ${scoresA.Curiosity}, Adventure ${scoresA.Adventure}, Reflection ${scoresA.Reflection}, Connection ${scoresA.Connection}, Travel Purpose ${scoresA['Travel Purpose']}

Traveler B: ${travelerB['Traveler Name'] || 'Traveler B'}
- Archetype: ${travelerB['Archetype'] || 'Unknown'}
- Passions: ${travelerB['Passions'] || 'Not specified'}
- Dimension scores (out of 7): Curiosity ${scoresB.Curiosity}, Adventure ${scoresB.Adventure}, Reflection ${scoresB.Reflection}, Connection ${scoresB.Connection}, Travel Purpose ${scoresB['Travel Purpose']}

Write a warm, insightful travel compatibility report with these four sections. Use plain text with section headers (no markdown, no asterisks, no bullet dashes — use numbers for lists if needed):

TRAVEL CHEMISTRY
Two to three sentences about how these two archetypes naturally interact when traveling together. What energy does this pairing create?

YOUR STRENGTHS AS TRAVEL PARTNERS
Three to four specific strengths of this combination — what you'll both love, where you'll naturally agree, and what makes your trips richer because you're together.

WHERE TO FIND YOUR RHYTHM
Two to three areas where your different scores or archetypes may create friction, and practical ways to navigate them so both travelers feel fulfilled.

TRIP STYLES MADE FOR YOU BOTH
Three specific types of trips or experiences that play to both travelers' strengths — be concrete (e.g. "a slow river journey through Southeast Asia" not just "cultural travel").

Keep the tone warm, personal, and forward-looking. Address them by first name throughout.`;

    const body = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1200,
      messages:   [{ role: 'user', content: prompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const text = (parsed.content && parsed.content[0] && parsed.content[0].text) || '';
          resolve({ text, scoresA, scoresB, dims });
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
  const b = req.body || {};

  // ── POST: send invite ────────────────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'invite') {
    const { senderEmail, partnerEmail } = b;
    if (!senderEmail || !partnerEmail) return res.status(400).json({ error: 'senderEmail and partnerEmail required' });

    if (senderEmail.toLowerCase() === partnerEmail.toLowerCase())
      return res.status(400).json({ error: 'You cannot invite yourself' });

    const sender = await getByEmail(senderEmail.toLowerCase());
    if (!sender) return res.status(404).json({ error: 'Sender account not found' });

    const senderName = sender.fields['Traveler Name'] || senderEmail;

    // Generate token + expiry
    const token  = crypto.randomBytes(24).toString('hex');
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    await airtablePatch(sender.id, {
      'Travel Partner Email': partnerEmail.toLowerCase(),
      'Partner Status':       'Pending',
      'Partner Link Token':   token,
      'Partner Token Expiry': expiry
    });

    const acceptUrl = `https://app.transformedbytravels.com/portal.html?accept-partner=${token}`;
    await sendInviteEmail(partnerEmail.toLowerCase(), senderName, acceptUrl);

    return res.status(200).json({ success: true, status: 'Pending' });
  }

  // ── POST: accept invite ──────────────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'accept') {
    const { token, acceptorEmail } = b;
    if (!token || !acceptorEmail) return res.status(400).json({ error: 'token and acceptorEmail required' });

    const sender = await getByToken(token);
    if (!sender) return res.status(404).json({ error: 'Invitation not found or already used' });

    const f = sender.fields;

    console.log('accept: token found, sender=', f['Traveler Email'], 'intended=', f['Travel Partner Email'], 'acceptor=', acceptorEmail);

    // Check expiry
    const expiry = f['Partner Token Expiry'] ? new Date(f['Partner Token Expiry']) : null;
    if (expiry && expiry < new Date()) return res.status(400).json({ error: 'Invitation has expired' });

    // Check the acceptor is the intended recipient (warn but don't block — email aliases differ)
    const intendedEmail = (f['Travel Partner Email'] || '').toLowerCase();
    if (intendedEmail && intendedEmail !== acceptorEmail.toLowerCase()) {
      console.log('accept: email mismatch — intended:', intendedEmail, 'got:', acceptorEmail.toLowerCase());
      // Don't block — update the partner email to match the actual Auth0 email
    }

    // Link sender → acceptor
    await airtablePatch(sender.id, {
      'Partner Status':       'Linked',
      'Partner Link Token':   '',
      'Travel Partner Email': acceptorEmail.toLowerCase()
    });

    // Link acceptor → sender (create link back)
    const acceptor = await getByEmail(acceptorEmail.toLowerCase());
    if (acceptor) {
      await airtablePatch(acceptor.id, {
        'Travel Partner Email': (f['Traveler Email'] || '').toLowerCase(),
        'Partner Status':       'Linked',
        'Partner Link Token':   ''
      });
    }

    return res.status(200).json({ success: true, partnerName: f['Traveler Name'] || '' });
  }

  // ── GET: partner bullets ─────────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'bullets') {
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });

    const traveler = await getByEmail(email);
    if (!traveler) return res.status(404).json({ error: 'Traveler not found' });

    const f = traveler.fields;
    if (f['Partner Status'] !== 'Linked') return res.status(400).json({ error: 'No linked partner' });

    const partnerEmail = (f['Travel Partner Email'] || '').toLowerCase();
    const partner = await getByEmail(partnerEmail);
    if (!partner) return res.status(404).json({ error: 'Partner account not found' });

    const text = await buildPartnerBullets(f, partner.fields);
    return res.status(200).json({ bullets: text });
  }

  // ── GET: compatibility report ────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'compatibility') {
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });

    const traveler = await getByEmail(email);
    if (!traveler) return res.status(404).json({ error: 'Traveler not found' });

    const f = traveler.fields;
    if (f['Partner Status'] !== 'Linked') return res.status(400).json({ error: 'No linked partner' });

    const partnerEmail = (f['Travel Partner Email'] || '').toLowerCase();
    if (!partnerEmail) return res.status(400).json({ error: 'Partner email not set' });

    const partner = await getByEmail(partnerEmail);
    if (!partner) return res.status(404).json({ error: 'Partner account not found' });

    const { text, scoresA, scoresB, dims } = await buildCompatibilityReport(f, partner.fields);

    return res.status(200).json({
      travelerA: { name: f['Traveler Name'], archetype: f['Archetype'], scores: scoresA },
      travelerB: { name: partner.fields['Traveler Name'], archetype: partner.fields['Archetype'], scores: scoresB },
      dims,
      report: text
    });
  }

  return res.status(400).json({ error: 'Unknown action' });

  } catch(e) {
    console.error('partner handler error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
