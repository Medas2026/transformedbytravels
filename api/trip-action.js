const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE   = 'Trips';
const TRAVEL_TABLE  = 'Traveler';
const EMAILS_TABLE  = 'Emails';
const PORTAL_URL    = 'https://app.transformedbytravels.com';

const TIMEZONE_MAP = {
  'Eastern Time (ET)':           'America/New_York',
  'Central Time (CT)':           'America/Chicago',
  'Mountain Time (MT)':          'America/Denver',
  'Pacific Time (PT)':           'America/Los_Angeles',
  'Alaska Time (AKT)':           'America/Anchorage',
  'Hawaii Time (HT)':            'Pacific/Honolulu',
  'London (GMT/BST)':            'Europe/London',
  'Central European (CET/CEST)': 'Europe/Paris'
};

// ── Helpers ──────────────────────────────────────────────────────

function localDateStr(tzName) {
  const tz = TIMEZONE_MAP[tzName] || 'UTC';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

function dateOffsetStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function fetchTripPlaces(tripId) {
  try {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const filter = encodeURIComponent(`({Trip ID}="${tripId}")`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Trip Places')}?filterByFormula=${filter}&sort[0][field]=Day&sort[0][direction]=asc`;
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey } });
    const data = await resp.json();
    return (data.records || []).map(r => r.fields['Place'] || '').filter(Boolean);
  } catch(e) {
    console.error('[fetchTripPlaces]', e.message);
    return [];
  }
}

async function generatePostTripSummary(name, tripName, entriesText) {
  try {
    const prompt = `You are a warm travel coach for Transformed by Travels. A traveler named ${name} has just returned from their trip to ${tripName}. Below are their daily journal entries. Write a warm, personal 3-paragraph summary of their journey — what they experienced, what they noticed about themselves, and a forward-looking thought about how this trip may continue to shape them. Speak directly to "${name}" as "you". Be specific to what they actually wrote — never generic.

Journal entries:
${entriesText}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages:   [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    return (data.content && data.content[0] && data.content[0].text) || '';
  } catch(e) {
    console.error('[generatePostTripSummary]', e.message);
    return '';
  }
}

async function generateTripSummary(destination, country, places, startDate, endDate) {
  try {
    const loc      = [destination, country].filter(Boolean).join(', ');
    const placeStr = places.length ? places.join(', ') : loc;
    const dateStr  = (startDate && endDate) ? `from ${startDate} to ${endDate}` : (startDate ? `starting ${startDate}` : '');
    const prompt   = `You are a warm travel coach for Transformed by Travels. Write exactly 2 inspiring, personal sentences about an upcoming trip to ${loc} ${dateStr}, visiting ${placeStr}. Focus on the transformational potential and excitement of the journey. Speak directly to "you". No bullet points or headers.`;
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages:   [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    return (data.content && data.content[0] && data.content[0].text) || '';
  } catch(e) {
    console.error('[generateTripSummary]', e.message);
    return '';
  }
}

async function buildPendingInvitesBlock(tripId, headers) {
  try {
    const filter = encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Invited")`);
    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Trip Members')}?filterByFormula=${filter}`, { headers });
    const data = await resp.json();
    const pending = (data.records || []);
    if (!pending.length) return '';
    const list = pending.map(m => {
      const email = m.fields['Email'] || '';
      const role  = m.fields['Role']  || 'Invited';
      return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:5px 0;">· ${email} <span style="color:#94a3b8;font-size:12px;">(${role})</span></div>`;
    }).join('');
    return `<div style="background:#f8fafc;border-radius:12px;padding:20px 24px;margin:20px 0 8px;">
      <div style="font-family:Georgia,serif;font-size:15px;font-weight:bold;color:#0f172a;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #2dd4bf;">Pending Invitations</div>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#475569;margin:0 0 10px;">These travelers haven't responded to their invitation yet. You may want to follow up:</p>
      ${list}
    </div>`;
  } catch(e) {
    console.error('[pendingInvites]', e.message);
    return '';
  }
}

function tripDetailsBlock(destination, country, startDate, endDate, places) {
  const loc  = [destination, country].filter(Boolean).join(', ');
  const rows = [
    ['Destination', loc],
    ['Start Date',  startDate],
    ['End Date',    endDate]
  ].filter(([, v]) => v).map(([label, value]) =>
    `<tr>
      <td style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;padding:8px 20px 8px 0;vertical-align:top;white-space:nowrap;">${label}</td>
      <td style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:8px 0;line-height:1.5;">${value}</td>
    </tr>`
  ).join('');

  const placesHtml = places.length
    ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;">
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Places</div>
        ${places.map((p, i) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:3px 0;">${i + 1}. ${p}</div>`).join('')}
      </div>`
    : '';

  return `<div style="background:#f8fafc;border-radius:12px;padding:24px 28px;margin:8px 0 24px;">
    <div style="font-family:Georgia,serif;font-size:16px;font-weight:bold;color:#0f172a;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #2dd4bf;">Your Trip Details</div>
    <table cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>
    ${placesHtml}
  </div>`;
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
        callback(null, { subject: f['Subject'] || '', p1: f['Paragraph 1'] || '', p2: f['Paragraph 2'] || '', p3: f['Paragraph 3'] || '', coTraveler: !!f['Co-Traveler'] });
      } catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

function substitute(text, vars) {
  if (!text) return '';
  const lowerVars = {};
  Object.keys(vars).forEach(k => { lowerVars[k.toLowerCase()] = vars[k]; });
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key] !== undefined ? vars[key] : lowerVars[key.toLowerCase()];
    return val !== undefined ? val : '{' + key + '}';
  });
}

function airtableRequest(method, table, path, body, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = body ? JSON.stringify(body) : '';
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`,
    method:   method,
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
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  if (bodyStr) req.write(bodyStr);
  req.end();
}

function sendEmail(to, name, subject, html, callback) {
  const apiKey  = process.env.RESEND_API_KEY;
  const body    = JSON.stringify({ from: 'TravelForGrowth@transformedbytravels.com', to, subject, html });
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
    let data = '';
    resend.on('data', chunk => { data += chunk; });
    resend.on('end', () => {
      console.log('[sendEmail] Resend status:', resend.statusCode, 'body:', data);
      callback(null);
    });
  });
  req.on('error', e => { console.error('[sendEmail] HTTPS error:', e.message); callback(e); });
  req.write(body);
  req.end();
}

function emailHTML(title, heading, body, btnText, btnUrl, photoUrl) {
  const btn = btnText && btnUrl
    ? `<tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="${btnUrl}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">${btnText}</a>
      </td></tr>`
    : `<tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="${PORTAL_URL}/portal.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Go to My Portal</a>
      </td></tr>`;
  const photoRow = photoUrl
    ? `<tr><td style="padding:0;"><img src="${photoUrl}" alt="" style="width:100%;max-height:220px;object-fit:cover;display:block;" /></td></tr>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
${photoRow}
<tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
<img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" /></td></tr>
<tr><td style="padding:36px 40px;">
<h2 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 16px;">${heading}</h2>
<div style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;">${body}</div>
</td></tr>
${btn}
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr></table></td></tr></table></body></html>`;
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET ?action=reminders — daily cron: 3-day, 1-day, same-day activation nudges
  // GET ?action=debug-reminders — returns what trips the cron would find, without sending emails
  if (req.method === 'GET' && req.query.action === 'debug-reminders') {
    const todayStr     = dateOffsetStr(0);
    const tomorrowStr  = dateOffsetStr(1);
    const threeDayStr  = dateOffsetStr(3);
    const yesterdayStr = dateOffsetStr(-1);
    const results = { dates: { today: todayStr, tomorrow: tomorrowStr, threeDays: threeDayStr, yesterday: yesterdayStr }, sameDay: [], oneDay: [], threeDay: [], postTrip: [] };
    let pending = 4;
    const finish = () => { if (--pending === 0) res.status(200).json(results); };
    const f1 = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${todayStr}")`);
    const f2 = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${tomorrowStr}")`);
    const f3 = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${threeDayStr}")`);
    const f4 = encodeURIComponent(`AND(OR({Status of Trip}="Active",{Status of Trip}="Completed"),DATESTR({End Date})="${yesterdayStr}")`);
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${f1}`, null, (e, d) => { results.sameDay  = d || { error: e && e.message }; finish(); });
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${f2}`, null, (e, d) => { results.oneDay   = d || { error: e && e.message }; finish(); });
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${f3}`, null, (e, d) => { results.threeDay = d || { error: e && e.message }; finish(); });
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${f4}`, null, (e, d) => { results.postTrip = d || { error: e && e.message }; finish(); });
    return;
  }

  if (req.method === 'GET' && req.query.action === 'reminders') {
    const todayStr      = dateOffsetStr(0);
    const tomorrowStr   = dateOffsetStr(1);
    const threeDayStr   = dateOffsetStr(3);
    const yesterdayStr  = dateOffsetStr(-1);

    let completed = 0;
    const done = () => { if (++completed === 4) res.status(200).json({ success: true }); };

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const headers = { 'Authorization': 'Bearer ' + apiKey };

    async function fetchTravelerName(email) {
      try {
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRAVEL_TABLE)}?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`, { headers });
        const d = await r.json();
        const rec = (d.records || [])[0];
        return rec ? (rec.fields['Traveler Name'] || 'Traveler') : 'Traveler';
      } catch(e) { return 'Traveler'; }
    }

    function sendEmailAsync(to, name, subject, html) {
      return new Promise(resolve => sendEmail(to, name, subject, html, resolve));
    }

    async function fetchTemplateAsync(code) {
      try {
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(EMAILS_TABLE)}?filterByFormula=${encodeURIComponent(`({Code}="${code}")`)}`, { headers });
        const d = await r.json();
        const rec = (d.records || [])[0];
        if (!rec) return null;
        const f = rec.fields;
        return { subject: f['Subject'] || '', p1: f['Paragraph 1'] || '', p2: f['Paragraph 2'] || '', p3: f['Paragraph 3'] || '' };
      } catch(e) { return null; }
    }

    // ── 1. Same-day nudge: trip starts today, not yet activated ───────
    (async () => {
      try {
        const formula = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${todayStr}")`);
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}?filterByFormula=${formula}`, { headers });
        const data = await r.json();
        for (const rec of (data.records || [])) {
          const f = rec.fields;
          const email = f['Traveler Email'];
          if (!email) continue;
          const tripName    = f['Trip Name'] || f['Destination'] || 'your trip';
          const activateUrl = `${PORTAL_URL}/portal.html?page=my-trip`;
          const name        = await fetchTravelerName(email);
          const subject     = `Today is the day — activate your trip to ${tripName}!`;
          const html        = emailHTML(subject, `Your trip starts today, ${name}!`,
            `<p>Your trip to <strong>${tripName}</strong> begins today. Don't forget to activate it in your portal so your daily journal reminders and trip support can begin.</p>`,
            'Activate My Trip →', activateUrl);
          await sendEmailAsync(email, name, subject, html);
          const coEmail = (f['Co-Traveler Email'] || '').trim();
          if (coEmail) await sendEmailAsync(coEmail, name, subject, html);
          console.log('[same-day] sent to', email, tripName);
        }
      } catch(e) { console.error('[same-day]', e.message); }
      done();
    })();

    // ── 2. One-day reminder: starts tomorrow ──────────────────────────
    (async () => {
      try {
        const formula = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${tomorrowStr}")`);
        const [tripsResp, tmpl] = await Promise.all([
          fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}?filterByFormula=${formula}`, { headers }),
          fetchTemplateAsync('TRIP_REMINDER_1DAY')
        ]);
        const data = await tripsResp.json();
        for (const rec of (data.records || [])) {
          const f           = rec.fields;
          const email       = f['Traveler Email'];
          if (!email) continue;
          const destination = f['Destination'] || '';
          const country     = f['Country']     || '';
          const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
          const startDate   = f['Start Date']  || tomorrowStr;
          const photoUrl    = f['Trip Photo URL'] || '';
          const coEmail     = (f['Co-Traveler Email'] || '').trim();
          const activateUrl = `${PORTAL_URL}/portal.html?page=my-trip`;
          const name        = await fetchTravelerName(email);
          const vars        = { name, tripName, destination, country, startDate };
          const para        = text => text ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${substitute(text, vars).replace(/\n/g, '<br>')}</p>` : '';
          let subject, bodyContent;
          if (tmpl) {
            subject     = substitute(tmpl.subject, vars) || `Your trip to ${tripName} starts tomorrow!`;
            bodyContent = para(tmpl.p1) + para(tmpl.p2) + para(tmpl.p3);
          } else {
            subject     = `Your trip to ${tripName} starts tomorrow!`;
            bodyContent = `<p>Just a reminder — your trip to <strong>${tripName}</strong> begins tomorrow. Activate it in your portal to start your daily journal reminders.</p>`;
          }
          const pendingBlock1 = await buildPendingInvitesBlock(rec.id, headers);
          const html = emailHTML(subject, subject, bodyContent + pendingBlock1, 'Start My Trip →', activateUrl, photoUrl);
          await sendEmailAsync(email, name, subject, html);
          if (coEmail) await sendEmailAsync(coEmail, name, subject, html);
          console.log('[1-day] sent to', email, tripName);
        }
      } catch(e) { console.error('[1-day]', e.message); }
      done();
    })();

    // ── 3. Three-day notice ───────────────────────────────────────────
    (async () => {
      try {
        const formula = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${threeDayStr}")`);
        const [tripsResp, tmpl] = await Promise.all([
          fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}?filterByFormula=${formula}`, { headers }),
          fetchTemplateAsync('TRIP_REMINDER_3DAY')
        ]);
        const data = await tripsResp.json();
        for (const rec of (data.records || [])) {
          const f           = rec.fields;
          const email       = f['Traveler Email'];
          if (!email) continue;
          const destination = f['Destination'] || '';
          const country     = f['Country']     || '';
          const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
          const startDate   = f['Start Date']  || threeDayStr;
          const photoUrl    = f['Trip Photo URL'] || '';
          const coEmail     = (f['Co-Traveler Email'] || '').trim();
          const activateUrl = `${PORTAL_URL}/portal.html?page=my-trip`;
          const name        = await fetchTravelerName(email);
          const vars        = { name, tripName, destination, country, startDate };
          const para        = text => text ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${substitute(text, vars).replace(/\n/g, '<br>')}</p>` : '';
          let subject, bodyContent;
          if (tmpl) {
            subject     = substitute(tmpl.subject, vars) || `Your trip to ${tripName} is in 3 days!`;
            bodyContent = para(tmpl.p1) + para(tmpl.p2) + para(tmpl.p3);
          } else {
            subject     = `Your trip to ${tripName} is in 3 days!`;
            bodyContent = `<p>Your trip to <strong>${tripName}</strong> starts on <strong>${startDate}</strong> — just 3 days away! Head to your portal to activate it.</p>`;
          }
          const pendingBlock3 = await buildPendingInvitesBlock(rec.id, headers);
          const html = emailHTML(subject, subject, bodyContent + pendingBlock3, 'Start My Trip →', activateUrl, photoUrl);
          await sendEmailAsync(email, name, subject, html);
          if (coEmail) await sendEmailAsync(coEmail, name, subject, html);
          console.log('[3-day] sent to', email, tripName);
        }
      } catch(e) { console.error('[3-day]', e.message); }
      done();
    })();

    // ── 4. Post-trip summary: trip ended yesterday ────────────────────
    const postTripFormula = encodeURIComponent(
      `AND(OR({Status of Trip}="Active",{Status of Trip}="Completed"),DATESTR({End Date})="${yesterdayStr}")`
    );
    (async () => {
      try {
        const apiKey  = process.env.AIRTABLE_API_KEY;
        const headers = { 'Authorization': 'Bearer ' + apiKey };

        const tripsResp = await fetch(
          `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}?filterByFormula=${postTripFormula}`,
          { headers }
        );
        const tripsData = await tripsResp.json();

        for (const r of (tripsData.records || [])) {
          const f     = r.fields;
          const email = f['Traveler Email'];
          if (!email) continue;

          const destination = f['Destination'] || '';
          const country     = f['Country']     || '';
          const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
          const startDate   = f['Start Date']  || '';
          const endDate     = f['End Date']    || yesterdayStr;
          const coEmail     = (f['Co-Traveler Email'] || '').trim();

          const travFilter    = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
          const journalFilter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${r.id}")`)}` +
                                `&sort[0][field]=Entry%20Date&sort[0][direction]=asc`;

          const [travResp, journalResp] = await Promise.all([
            fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRAVEL_TABLE)}${travFilter}`, { headers }),
            fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Journal Entries')}${journalFilter}`, { headers })
          ]);
          const [travData, journalData] = await Promise.all([travResp.json(), journalResp.json()]);

          const travRec = (travData.records || [])[0];
          const name    = travRec ? (travRec.fields['Traveler Name'] || 'Traveler') : 'Traveler';
          const entries = (journalData.records || []).filter(e => e.fields['Reflection'] || e.fields['Best Memory']);

          let summaryHtml = '';
          if (entries.length > 0) {
            const entriesText = entries.map((e, i) => {
              const ef    = e.fields;
              const parts = [];
              if (ef['Reflection'])   parts.push(`Reflection: ${ef['Reflection']}`);
              if (ef['Barriers'])     parts.push(`Barriers: ${ef['Barriers']}`);
              if (ef['Best Memory'])  parts.push(`Best memory: ${ef['Best Memory']}`);
              return `Day ${ef['Day Number'] || (i + 1)}:\n${parts.join('\n')}`;
            }).join('\n\n');

            const summaryText = await generatePostTripSummary(name, tripName, entriesText);
            summaryHtml = summaryText.split('\n').filter(l => l.trim()).map(line =>
              `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${line.trim()}</p>`
            ).join('');
          }

          const subject = `Your journey to ${tripName} — a reflection`;
          const portalUrl = `${PORTAL_URL}/portal.html`;
          const html = emailHTML(subject, `Welcome home, ${name}!`,
            `<p>Your trip to <strong>${tripName}</strong>${startDate ? ` (${startDate} – ${endDate})` : ''} is now complete. Here's a reflection on your journey:</p>
             ${summaryHtml || `<p>What an incredible journey — we hope it was everything you imagined and more.</p>`}
             <p>Now is the perfect time to complete your <strong>Integration Workshop</strong> to capture the lasting insights from your travels.</p>`,
            'Start Integration Workshop →', portalUrl + '?page=integration'
          );

          sendEmail(email, name, subject, html, () => {});
          if (coEmail) sendEmail(coEmail, name, subject, html, () => {});
          console.log('[post-trip summary] sent to', email, tripName);
        }
      } catch(e) {
        console.error('[post-trip summary]', e.message);
      }
      done();
    })();

    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b      = req.body || {};
  const action = (b.action || '').slice(0, 50);
  const tripId = (b.tripId || '').slice(0, 100);
  const email  = (b.email  || '').toLowerCase().trim().slice(0, 200);

  if (!action || !tripId || !email) return res.status(400).json({ error: 'action, tripId, email required' });

  // ── Journey Book link email ───────────────────────────────────────────────
  if (action === 'journey-book') {
    const bookUrl  = `${PORTAL_URL}/journey-book.html?tripId=${tripId}`;
    const subject  = 'Your Journey Book is ready to build';
    const html     = emailHTML(
      subject,
      'Build Your Journey Book',
      `<p>Your trip photos, reflections, and memories are ready to be turned into a beautiful 10×10 Journey Book.</p>
       <p>Click the button below to start building — add your photos, adjust the layout, and let AI help you capture your story in words. It only takes a few minutes per day.</p>
       <p style="font-size:13px;color:#94a3b8;">You can return to this link anytime — your progress is saved automatically.</p>`,
      'Build My Journey Book →',
      bookUrl,
      null
    );
    return new Promise(resolve => {
      sendEmail(email, email, subject, html, (err) => {
        if (err) { res.status(500).json({ error: err.message }); }
        else     { res.status(200).json({ ok: true }); }
        resolve();
      });
    });
  }

  const today  = new Date().toISOString().split('T')[0];
  const status = action === 'start' ? 'Active' : 'Completed';

  const fields = { 'Status of Trip': status };
  if (action === 'start') {
    fields['Activation Date']  = today;
    fields['Start Date']       = today;
    fields['Journal Enabled']  = b.journalEnabled !== false;
    if (b.journalEnabled !== false) {
      if (b.journalTime) fields['Journal Time'] = String(b.journalTime);
      if (b.timezone)    fields['Time Zone']    = b.timezone;
    }
  }
  if (action === 'end') {
    fields['End Date'] = today;
    if (b.tripRating) fields['Trip Rating'] = b.tripRating;
  }

  console.log('[trip-action start] fields being patched:', JSON.stringify(fields));
  airtableRequest('PATCH', TRIPS_TABLE, `/${tripId}`, { fields }, (err, tripData) => {
    if (err) return res.status(500).json({ error: err.message });
    if (tripData.error) return res.status(500).json({ error: tripData.error });

    const f               = tripData.fields || {};
    const destination     = f['Destination']       || 'your destination';
    const country         = f['Country']           || '';
    const tripName        = f['Trip Name']         || (destination + (country ? ', ' + country : ''));
    const startDate       = f['Start Date']        || today;
    const endDate         = f['End Date']          || '';
    const coTravelerEmail = (f['Co-Traveler Email'] || '').trim();
    const tripPhotoUrl    = f['Trip Photo URL'] || '';

    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
    airtableRequest('GET', TRAVEL_TABLE, filter, null, (err2, travelerData) => {
      const travelerRecord = travelerData && travelerData.records && travelerData.records[0];
      const name = travelerRecord ? (travelerRecord.fields['Traveler Name'] || 'Traveler') : 'Traveler';

      if (action === 'start' && b.phone && travelerRecord) {
        airtableRequest('PATCH', TRAVEL_TABLE, `/${travelerRecord.id}`, { fields: { 'Phone Number': b.phone } }, () => {});
      }

      if (action === 'end' && b.tripSummary) {
        const summaryFields = {
          'Traveler Email': email,
          'Entry Date':     today,
          'Entry Time':     new Date().toISOString().split('T')[1].substring(0, 5) + ' UTC',
          'Reflection':     b.tripSummary,
          'Entry Type':     'Trip Summary'
        };
        if (tripId) summaryFields['Trip ID'] = tripId;
        airtableRequest('POST', 'Journal Entries', '', { fields: summaryFields }, () => {});
      }

      if (action === 'start') {
        // Fetch places + generate Claude summary, then send rich activation email
        (async () => {
          const places  = await fetchTripPlaces(tripId);
          const summary = await generateTripSummary(destination, country, places, startDate, endDate);
          const details = tripDetailsBlock(destination, country, startDate, endDate, places);
          const summaryHtml = summary
            ? summary.split('\n').map(line => {
                const h = line.match(/^#+\s*(.+)/);
                if (h) return `<h3 style="font-family:Georgia,serif;font-size:16px;font-weight:bold;color:#0f172a;margin:0 0 8px;">${h[1]}</h3>`;
                return line.trim() ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.75;margin:0 0 18px;">${line.trim()}</p>` : '';
              }).join('')
            : '';
          const subject = `Your trip to ${tripName} has begun!`;
          const html = emailHTML(subject, `Bon Voyage, ${name}!`,
            `<p>Your trip to <strong>${tripName}</strong> is now underway. Your daily journal support has started — look for your first reflection prompt.</p>
             ${details}${summaryHtml}
             <p>Safe travels — we hope this journey transforms you!</p>`,
            null, null, tripPhotoUrl);
          sendEmail(email, name, subject, html, () => {
            if (coTravelerEmail) sendEmail(coTravelerEmail, name, subject, html, () => {});
            res.status(200).json({ success: true, action, tripName });
          });
        })().catch(err => {
          console.error('[start email]', err.message);
          res.status(200).json({ success: true, action, tripName });
        });

      } else {
        // End trip email (unchanged)
        const subject = `Welcome home from ${tripName}!`;
        const html = emailHTML(subject, `Welcome Home, ${name}!`,
          `<p>Your trip to <strong>${tripName}</strong> is now complete.</p>
           <p>We hope it was everything you imagined and more. Head to your portal to begin your Integration Workshop and capture the insights from your journey while they're still fresh.</p>`);
        sendEmail(email, name, subject, html, () => {
          if (coTravelerEmail) sendEmail(coTravelerEmail, name, subject, html, () => {});
          res.status(200).json({ success: true, action, tripName });
        });
      }
    });
  });
};
