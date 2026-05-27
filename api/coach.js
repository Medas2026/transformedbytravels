const https  = require('https');
const crypto = require('crypto');

const BASE_ID         = 'appdlxcWb45dIqNK2';
const TRAVELER_TABLE  = 'Traveler';
const TRIPS_TABLE     = 'Trips';
const JOURNAL_TABLE   = 'Journal Entries';
const FOLLOWUPS_TABLE = 'Coach Follow-ups';
const PORTAL_URL      = 'https://app.transformedbytravels.com';

async function at(table, path, method = 'GET', body = null) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

async function getByEmail(email) {
  const data = await at(TRAVELER_TABLE, `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}` );
  return (data.records || [])[0] || null;
}

async function getByCoachToken(token) {
  const data = await at(TRAVELER_TABLE, `?filterByFormula=${encodeURIComponent(`({Coach Link Token}="${token}")`)}` );
  return (data.records || [])[0] || null;
}

async function getActiveTrip(email) {
  const data = await at(TRIPS_TABLE, `?filterByFormula=${encodeURIComponent(`AND({Traveler Email}="${email}",{Status of Trip}="Active")`)}` );
  return (data.records || [])[0] || null;
}

async function getNextTrip(email) {
  const data = await at(TRIPS_TABLE,
    `?filterByFormula=${encodeURIComponent(`AND({Traveler Email}="${email}",{Status of Trip}="Upcoming")`)}&sort[0][field]=Start%20Date&sort[0][direction]=asc`
  );
  return (data.records || [])[0] || null;
}

function tripDayNum(trip) {
  const now   = new Date();
  const tz    = trip.fields['Time Zone'] || 'UTC';
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const start = trip.fields['Activation Date'] || trip.fields['Start Date'] || '';
  if (!start) return null;
  const diff = Math.round((new Date(local) - new Date(start)) / 86400000);
  return diff >= 0 ? diff + 1 : null;
}

// ── Email helpers ─────────────────────────────────────────────────────────────

function emailWrap(headerSub, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#0d1520;padding:28px 40px;text-align:center;border-bottom:3px solid #2dd4bf;">
        <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 6px;">Transformed by Travels</p>
        <p style="font-family:Georgia,serif;font-size:20px;color:#ffffff;margin:0;">${headerSub}</p>
      </td></tr>
      <tr><td style="padding:36px 40px 28px;">${bodyHtml}</td></tr>
      <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function sendEmail(toEmail, subject, html) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      from:    'TravelForGrowth@transformedbytravels.com',
      to:      toEmail,
      subject,
      html
    });
    const req = https.request({
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query.action || '').toLowerCase();

  try {

  // ── GET dashboard — coach's customer roster ──────────────────────────────
  if (req.method === 'GET' && action === 'dashboard') {
    const coachEmail = (req.query.email || '').toLowerCase().trim();
    if (!coachEmail) return res.status(400).json({ error: 'email required' });

    const data = await at(TRAVELER_TABLE,
      `?filterByFormula=${encodeURIComponent(`AND({Coach Email}="${coachEmail}",{Coach Pairing Status}="Linked")`)}`
    );

    const customers = [];
    for (const r of (data.records || [])) {
      const f         = r.fields;
      const custEmail = (f['Traveler Email'] || '').toLowerCase();
      const active    = await getActiveTrip(custEmail);
      const next      = !active ? await getNextTrip(custEmail) : null;

      let trip = null;
      if (active) {
        const dayNum = tripDayNum(active);
        trip = {
          id:               active.id,
          destination:      active.fields['Destination'] || '',
          startDate:        active.fields['Start Date']  || '',
          endDate:          active.fields['End Date']    || '',
          dayNum,
          status:           'active',
          coachTipOverride: active.fields['Coach Tip Override'] || ''
        };
      } else if (next) {
        const daysUntil = next.fields['Start Date']
          ? Math.ceil((new Date(next.fields['Start Date']) - new Date()) / 86400000)
          : null;
        trip = {
          id:          next.id,
          destination: next.fields['Destination'] || '',
          startDate:   next.fields['Start Date']  || '',
          endDate:     next.fields['End Date']    || '',
          daysUntil,
          status:      'upcoming'
        };
      }

      customers.push({
        recordId:  r.id,
        email:     custEmail,
        name:      f['Traveler Name'] || custEmail,
        archetype: f['Archetype']     || '',
        passions:  f['Passions']      || '',
        archived:  !!f['Coach Archived'],
        trip
      });
    }

    return res.status(200).json({ customers });
  }

  // ── GET customer — full detail view ─────────────────────────────────────
  if (req.method === 'GET' && action === 'customer') {
    const coachEmail = (req.query.coach || '').toLowerCase().trim();
    const custEmail  = (req.query.email || '').toLowerCase().trim();
    if (!coachEmail || !custEmail) return res.status(400).json({ error: 'coach and email required' });

    const traveler = await getByEmail(custEmail);
    if (!traveler) return res.status(404).json({ error: 'Customer not found' });
    if ((traveler.fields['Coach Email'] || '').toLowerCase() !== coachEmail)
      return res.status(403).json({ error: 'Not authorized' });

    const f      = traveler.fields;
    const active = await getActiveTrip(custEmail);

    // Journal entries (last 14 for active trip)
    let journalEntries = [];
    if (active) {
      const jData = await at(JOURNAL_TABLE,
        `?filterByFormula=${encodeURIComponent(`({Trip ID}="${active.id}")`)}&sort[0][field]=Entry%20Date&sort[0][direction]=desc&maxRecords=14`
      );
      journalEntries = (jData.records || []).map(r => ({
        id:              r.id,
        date:            r.fields['Entry Date']            || '',
        day:             r.fields['Day Number']            || '',
        entry:           r.fields['Reflection']            || '',
        claudeReflection: r.fields['Reflection from Claude'] || '',
        feeling:         r.fields['Day Rating'] ? `${r.fields['Day Rating']}/5` : ''
      }));
    }

    // Follow-ups (all, newest first)
    const fuData = await at(FOLLOWUPS_TABLE,
      `?filterByFormula=${encodeURIComponent(`AND({Coach Email}="${coachEmail}",{Traveler Email}="${custEmail}")`)}&sort[0][field]=Sent At&sort[0][direction]=desc`
    );
    const followups = (fuData.records || []).map(r => ({
      id:        r.id,
      question:  r.fields['Question']   || '',
      reply:     r.fields['Reply']      || '',
      sentAt:    r.fields['Sent At']    || '',
      repliedAt: r.fields['Replied At'] || '',
      status:    r.fields['Status']     || 'Sent'
    }));

    let trip = null;
    if (active) {
      const dayNum = tripDayNum(active);
      const tz     = active.fields['Time Zone'] || 'UTC';
      trip = {
        id:               active.id,
        destination:      active.fields['Destination'] || '',
        startDate:        active.fields['Start Date']  || '',
        endDate:          active.fields['End Date']    || '',
        dayNum,
        timeZone:         tz,
        coachTipOverride: active.fields['Coach Tip Override'] || ''
      };
    }

    return res.status(200).json({
      customer: {
        recordId:  traveler.id,
        email:     custEmail,
        name:      f['Traveler Name'] || custEmail,
        archetype: f['Archetype']     || '',
        passions:  f['Passions']      || '',
        archived:  !!f['Coach Archived']
      },
      trip,
      journalEntries,
      followups
    });
  }

  // ── GET coach-info — customer's coach info ───────────────────────────────
  if (req.method === 'GET' && action === 'coach-info') {
    const custEmail = (req.query.email || '').toLowerCase().trim();
    if (!custEmail) return res.status(400).json({ error: 'email required' });

    const customer = await getByEmail(custEmail);
    if (!customer) return res.status(404).json({ error: 'Traveler not found' });

    const f             = customer.fields;
    const coachEmail    = (f['Coach Email'] || '').toLowerCase();
    const pairingStatus = f['Coach Pairing Status'] || '';

    if (!coachEmail || pairingStatus !== 'Linked')
      return res.status(200).json({ coach: null });

    const coachRec  = await getByEmail(coachEmail);
    const coachName = coachRec ? (coachRec.fields['Traveler Name'] || coachEmail) : coachEmail;

    return res.status(200).json({ coach: { email: coachEmail, name: coachName } });
  }

  // ── GET followups — customer's follow-up list ────────────────────────────
  if (req.method === 'GET' && action === 'followups') {
    const custEmail = (req.query.email || '').toLowerCase().trim();
    if (!custEmail) return res.status(400).json({ error: 'email required' });

    const data = await at(FOLLOWUPS_TABLE,
      `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${custEmail}")`)}&sort[0][field]=Sent At&sort[0][direction]=desc`
    );
    const followups = (data.records || []).map(r => ({
      id:        r.id,
      question:  r.fields['Question']   || '',
      reply:     r.fields['Reply']      || '',
      sentAt:    r.fields['Sent At']    || '',
      repliedAt: r.fields['Replied At'] || '',
      status:    r.fields['Status']     || 'Sent'
    }));
    return res.status(200).json({ followups });
  }

  // ── POST invite — coach sends coaching invitation ────────────────────────
  if (req.method === 'POST' && action === 'invite') {
    const { coachEmail, customerEmail } = req.body || {};
    if (!coachEmail || !customerEmail) return res.status(400).json({ error: 'coachEmail and customerEmail required' });
    if (coachEmail.toLowerCase() === customerEmail.toLowerCase())
      return res.status(400).json({ error: 'Coach cannot invite themselves' });

    const coach = await getByEmail(coachEmail.toLowerCase());
    if (!coach) return res.status(404).json({ error: 'Coach account not found' });
    if (!coach.fields['Is Coach']) return res.status(403).json({ error: 'Account is not a coach' });

    const customer = await getByEmail(customerEmail.toLowerCase());
    if (!customer) return res.status(404).json({ error: 'No Transformed by Travels account found for that email' });

    const cf = customer.fields;
    if (cf['Is Coach'])
      return res.status(400).json({ error: 'That traveler is a coach and cannot be invited as a customer' });
    const existingCoach  = (cf['Coach Email'] || '').toLowerCase();
    const pairingStatus  = cf['Coach Pairing Status'] || '';
    if (existingCoach && pairingStatus === 'Linked' && existingCoach !== coachEmail.toLowerCase())
      return res.status(400).json({ error: 'That traveler is already connected with another coach' });

    const coachName = coach.fields['Traveler Name'] || coachEmail;
    const token     = crypto.randomBytes(24).toString('hex');
    const expiry    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    await at(TRAVELER_TABLE, `/${customer.id}`, 'PATCH', {
      fields: {
        'Coach Email':          coachEmail.toLowerCase(),
        'Coach Pairing Status': 'Pending',
        'Coach Link Token':     token,
        'Coach Token Expiry':   expiry
      }
    });

    const acceptUrl = `${PORTAL_URL}/portal.html?accept-coach=${token}`;
    const body = `
      <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 16px;">You've been invited!</h2>
      <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 16px;">
        <strong>${coachName}</strong> has invited you to connect as your Transformed by Travels coach.
      </p>
      <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 28px;">
        Your coach will support you with personalized daily travel insights, follow-up questions, and guidance throughout your journey.
      </p>
      <table cellpadding="0" cellspacing="0"><tr><td>
        <a href="${acceptUrl}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Accept Coaching →</a>
      </td></tr></table>
      <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:28px 0 0;">This invitation expires in 7 days.</p>`;

    await sendEmail(
      customerEmail.toLowerCase(),
      `${coachName} invited you to connect on Transformed by Travels`,
      emailWrap('Coaching Invitation', body)
    );

    return res.status(200).json({ success: true });
  }

  // ── POST accept — customer accepts coaching invitation ───────────────────
  if (req.method === 'POST' && action === 'accept') {
    const { token, acceptorEmail } = req.body || {};
    if (!token || !acceptorEmail) return res.status(400).json({ error: 'token and acceptorEmail required' });

    const customer = await getByCoachToken(token);
    if (!customer) return res.status(404).json({ error: 'Invitation not found or already used' });

    const f      = customer.fields;
    const expiry = f['Coach Token Expiry'] ? new Date(f['Coach Token Expiry']) : null;
    if (expiry && expiry < new Date()) return res.status(400).json({ error: 'Invitation has expired' });

    const coachEmail = (f['Coach Email'] || '').toLowerCase();

    await at(TRAVELER_TABLE, `/${customer.id}`, 'PATCH', {
      fields: { 'Coach Pairing Status': 'Linked', 'Coach Link Token': '' }
    });

    const coach        = await getByEmail(coachEmail);
    const coachName    = coach ? (coach.fields['Traveler Name'] || coachEmail) : coachEmail;
    const customerName = f['Traveler Name'] || acceptorEmail;

    // Notify coach
    const coachBody = `
      <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 16px;">Coaching connection accepted!</h2>
      <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 28px;">
        <strong>${customerName}</strong> has accepted your coaching invitation. You can now view their profile and trips in your coach portal.
      </p>
      <table cellpadding="0" cellspacing="0"><tr><td>
        <a href="${PORTAL_URL}/coach-portal.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Open Coach Portal →</a>
      </td></tr></table>`;
    await sendEmail(coachEmail, `${customerName} accepted your coaching invitation`, emailWrap('New Connection', coachBody)).catch(() => {});

    // Notify linked travel partner (informational, non-blocking)
    const partnerEmail  = (f['Travel Partner Email'] || '').toLowerCase();
    const partnerStatus = f['Partner Status'] || '';
    if (partnerEmail && partnerStatus === 'Linked') {
      const pBody = `
        <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 16px;">Your travel partner is working with a coach</h2>
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 28px;">
          <strong>${customerName}</strong> has connected with a Transformed by Travels coach (${coachName}) to support their travel journey.
        </p>`;
      await sendEmail(partnerEmail, `${customerName} is now working with a travel coach`, emailWrap('Travel Partner Update', pBody)).catch(() => {});
    }

    return res.status(200).json({ success: true, coachName });
  }

  // ── POST archive — toggle archive flag on customer ───────────────────────
  if (req.method === 'POST' && action === 'archive') {
    const { coachEmail, customerEmail, archived } = req.body || {};
    if (!coachEmail || !customerEmail) return res.status(400).json({ error: 'coachEmail and customerEmail required' });

    const customer = await getByEmail(customerEmail.toLowerCase());
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if ((customer.fields['Coach Email'] || '').toLowerCase() !== coachEmail.toLowerCase())
      return res.status(403).json({ error: 'Not authorized' });

    await at(TRAVELER_TABLE, `/${customer.id}`, 'PATCH', {
      fields: { 'Coach Archived': !!archived }
    });
    return res.status(200).json({ success: true, archived: !!archived });
  }

  // ── POST terminate — end coaching relationship ───────────────────────────
  if (req.method === 'POST' && action === 'terminate') {
    const { initiatorEmail, customerEmail } = req.body || {};
    if (!initiatorEmail || !customerEmail) return res.status(400).json({ error: 'initiatorEmail and customerEmail required' });

    const customer = await getByEmail(customerEmail.toLowerCase());
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const coachEmail  = (customer.fields['Coach Email'] || '').toLowerCase();
    const initiatorNorm = initiatorEmail.toLowerCase();
    if (initiatorNorm !== coachEmail && initiatorNorm !== customerEmail.toLowerCase())
      return res.status(403).json({ error: 'Not authorized' });

    await at(TRAVELER_TABLE, `/${customer.id}`, 'PATCH', {
      fields: {
        'Coach Email':          '',
        'Coach Pairing Status': 'Terminated',
        'Coach Link Token':     '',
        'Coach Token Expiry':   '',
        'Coach Archived':       false
      }
    });
    return res.status(200).json({ success: true });
  }

  // ── POST followup — coach sends a follow-up question ────────────────────
  if (req.method === 'POST' && action === 'followup') {
    const { coachEmail, customerEmail, tripId, question } = req.body || {};
    if (!coachEmail || !customerEmail || !question)
      return res.status(400).json({ error: 'coachEmail, customerEmail, and question required' });

    const customer = await getByEmail(customerEmail.toLowerCase());
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if ((customer.fields['Coach Email'] || '').toLowerCase() !== coachEmail.toLowerCase())
      return res.status(403).json({ error: 'Not authorized' });

    const coach        = await getByEmail(coachEmail.toLowerCase());
    const coachName    = coach ? (coach.fields['Traveler Name'] || coachEmail) : coachEmail;
    const customerName = customer.fields['Traveler Name'] || customerEmail;

    const fuRec = await at(FOLLOWUPS_TABLE, '', 'POST', {
      fields: {
        'Coach Email':    coachEmail.toLowerCase(),
        'Traveler Email': customerEmail.toLowerCase(),
        'Question':       question,
        'Sent At':        new Date().toISOString(),
        'Status':         'Sent',
        ...(tripId ? { 'Trip ID': tripId } : {})
      }
    });
    if (fuRec.error) return res.status(500).json({ error: fuRec.error.message || 'Failed to save follow-up' });

    const replyUrl = `${PORTAL_URL}/portal.html?followup=${fuRec.id}`;
    const body = `
      <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 16px;">A question from your coach</h2>
      <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 24px;">Hi ${customerName.split(' ')[0]}, ${coachName} has a question for you:</p>
      <div style="background:#f8fafc;border-left:4px solid #2dd4bf;border-radius:4px;padding:16px 20px;margin:0 0 28px;">
        <p style="font-family:Georgia,serif;font-size:15px;color:#0f172a;line-height:1.75;margin:0;">${question}</p>
      </div>
      <table cellpadding="0" cellspacing="0"><tr><td>
        <a href="${replyUrl}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Reply in Portal →</a>
      </td></tr></table>`;

    await sendEmail(
      customerEmail.toLowerCase(),
      `${coachName} has a question for you`,
      emailWrap('Coach Follow-up', body)
    );

    return res.status(200).json({ success: true, id: fuRec.id });
  }

  // ── POST reply — customer replies to a follow-up ─────────────────────────
  if (req.method === 'POST' && action === 'reply') {
    const { followupId, customerEmail, reply } = req.body || {};
    if (!followupId || !customerEmail || !reply)
      return res.status(400).json({ error: 'followupId, customerEmail, and reply required' });

    const fuData = await at(FOLLOWUPS_TABLE, `/${followupId}`);
    if (fuData.error || !fuData.id) return res.status(404).json({ error: 'Follow-up not found' });
    if ((fuData.fields['Traveler Email'] || '').toLowerCase() !== customerEmail.toLowerCase())
      return res.status(403).json({ error: 'Not authorized' });
    if (fuData.fields['Status'] === 'Replied')
      return res.status(400).json({ error: 'Already replied' });

    const coachEmail   = (fuData.fields['Coach Email'] || '').toLowerCase();
    const question     = fuData.fields['Question'] || '';
    const customer     = await getByEmail(customerEmail.toLowerCase());
    const customerName = customer ? (customer.fields['Traveler Name'] || customerEmail) : customerEmail;

    await at(FOLLOWUPS_TABLE, `/${followupId}`, 'PATCH', {
      fields: { 'Reply': reply, 'Replied At': new Date().toISOString(), 'Status': 'Replied' }
    });

    const body = `
      <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 16px;">${customerName.split(' ')[0]} replied to your question</h2>
      <p style="font-family:Arial,sans-serif;font-size:13px;color:#64748b;margin:0 0 8px;">Your question:</p>
      <div style="background:#f8fafc;border-left:4px solid #94a3b8;border-radius:4px;padding:12px 16px;margin:0 0 20px;">
        <p style="font-family:Arial,sans-serif;font-size:14px;color:#475569;margin:0;">${question}</p>
      </div>
      <p style="font-family:Arial,sans-serif;font-size:13px;color:#64748b;margin:0 0 8px;">Their reply:</p>
      <div style="background:#f0fdf4;border-left:4px solid #2dd4bf;border-radius:4px;padding:16px 20px;margin:0 0 28px;">
        <p style="font-family:Georgia,serif;font-size:15px;color:#0f172a;line-height:1.75;margin:0;">${reply}</p>
      </div>
      <table cellpadding="0" cellspacing="0"><tr><td>
        <a href="${PORTAL_URL}/coach-portal.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Open Coach Portal →</a>
      </td></tr></table>`;

    await sendEmail(coachEmail, `${customerName} replied to your follow-up`, emailWrap('Customer Reply', body)).catch(() => {});

    return res.status(200).json({ success: true });
  }

  // ── POST tip-override — coach sets tomorrow's daily tip ──────────────────
  if (req.method === 'POST' && action === 'tip-override') {
    const { coachEmail, tripId, tipText } = req.body || {};
    if (!coachEmail || !tripId) return res.status(400).json({ error: 'coachEmail and tripId required' });

    const tripData = await at(TRIPS_TABLE, `/${tripId}`);
    if (tripData.error || !tripData.id) return res.status(404).json({ error: 'Trip not found' });

    const custEmail = (tripData.fields['Traveler Email'] || '').toLowerCase();
    const customer  = await getByEmail(custEmail);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    if ((customer.fields['Coach Email'] || '').toLowerCase() !== coachEmail.toLowerCase())
      return res.status(403).json({ error: 'Not authorized' });

    // 9 PM cutoff in destination timezone
    const tz        = tripData.fields['Time Zone'] || 'UTC';
    const localHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
    if (localHour >= 21) {
      return res.status(400).json({
        error: 'Past 9 PM cutoff in destination timezone. Tip locked until tomorrow.'
      });
    }

    await at(TRIPS_TABLE, `/${tripId}`, 'PATCH', {
      fields: { 'Coach Tip Override': tipText || '' }
    });

    return res.status(200).json({ success: true, cleared: !tipText });
  }

  return res.status(400).json({ error: 'Unknown action' });

  } catch(e) {
    console.error('coach handler error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
