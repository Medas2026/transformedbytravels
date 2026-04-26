const https = require('https');
const crypto = require('crypto');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const MEMBERS_TABLE = 'Trip Members';
const TRIPS_TABLE   = 'Trips';

function airtableRequest(method, table, path, body) {
  return new Promise((resolve, reject) => {
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}


async function sendEmail(toEmail, inviterName, tripName, role, acceptUrl) {
  const canEdit   = role === 'Trip Planner' || role === 'Partner';
  const roleLabel = canEdit ? `${role} (can view & edit)` : `${role} (view only)`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#0d1520;padding:28px 40px;text-align:center;border-bottom:3px solid #2dd4bf;">
        <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 6px;">Transformed by Travels</p>
        <p style="font-family:Georgia,serif;font-size:20px;color:#ffffff;margin:0;">Trip Invitation</p>
      </td></tr>
      <tr><td style="padding:36px 40px 28px;">
        <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 16px;">You're invited to a trip!</h2>
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 16px;">
          <strong>${inviterName}</strong> has invited you to join <strong>${tripName}</strong> on MyJourneys as a <strong>${roleLabel}</strong>.
        </p>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${acceptUrl}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">
            Accept Invitation →
          </a>
        </td></tr></table>
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:28px 0 0;">
          If you don't have a MyJourneys account yet, you'll be prompted to create one after clicking the link.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  try {
    const payload = JSON.stringify({
      from:    'TravelForGrowth@transformedbytravels.com',
      to:      toEmail,
      subject: `${inviterName} invited you to join ${tripName}`,
      html
    });
    await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.resend.com',
        path:     '/emails',
        method:   'POST',
        headers: {
          'Authorization':  'Bearer ' + process.env.RESEND_API_KEY,
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const req = https.request(opts, (res) => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => resolve());
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  } catch(e) {
    console.error('[trip-members] email error:', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — list members for a trip
  if (req.method === 'GET' && req.query.action !== 'accept') {
    const tripId = (req.query.tripId || '').trim();
    if (!tripId) return res.status(400).json({ error: 'tripId required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}`;
    try {
      const r = await airtableRequest('GET', MEMBERS_TABLE, filter, null);
      return res.status(200).json({ records: r.body.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — accept invite via token
  if (req.method === 'GET' && req.query.action === 'accept') {
    const token       = (req.query.token || '').trim();
    const acceptorEmail = (req.query.email || '').toLowerCase().trim();
    if (!token || !acceptorEmail) return res.status(400).json({ error: 'token and email required' });

    const filter = `?filterByFormula=${encodeURIComponent(`({Invite Token}="${token}")`)}`;
    try {
      const r = await airtableRequest('GET', MEMBERS_TABLE, filter, null);
      const rec = (r.body.records || [])[0];
      if (!rec) return res.status(404).json({ error: 'Invite not found or already used' });
      if (rec.fields['Status'] === 'Accepted') return res.status(200).json({ success: true, alreadyAccepted: true, tripId: rec.fields['Trip ID'] });

      // Accept — update record
      const now = new Date().toISOString();
      await airtableRequest('PATCH', MEMBERS_TABLE, `/${rec.id}`, {
        fields: { 'Status': 'Accepted', 'Email': acceptorEmail, 'Accepted Date': now }
      });
      return res.status(200).json({ success: true, tripId: rec.fields['Trip ID'], role: rec.fields['Role'] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — invite someone to a trip
  if (req.method === 'POST') {
    const { tripId, tripName, inviterEmail, inviterName, inviteeEmail, role, skipEmail } = req.body || {};
    if (!tripId || !inviteeEmail || !role) return res.status(400).json({ error: 'tripId, inviteeEmail, and role required' });

    // Check not already a member
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Email}="${inviteeEmail.toLowerCase()}")`) }`;
    const existing = await airtableRequest('GET', MEMBERS_TABLE, filter, null);
    if ((existing.body.records || []).length > 0) {
      return res.status(400).json({ error: 'This person is already a member of this trip' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const now   = new Date().toISOString().split('T')[0];
    const fields = {
      'Trip ID':      tripId,
      'Email':        inviteeEmail.toLowerCase(),
      'Role':         role,
      'Status':       'Invited',
      'Invited By':   inviterEmail || '',
      'Invited Date': now,
      'Invite Token': token
    };
    try {
      const r = await airtableRequest('POST', MEMBERS_TABLE, '', { fields });
      if (r.body.error) return res.status(500).json({ error: r.body.error.message || JSON.stringify(r.body.error) });
      if (!skipEmail) {
        const acceptUrl = `https://app.transformedbytravels.com/portal.html?accept-trip=${token}&email=${encodeURIComponent(inviteeEmail.toLowerCase())}`;
        await sendEmail(inviteeEmail.toLowerCase(), inviterName || inviterEmail, tripName || 'a trip', role, acceptUrl);
      }
      return res.status(200).json({ success: true, record: r.body });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PATCH — update role
  if (req.method === 'PATCH') {
    const { id, role } = req.body || {};
    if (!id || !role) return res.status(400).json({ error: 'id and role required' });
    try {
      const r = await airtableRequest('PATCH', MEMBERS_TABLE, `/${id}`, { fields: { 'Role': role } });
      if (r.body.error) return res.status(500).json({ error: r.body.error.message || JSON.stringify(r.body.error) });
      return res.status(200).json({ success: true, record: r.body });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE — remove a member from a trip
  if (req.method === 'DELETE') {
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const r = await airtableRequest('DELETE', MEMBERS_TABLE, `/${id}`, null);
      if (r.body.error) return res.status(500).json({ error: r.body.error });
      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
