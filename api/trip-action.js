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
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : '{' + key + '}');
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
  const body    = JSON.stringify({ from: 'YourResults@transformedbytravels.com', to, subject, html });
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

function emailHTML(title, heading, body, btnText, btnUrl) {
  const btn = btnText && btnUrl
    ? `<tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="${btnUrl}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">${btnText}</a>
      </td></tr>`
    : `<tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="${PORTAL_URL}/portal.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Go to My Portal</a>
      </td></tr>`;

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
  if (req.method === 'GET' && req.query.action === 'reminders') {
    const todayStr      = dateOffsetStr(0);
    const tomorrowStr   = dateOffsetStr(1);
    const threeDayStr   = dateOffsetStr(3);

    let completed = 0;
    const done = () => { if (++completed === 3) res.status(200).json({ success: true }); };

    // ── 1. Same-day nudge: trip starts today, not yet activated ───────
    const sameDayFormula = encodeURIComponent(
      `AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),{Start Date}="${todayStr}")`
    );
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${sameDayFormula}`, null, (err, data) => {
      if (!err) {
        (data.records || []).forEach(r => {
          const f     = r.fields;
          const email = f['Traveler Email'];
          if (!email) return;
          const tripName = f['Trip Name'] || f['Destination'] || 'your trip';
          const activateUrl = `${PORTAL_URL}/portal.html?page=planning&tripId=${r.id}`;
          const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
          airtableRequest('GET', TRAVEL_TABLE, filter, null, (err2, travData) => {
            const rec  = travData && travData.records && travData.records[0];
            const name = rec ? (rec.fields['Traveler Name'] || 'Traveler') : 'Traveler';
            const subject = `Today is the day — activate your trip to ${tripName}!`;
            const html = emailHTML(subject, `Your trip starts today, ${name}!`,
              `<p>Your trip to <strong>${tripName}</strong> begins today. Don't forget to activate it in your portal so your daily journal reminders and trip support can begin.</p>`,
              'Activate My Trip →', activateUrl);
            sendEmail(email, name, subject, html, () => {});
            if ((f['Co-Traveler Email'] || '').trim()) {
              sendEmail(f['Co-Traveler Email'].trim(), name, subject, html, () => {});
            }
          });
        });
      }
      done();
    });

    // ── 2. One-day reminder: starts tomorrow ──────────────────────────
    const oneDayFormula = encodeURIComponent(
      `AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),{Start Date}="${tomorrowStr}")`
    );
    fetchTemplate('TRIP_REMINDER', (tmplErr, tmpl) => {
      airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${oneDayFormula}`, null, (err, data) => {
        if (!err) {
          (data.records || []).forEach(r => {
            const f           = r.fields;
            const email       = f['Traveler Email'];
            const coEmail     = (f['Co-Traveler Email'] || '').trim();
            const destination = f['Destination'] || '';
            const country     = f['Country']     || '';
            const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
            const startDate   = f['Start Date']  || tomorrowStr;
            const activateUrl = `${PORTAL_URL}/portal.html?page=planning&tripId=${r.id}`;
            if (!email) return;
            const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
            airtableRequest('GET', TRAVEL_TABLE, filter, null, (err2, travData) => {
              const rec  = travData && travData.records && travData.records[0];
              const name = rec ? (rec.fields['Traveler Name'] || 'Traveler') : 'Traveler';
              const vars = { name, tripName, destination, country, startDate };
              let subject, html;
              if (tmpl) {
                subject = substitute(tmpl.subject, vars) || `Your trip to ${tripName} starts tomorrow!`;
                const para = text => text
                  ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${substitute(text, vars).replace(/\n/g, '<br>')}</p>`
                  : '';
                html = emailHTML(subject, subject,
                  para(tmpl.p1) + para(tmpl.p2) + para(tmpl.p3) +
                  `<p style="margin:20px 0 0;">Ready to go? Activate your trip now to start your daily journey support.</p>`,
                  'Activate My Trip →', activateUrl);
              } else {
                subject = `Your trip to ${tripName} starts tomorrow!`;
                html = emailHTML(subject, subject,
                  `<p>Just a reminder — your trip to <strong>${tripName}</strong> begins tomorrow. Activate it in your portal to start your daily journal reminders.</p>`,
                  'Activate My Trip →', activateUrl);
              }
              sendEmail(email, name, subject, html, () => {});
              if (coEmail && tmpl && tmpl.coTraveler) sendEmail(coEmail, name, subject, html, () => {});
            });
          });
        }
        done();
      });
    });

    // ── 3. Three-day notice: you can activate early ───────────────────
    const threeDayFormula = encodeURIComponent(
      `AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),{Start Date}="${threeDayStr}")`
    );
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${threeDayFormula}`, null, (err, data) => {
      if (!err) {
        (data.records || []).forEach(r => {
          const f           = r.fields;
          const email       = f['Traveler Email'];
          const coEmail     = (f['Co-Traveler Email'] || '').trim();
          const destination = f['Destination'] || '';
          const country     = f['Country']     || '';
          const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
          const startDate   = f['Start Date']  || threeDayStr;
          const activateUrl = `${PORTAL_URL}/portal.html?page=planning&tripId=${r.id}`;
          if (!email) return;
          const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
          airtableRequest('GET', TRAVEL_TABLE, filter, null, (err2, travData) => {
            const rec  = travData && travData.records && travData.records[0];
            const name = rec ? (rec.fields['Traveler Name'] || 'Traveler') : 'Traveler';
            const subject = `Your trip to ${tripName} is in 3 days — you can activate now!`;
            const html = emailHTML(subject, `Almost time, ${name}!`,
              `<p>Your trip to <strong>${tripName}</strong> starts on <strong>${startDate}</strong> — just 3 days away!</p>
               <p>You can activate your trip now to get your daily journal support started early. Use the button below to head to your portal.</p>`,
              'Activate My Trip →', activateUrl);
            sendEmail(email, name, subject, html, () => {});
            if (coEmail) sendEmail(coEmail, name, subject, html, () => {});
          });
        });
      }
      done();
    });

    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b      = req.body || {};
  const action = b.action;
  const tripId = b.tripId;
  const email  = (b.email || '').toLowerCase().trim();

  if (!action || !tripId || !email) return res.status(400).json({ error: 'action, tripId, email required' });

  const today  = new Date().toISOString().split('T')[0];
  const status = action === 'start' ? 'Active' : 'Completed';

  const fields = { 'Status of Trip': status };
  if (action === 'start') {
    fields['Activation Date']  = today;
    fields['Start Date']       = today;
    fields['Journal Enabled']  = b.journalEnabled !== false;
    if (b.journalEnabled !== false) {
      if (b.journalTime) fields['Journal Time'] = Number(b.journalTime);
      if (b.timezone)    fields['Time Zone']    = b.timezone;
    }
  }
  if (action === 'end') fields['End Date'] = today;

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
             <p>Safe travels — we hope this journey transforms you!</p>`);
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
