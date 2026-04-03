const https             = require('https');
const sendTemplateEmail = require('./template-email');

const BASE_ID      = 'appdlxcWb45dIqNK2';
const TABLE_NAME   = 'Trips';
const EMAILS_TABLE = 'Emails';
const PORTAL_URL   = 'https://app.transformedbytravels.com';

async function fetchTripPlaces(tripId) {
  try {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const filter = encodeURIComponent(`({Trip ID}="${tripId}")`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Trip Places')}?filterByFormula=${filter}&sort[0][field]=Day&sort[0][direction]=asc`;
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey } });
    const data = await resp.json();
    return (data.records || []).map(r => r.fields['Place'] || '').filter(Boolean);
  } catch(e) { console.error('[fetchTripPlaces]', e.message); return []; }
}

async function generateTripSummary(destination, country, places, startDate, endDate) {
  try {
    const loc      = [destination, country].filter(Boolean).join(', ');
    const placeStr = places.length ? places.join(', ') : loc;
    const dateStr  = (startDate && endDate) ? `from ${startDate} to ${endDate}` : '';
    const prompt   = `You are a warm travel coach for Transformed by Travels. Write exactly 2 inspiring, personal sentences about an upcoming trip to ${loc} ${dateStr}, visiting ${placeStr}. Focus on the transformational potential and excitement. Speak directly to "you". No bullet points.`;
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await resp.json();
    return (data.content && data.content[0] && data.content[0].text) || '';
  } catch(e) { console.error('[generateTripSummary]', e.message); return ''; }
}

function buildTripDetailsBlock(destination, country, startDate, endDate, places) {
  const loc  = [destination, country].filter(Boolean).join(', ');
  const rows = [['Destination', loc], ['Start Date', startDate], ['End Date', endDate]]
    .filter(([, v]) => v)
    .map(([label, value]) =>
      `<tr><td style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;padding:8px 20px 8px 0;vertical-align:top;white-space:nowrap;">${label}</td>
       <td style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:8px 0;">${value}</td></tr>`
    ).join('');
  const placesHtml = places.length
    ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;">
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Places</div>
        ${places.map((p, i) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:3px 0;">${i + 1}. ${p}</div>`).join('')}
      </div>` : '';
  return `<div style="background:#f8fafc;border-radius:12px;padding:24px 28px;margin:8px 0 24px;">
    <div style="font-family:Georgia,serif;font-size:16px;font-weight:bold;color:#0f172a;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #2dd4bf;">Your Trip Details</div>
    <table cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>${placesHtml}
  </div>`;
}

function buildEmailHTML(title, heading, body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
<img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" /></td></tr>
<tr><td style="padding:36px 40px;">
<h2 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 16px;">${heading}</h2>
<div style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;">${body}</div>
</td></tr>
<tr><td style="padding:0 40px 40px;text-align:center;">
<a href="${PORTAL_URL}/portal.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Go to My Portal</a>
</td></tr>
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function sendResendEmail(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY;
  const body   = JSON.stringify({ from: 'YourResults@transformedbytravels.com', to, subject, html });
  const resp   = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body
  });
  return resp.json();
}

function airtableRequest(method, path, body, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = { 'Authorization': 'Bearer ' + apiKey };
  if (bodyStr) {
    headers['Content-Type']   = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${path}`,
    method:   method,
    headers
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log('[airtableRequest]', method, path, 'status:', res.statusCode, 'body:', data.slice(0, 200));
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch(e) { callback(e); }
    });
  });

  req.on('error', callback);
  if (bodyStr) req.write(bodyStr);
  req.end();
}

function fetchTemplate(code, callback) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const filter = `?filterByFormula=${encodeURIComponent(`({Code}="${code}")`)}`;
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(EMAILS_TABLE)}${filter}`,
    method:   'GET',
    headers:  { 'Authorization': 'Bearer ' + apiKey }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const record = (parsed.records || [])[0];
        if (!record) return callback(new Error('Template not found: ' + code));
        const f = record.fields;
        callback(null, { subject: f['Subject'] || '', p1: f['Paragraph 1'] || '', p2: f['Paragraph 2'] || '', p3: f['Paragraph 3'] || '' });
      } catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

function substitute(text, vars) {
  if (!text) return '';
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : '{' + key + '}');
}

function sendTripHistoryEmail(email, name, b, done) {
  const dest    = b.destination || '';
  const country = b.country ? ', ' + b.country : '';
  const subject = `Your past trip to ${dest} has been added to your account.`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
        <img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" />
      </td></tr>
      <tr><td style="padding:36px 40px 28px;">
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">Hi ${name || email},</p>
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">Your past trip to <strong>${dest}${country}</strong> has been added to your Travel Story.</p>
      </td></tr>
      <tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="https://transformedbytravels.vercel.app/portal.html"
           style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">
          View My Travel Story
        </a>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const apiKey = process.env.RESEND_API_KEY;
  const body   = JSON.stringify({ from: 'YourResults@transformedbytravels.com', to: email, subject, html });
  const options = {
    hostname: 'api.resend.com',
    path:     '/emails',
    method:   'POST',
    headers: {
      'Authorization':  'Bearer ' + apiKey,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  const req = https.request(options, (resend) => {
    resend.on('data', () => {});
    resend.on('end', () => done());
  });
  req.on('error', e => { console.error('Trip history email error:', e.message); done(); });
  req.write(body);
  req.end();
}

function sendTripPlanEmail(email, name, b, done) {
  const vars = { name: name || email, destination: b.destination || '', country: b.country || '' };
  fetchTemplate('TRIP_PLAN', (err, tmpl) => {
    if (err) { console.error('Trip plan template error:', err.message); return done(); }

    const subject = substitute(tmpl.subject, vars) || `Your trip to ${b.destination} is planned!`;
    const para = text => text
      ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${substitute(text, vars).replace(/\n/g, '<br>')}</p>`
      : '';

    // Build trip detail rows — only include populated fields
    const places = [b.place1, b.place2, b.place3, b.place4, b.place5, b.place6, b.place7].filter(Boolean);
    const rows = [
      ['Trip Name',   b.tripName],
      ['Destination', b.destination + (b.country ? ', ' + b.country : '')],
      ['Start Date',  b.startDate],
      ['End Date',    b.endDate],
      ['Airport',     b.airportCode || b.airport],
      ['Notes',       b.notes],
      ...places.map((p, i) => ['Place ' + (i + 1), p])
    ].filter(([, v]) => v);

    const tableRows = rows.map(([label, value]) =>
      `<tr>
        <td style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;padding:8px 20px 8px 0;vertical-align:top;white-space:nowrap;">${label}</td>
        <td style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:8px 0;line-height:1.5;">${value}</td>
      </tr>`
    ).join('');

    const tripBlock = `
      <div style="background:#f8fafc;border-radius:12px;padding:24px 28px;margin:8px 0 24px;">
        <div style="font-family:Georgia,serif;font-size:16px;font-weight:bold;color:#0f172a;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #2dd4bf;">Your Trip Details</div>
        <table cellpadding="0" cellspacing="0" style="width:100%;">${tableRows}</table>
      </div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
        <img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" />
      </td></tr>
      <tr><td style="padding:36px 40px 28px;">
        ${para(tmpl.p1)}${para(tmpl.p2)}${para(tmpl.p3)}
        ${tripBlock}
      </td></tr>
      <tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="https://transformedbytravels.vercel.app/portal.html"
           style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">
          Go to My Portal
        </a>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    const apiKey = process.env.RESEND_API_KEY;
    const body   = JSON.stringify({ from: 'YourResults@transformedbytravels.com', to: email, subject, html });
    const options = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (resend) => {
      resend.on('data', () => {});
      resend.on('end', () => done());
    });
    req.on('error', e => { console.error('Trip plan email send error:', e.message); done(); });
    req.write(body);
    req.end();
  });
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — all trips for a traveler
  if (req.method === 'GET') {
    const email = ((req.query && req.query.email) || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
    airtableRequest('GET', filter, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ records: data.records || [] });
    });
    return;
  }

  const b  = req.body || {};
  const id = b.id || (req.query && req.query.id);

  // DELETE — remove a trip
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Record ID required' });
    airtableRequest('DELETE', `/${id}`, null, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ success: true });
    });
    return;
  }

  // PATCH — update a trip
  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'Record ID required' });
    const newStatus = b['Status of Trip'] || '';
    const fields = buildFields(b);
    fields['Last Modified'] = new Date().toISOString().split('T')[0];
    airtableRequest('PATCH', `/${id}`, { fields }, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });

      // Send status-change emails (fire-and-forget)
      if (newStatus === 'Committed' || newStatus === 'Active' || newStatus === 'Completed') {
        const f           = data.fields || {};
        const email       = f['Traveler Email'] || '';
        const destination = f['Destination'] || '';
        const country     = f['Country']     || '';
        const startDate   = f['Start Date']  || '';
        const endDate     = f['End Date']    || '';
        const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
        if (email) {
          if (newStatus === 'Committed') {
            // Rich committed email with places + Claude summary
            (async () => {
              const places  = await fetchTripPlaces(id);
              const summary = await generateTripSummary(destination, country, places, startDate, endDate);
              const details = buildTripDetailsBlock(destination, country, startDate, endDate, places);
              const summaryHtml = summary
                ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#2dd4bf;line-height:1.75;margin:0 0 18px;font-style:italic;">${summary}</p>`
                : '';
              const subject = `Your trip to ${tripName} is confirmed!`;
              const html = buildEmailHTML(subject, `You're committed, traveler!`,
                `<p>Your trip to <strong>${tripName}</strong> is now committed. Here's a summary of what's ahead.</p>
                 ${details}${summaryHtml}
                 <p>We'll remind you as your departure approaches. Get ready for an incredible journey!</p>`);
              await sendResendEmail(email, subject, html);
            })().catch(e => console.error('Committed email error:', e.message));
          } else {
            const vars = { name: tripName, destination, startDate, endDate };
            const templateMap = { 'Active': 'TRIP_START', 'Completed': 'TRIP_COMPLETED' };
            sendTemplateEmail(templateMap[newStatus], email, vars)
              .catch(e => console.error(newStatus + ' email error:', e.message));
          }
        }
      }

      res.status(200).json({ success: true, record: data });
    });
    return;
  }

  // POST — create a new trip
  if (req.method === 'POST') {
    const email = (b.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Check Trips Remaining on Traveler record
    const travelerFilter = `?filterByFormula=${encodeURIComponent(`({Email}="${email}")`)}`;
    const travelerOpts = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent('Traveler')}${travelerFilter}`,
      method:   'GET',
      headers:  { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY }
    };
    const https2 = require('https');
    const tReq = https2.request(travelerOpts, (tRes) => {
      let tData = '';
      tRes.on('data', c => { tData += c; });
      tRes.on('end', () => {
        try {
          const tParsed  = JSON.parse(tData);
          const tRecord  = (tParsed.records || [])[0];
          const remaining = tRecord ? Number(tRecord.fields['Trips Remaining'] || 0) : 0;
          if (tRecord && remaining <= 0 && !b.history) {
            return res.status(403).json({ error: 'No trips remaining on your plan. Please upgrade to add more trips.' });
          }
          // Decrement Trips Remaining (not for history/taken trips)
          if (tRecord && !b.history) {
            const https3 = require('https');
            const decBody = JSON.stringify({ fields: { 'Trips Remaining': Math.max(0, remaining - 1) } });
            const decOpts = {
              hostname: 'api.airtable.com',
              path:     `/v0/${BASE_ID}/${encodeURIComponent('Traveler')}/${tRecord.id}`,
              method:   'PATCH',
              headers:  { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(decBody) }
            };
            const dReq = https3.request(decOpts, () => {});
            dReq.on('error', () => {});
            dReq.write(decBody);
            dReq.end();
          }
          // Create the trip
          const today  = new Date().toISOString().split('T')[0];
          const fields = buildFields(b);
          fields['Traveler Email'] = email;
          fields['Create Date']    = today;
          fields['Last Modified']  = today;
          fields['Status of Trip'] = b['Status of Trip'] || 'Research';
          airtableRequest('POST', '', { fields }, (err, data) => {
            if (err) return res.status(500).json({ error: err.message });
            if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
            const createdStatus = fields['Status of Trip'];
            if (createdStatus === 'Committed') {
              sendTemplateEmail('TRIP_COMMITTED', email, {
                name:        b.tripName || b.destination || '',
                destination: b.destination || '',
                startDate:   b.startDate || ''
              }).catch(e => console.error('Committed email error:', e.message));
              res.status(200).json({ success: true, record: data, tripsRemaining: Math.max(0, remaining - 1) });
            } else if (b.history) {
              sendTripHistoryEmail(email, b.name || '', b, () => {
                res.status(200).json({ success: true, record: data, tripsRemaining: Math.max(0, remaining - 1) });
              });
            } else {
              sendTripPlanEmail(email, b.name || '', b, () => {
                res.status(200).json({ success: true, record: data, tripsRemaining: Math.max(0, remaining - 1) });
              });
            }
          });
        } catch(e) { res.status(500).json({ error: e.message }); }
      });
    });
    tReq.on('error', e => res.status(500).json({ error: e.message }));
    tReq.end();
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};

function buildFields(b) {
  const fields = {};
  if (b.tripName    !== undefined) fields['Trip Name']    = b.tripName;
  if (b.destination !== undefined) fields['Destination']  = b.destination;
  if (b.country     !== undefined) fields['Country']      = b.country;
  if (b.startDate) fields['Start Date'] = b.startDate;
  if (b.endDate)   fields['End Date']   = b.endDate;
  if (b.airportCode !== undefined) fields['Destination Airport'] = b.airportCode;
  if (b.notes       !== undefined) fields['Notes']        = b.notes;
  if (b.place1      !== undefined) fields['Place 1']      = b.place1;
  if (b.place2      !== undefined) fields['Place 2']      = b.place2;
  if (b.place3      !== undefined) fields['Place 3']      = b.place3;
  if (b.place4      !== undefined) fields['Place 4']      = b.place4;
  if (b.place5      !== undefined) fields['Place 5']      = b.place5;
  if (b.place6      !== undefined) fields['Place 6']      = b.place6;
  if (b.place7      !== undefined) fields['Place 7']      = b.place7;
  if (b.place1Day   !== undefined && b.place1Day !== '') fields['Day 1'] = Number(b.place1Day);
  if (b.place2Day   !== undefined && b.place2Day !== '') fields['Day 2'] = Number(b.place2Day);
  if (b.place3Day   !== undefined && b.place3Day !== '') fields['Day 3'] = Number(b.place3Day);
  if (b.place4Day   !== undefined && b.place4Day !== '') fields['Day 4'] = Number(b.place4Day);
  if (b.place5Day   !== undefined && b.place5Day !== '') fields['Day 5'] = Number(b.place5Day);
  if (b.place6Day   !== undefined && b.place6Day !== '') fields['Day 6'] = Number(b.place6Day);
  if (b.place7Day   !== undefined && b.place7Day !== '') fields['Day 7'] = Number(b.place7Day);
  if (b.journalTime          !== undefined) fields['Journal Time']    = String(b.journalTime);
  if (b.timezone             !== undefined) fields['Time Zone']       = b.timezone;
  if (b['Status of Trip']    !== undefined) fields['Status of Trip']  = b['Status of Trip'];
  if (b.dnaGuideId           !== undefined) fields['DNA Guide ID']       = b.dnaGuideId;
  if (b.coTravelerEmail      !== undefined) fields['Co-Traveler Email']  = b.coTravelerEmail;
  if (b.history              !== undefined) fields['History']            = !!b.history;
  if (b.tripRating !== undefined && b.tripRating !== '') fields['Trip Rating'] = b.tripRating;
  return fields;
}
