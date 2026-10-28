const https = require('https');
const crypto = require('crypto');

const BASE_ID        = 'appdlxcWb45dIqNK2';
const MEMBERS_TABLE  = 'Trip Members';
const TRIPS_TABLE    = 'Trips';
const TRAVELER_TABLE = 'Traveler';

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


// Roles that can edit trip structure (schedule, dates, places).
// Includes legacy names (Trip Planner, Partner) for backwards compatibility.
const EDIT_ROLES = ['Coach', 'Traveler', 'Co-traveler', 'Trip Planner', 'Partner'];

// If the invitee doesn't have a Traveler record yet, create a stub so they can
// log in. When role is 'Tour Guide', flag the stub as Is Tour Guide = true so
// the portal routes them to the guide UI on first login.
async function ensureTravelerStub(email, role, inviteeName, coachEmail) {
  const normalized = email.toLowerCase().trim();
  if (!normalized) return { created: false };
  // Check for existing Traveler record
  const filter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${normalized}"`)}&maxRecords=1`;
  const lookup = await airtableRequest('GET', TRAVELER_TABLE, filter, null);
  if ((lookup.body.records || []).length > 0) {
    return { created: false, existing: true, record: lookup.body.records[0] };
  }
  // Create stub
  const today = new Date().toISOString().split('T')[0];
  const fields = {
    'Traveler Email':       normalized,
    'Traveler Name':        inviteeName || normalized.split('@')[0],
    'DNA Guides To Date':   0,
    'DNA Guides Remaining': 5,
    'Package Status':       'Free',
    'Created Date':         today,
    'Has Auth Account':     false,
  };
  if (role === 'Tour Guide') fields['Is Tour Guide'] = true;
  // If a Coach is inviting a Traveler or Co-traveler, auto-link them so the
  // stub appears on the coach's client roster.
  if (coachEmail && (role === 'Traveler' || role === 'Co-traveler')) {
    fields['Coach Email']          = coachEmail.toLowerCase().trim();
    fields['Coach Pairing Status'] = 'Linked';
  }
  try {
    const created = await airtableRequest('POST', TRAVELER_TABLE, '', { fields, typecast: true });
    if (created.body.error) {
      console.warn('[trip-members] ensureTravelerStub create failed:', created.body.error);
      return { created: false, error: created.body.error.message };
    }
    return { created: true, record: created.body };
  } catch(e) {
    console.warn('[trip-members] ensureTravelerStub threw:', e.message);
    return { created: false, error: e.message };
  }
}

// Smart default for "On Trip" checkbox based on role.
// Traveler / Co-traveler / Group Traveler / Tour Guide → true; Coach / Family → false.
// NOTE: 'Group Traveler' is deliberately absent from EDIT_ROLES above — a group
// member can view the shared itinerary (and keep their own journal/sightings),
// but cannot edit the trip structure. Only the Coach controls the schedule.
function defaultOnTrip(role) {
  return ['Traveler', 'Co-traveler', 'Group Traveler', 'Tour Guide'].includes(role);
}

async function sendEmail(toEmail, inviterName, tripName, role, acceptUrl) {
  const canEdit   = EDIT_ROLES.includes(role);
  const roleLabel = canEdit ? `${role} (can view & edit)` : `${role} (view only)`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#0d1520;padding:28px 40px;text-align:center;border-bottom:3px solid #2dd4bf;">
        <img src="https://threerealmstravel.com/threerealms/realm-symbols/logo.png" height="44" alt="Three Realms Travel" style="display:inline-block;margin:0 0 10px;" />
        <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 6px;">Three Realms Travel</p>
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
      from:    'Michael at Three Realms Travel <michael@transformedbytravels.com>',
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

  // GET — all accepted memberships for a given email (shared trips)
  if (req.method === 'GET' && req.query.memberEmail) {
    const email = (req.query.memberEmail || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'memberEmail required' });
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Email}="${email}",{Status}="Accepted")`)}`;
    try {
      const r = await airtableRequest('GET', MEMBERS_TABLE, filter, null);
      return res.status(200).json({ records: r.body.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — list members for a trip (no action param)
  if (req.method === 'GET' && !req.query.action) {
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

  // GET — pending invites for an email (any Invited records)
  if (req.method === 'GET' && req.query.action === 'pending') {
    const email = (req.query.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Email}="${email}",{Status}="Invited")`)}`;
    try {
      const r = await airtableRequest('GET', MEMBERS_TABLE, filter, null);
      return res.status(200).json({ records: r.body.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — accept invite by tripId+email (used when partner accept flow pre-created the member record)
  if (req.method === 'GET' && req.query.action === 'accept-by-email') {
    const tripId        = (req.query.tripId || '').trim();
    const acceptorEmail = (req.query.email  || '').toLowerCase().trim();
    if (!tripId || !acceptorEmail) return res.status(400).json({ error: 'tripId and email required' });

    const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Email}="${acceptorEmail}")`)}`;
    try {
      const r = await airtableRequest('GET', MEMBERS_TABLE, filter, null);
      const rec = (r.body.records || [])[0];
      if (rec) {
        const patch = await airtableRequest('PATCH', MEMBERS_TABLE, `/${rec.id}`, {
          fields: { 'Status': 'Accepted', 'Accepted By': acceptorEmail }
        });
        if (patch.body.error) return res.status(500).json({ error: patch.body.error.message || JSON.stringify(patch.body.error) });
        return res.status(200).json({ success: true, tripId, role: rec.fields['Role'] });
      }
      // No record yet — create one as already accepted (default to Co-traveler)
      const fields = { 'Trip ID': tripId, 'Email': acceptorEmail, 'Role': 'Co-traveler', 'Status': 'Accepted' };
      const cr = await airtableRequest('POST', MEMBERS_TABLE, '', { fields });
      if (cr.body.error) return res.status(500).json({ error: cr.body.error.message || JSON.stringify(cr.body.error) });
      return res.status(200).json({ success: true, tripId, role: 'Co-traveler', created: true });
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
      if (rec.fields['Status'] === 'Accepted') return res.status(200).json({ success: true, alreadyAccepted: true, tripId: rec.fields['Trip ID'], role: rec.fields['Role'] });

      // Accept — update record
      const patch = await airtableRequest('PATCH', MEMBERS_TABLE, `/${rec.id}`, {
        fields: { 'Status': 'Accepted', 'Email': acceptorEmail, 'Accepted By': acceptorEmail }
      });
      if (patch.body.error) return res.status(500).json({ error: patch.body.error.message || JSON.stringify(patch.body.error) });
      return res.status(200).json({ success: true, tripId: rec.fields['Trip ID'], role: rec.fields['Role'] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST ?action=notify — send a message to selected members
  if (req.method === 'POST' && req.query.action === 'notify') {
    const { emails, message, senderName, tripName, tripId } = req.body || {};
    if (!emails || !emails.length || !message) return res.status(400).json({ error: 'emails and message required' });
    const tripUrl  = `https://app.transformedbytravels.com/portal.html?page=planning&tripId=${encodeURIComponent(tripId || '')}`;
    const escaped  = message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#0d1520;padding:28px 40px;text-align:center;border-bottom:3px solid #2dd4bf;">
        <img src="https://threerealmstravel.com/threerealms/realm-symbols/logo.png" height="44" alt="Three Realms Travel" style="display:inline-block;margin:0 0 10px;" />
        <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 6px;">Three Realms Travel</p>
        <p style="font-family:Georgia,serif;font-size:20px;color:#ffffff;margin:0;">Message from ${senderName || 'Your Trip Organizer'}</p>
      </td></tr>
      <tr><td style="padding:36px 40px 28px;">
        <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 6px;">Re: ${tripName || 'Your Trip'}</h2>
        <p style="font-family:Arial,sans-serif;font-size:13px;color:#94a3b8;margin:0 0 24px;">from ${senderName || 'your trip organizer'}</p>
        <div style="font-family:Arial,sans-serif;font-size:15px;color:#334155;line-height:1.75;margin:0 0 28px;padding:20px 24px;background:#f8fafc;border-radius:10px;border-left:3px solid #2dd4bf;">${escaped}</div>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${tripUrl}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:8px;">
            View Trip →
          </a>
        </td></tr></table>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
    const errors = [];
    await Promise.all(emails.map(async toEmail => {
      try {
        const payload = JSON.stringify({ from: 'Michael at Three Realms Travel <michael@transformedbytravels.com>', to: toEmail, subject: `Message about ${tripName || 'your trip'} from ${senderName || 'your organizer'}`, html });
        await new Promise((resolve, reject) => {
          const opts = { hostname: 'api.resend.com', path: '/emails', method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
          const req = https.request(opts, (res) => { let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve()); });
          req.on('error', reject);
          req.write(payload);
          req.end();
        });
      } catch(e) {
        errors.push(toEmail);
        console.error('[trip-members] notify error:', e.message);
      }
    }));
    return res.status(200).json({ success: true, sent: emails.length - errors.length, failed: errors });
  }

  // POST ?action=resend — re-send an existing invitation
  if (req.method === 'POST' && req.query.action === 'resend') {
    const { id, inviterName, tripName } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const r = await airtableRequest('GET', MEMBERS_TABLE, `/${id}`, null);
      if (r.body.error) return res.status(404).json({ error: 'Member not found' });
      const f     = r.body.fields;
      const token = f['Invite Token'];
      const email = f['Email'];
      const role  = f['Role'] || 'Co-traveler';
      if (!token || !email) return res.status(400).json({ error: 'Invite token or email missing' });
      const acceptUrl = `https://app.transformedbytravels.com/portal.html?accept-trip=${token}&email=${encodeURIComponent(email)}`;
      await sendEmail(email, inviterName || f['Invited By Name'] || 'Your travel planner', tripName || 'a trip', role, acceptUrl);
      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — invite someone to a trip
  if (req.method === 'POST') {
    const { tripId, tripName, inviterEmail, inviterName, inviteeEmail, inviteeName, role, skipEmail, status, inviterIsCoach } = req.body || {};
    if (!tripId || !inviteeEmail || !role) return res.status(400).json({ error: 'tripId, inviteeEmail, and role required' });

    // Check not already a member. Return silently-ok if they already are,
    // rather than erroring — makes auto-add idempotent.
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Email}="${inviteeEmail.toLowerCase()}")`) }`;
    const existing = await airtableRequest('GET', MEMBERS_TABLE, filter, null);
    if ((existing.body.records || []).length > 0) {
      return res.status(200).json({ success: true, alreadyMember: true });
    }

    // Auto-create a Traveler stub if one doesn't exist, so the invitee can log
    // in. For Tour Guide role, flag the stub with Is Tour Guide = true.
    // If a coach is inviting a Traveler/Co-traveler, also auto-link them as
    // the coach's client (so they appear on the coach's dashboard).
    const coachForStub = inviterIsCoach ? inviterEmail : null;
    await ensureTravelerStub(inviteeEmail, role, inviteeName, coachForStub);

    const token = crypto.randomBytes(24).toString('hex');
    const now   = new Date().toISOString().split('T')[0];
    // If caller specified status (e.g. 'Accepted' for coach auto-add), honor it.
    const memberStatus = status || 'Invited';
    const fields = {
      'Trip ID':           tripId,
      'Email':             inviteeEmail.toLowerCase(),
      'Role':              role,
      'On Trip':           defaultOnTrip(role),
      'Status':            memberStatus,
      'Invited By':        inviterEmail || '',
      'Invited By Name':   inviterName  || '',
      'Invited Date':      now,
      'Invite Token':      token
    };
    if (memberStatus === 'Accepted') fields['Accepted By'] = inviteeEmail.toLowerCase();
    try {
      // typecast lets Airtable auto-create Role / Status options if any are
      // missing (e.g. "Coach" if the base still has old option list).
      const r = await airtableRequest('POST', MEMBERS_TABLE, '', { fields, typecast: true });
      if (r.body.error) {
        console.error('[trip-members POST] Airtable error:', JSON.stringify(r.body.error));
        return res.status(500).json({ error: r.body.error.message || JSON.stringify(r.body.error) });
      }
      if (!skipEmail) {
        const acceptUrl = `https://app.transformedbytravels.com/portal.html?accept-trip=${token}&email=${encodeURIComponent(inviteeEmail.toLowerCase())}`;
        await sendEmail(inviteeEmail.toLowerCase(), inviterName || inviterEmail, tripName || 'a trip', role, acceptUrl);
      }
      return res.status(200).json({ success: true, record: r.body });
    } catch(e) {
      console.error('[trip-members POST] threw:', e);
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
