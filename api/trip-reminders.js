const https = require('https');

const BASE_ID     = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE = 'Trips';

function airtableRequest(path, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}${path}`,
    method:   'GET',
    headers:  { 'Authorization': 'Bearer ' + apiKey }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

function sendEmail(to, subject, html) {
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
  const req = https.request(options, () => {});
  req.on('error', () => {});
  req.write(body);
  req.end();
}

function emailHTML(heading, body) {
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
<a href="https://transformedbytravels.vercel.app/portal.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Go to My Portal</a>
</td></tr>
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr></table></td></tr></table></body></html>`;
}

module.exports = async function handler(req, res) {
  // Allow GET (cron) or POST (manual trigger)
  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const fmt = d => d.toISOString().split('T')[0];
  const todayStr    = fmt(today);
  const tomorrowStr = fmt(tomorrow);

  // Find Planning trips starting tomorrow or today
  const formula = encodeURIComponent(
    `AND({Status of Trip}="Planning", OR({Start Date}="${tomorrowStr}", {Start Date}="${todayStr}"))`
  );

  airtableRequest(`?filterByFormula=${formula}`, (err, data) => {
    if (err) return res.status(500).json({ error: err.message });

    const records = data.records || [];
    let sent = 0;

    records.forEach(r => {
      const f           = r.fields;
      const email       = f['Traveler Email'];
      const destination = f['Destination'] || 'your destination';
      const country     = f['Country']     || '';
      const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
      const startDate   = f['Start Date'];

      if (!email) return;

      const isTomorrow = startDate === tomorrowStr;
      const heading    = isTomorrow
        ? `Your trip to ${tripName} starts tomorrow!`
        : `Your trip to ${tripName} starts today!`;
      const body = isTomorrow
        ? `<p>Just a reminder — your trip to <strong>${tripName}</strong> begins tomorrow.</p>
           <p>Log in to your portal to review your plans and make any last-minute notes before you go!</p>`
        : `<p>Today's the day! Your trip to <strong>${tripName}</strong> is starting.</p>
           <p>Head to your portal to officially start your trip and activate your journey experience.</p>`;

      sendEmail(email, heading, emailHTML(heading, body));
      sent++;
    });

    res.status(200).json({ success: true, checked: records.length, sent });
  });
};
