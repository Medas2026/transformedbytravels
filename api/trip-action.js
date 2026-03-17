const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE   = 'Trips';
const TRAVEL_TABLE  = 'Traveler';

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
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => { callback(null); });
  });
  req.on('error', callback);
  req.write(body);
  req.end();
}

function emailHTML(title, heading, body) {
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

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b      = req.body || {};
  const action = b.action; // 'start' or 'end'
  const tripId = b.tripId;
  const email  = (b.email || '').toLowerCase().trim();

  if (!action || !tripId || !email) return res.status(400).json({ error: 'action, tripId, email required' });

  const today  = new Date().toISOString().split('T')[0];
  const status = action === 'start' ? 'Active' : 'Completed';

  // Update trip status
  const fields = { 'Status of Trip': status };
  if (action === 'start') fields['Start Date'] = today;
  if (action === 'end')   fields['End Date']   = today;

  airtableRequest('PATCH', TRIPS_TABLE, `/${tripId}`, { fields }, (err, tripData) => {
    if (err) return res.status(500).json({ error: err.message });
    if (tripData.error) return res.status(500).json({ error: tripData.error });

    const f           = tripData.fields || {};
    const destination = f['Destination'] || 'your destination';
    const country     = f['Country']     || '';
    const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));

    // Get traveler name for email
    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
    airtableRequest('GET', TRAVEL_TABLE, filter, null, (err2, travelerData) => {
      const name = (travelerData && travelerData.records && travelerData.records[0])
        ? (travelerData.records[0].fields['Traveler Name'] || 'Traveler')
        : 'Traveler';

      let subject, html;

      if (action === 'start') {
        subject = `Your trip to ${tripName} has begun!`;
        html    = emailHTML(
          subject,
          `Bon Voyage, ${name}!`,
          `<p>Your trip to <strong>${tripName}</strong> is now underway.</p>
           <p>Your portal is ready whenever you want to reflect, explore, or plan while you're away. Safe travels — we hope this journey transforms you!</p>`
        );
      } else {
        subject = `Welcome home from ${tripName}!`;
        html    = emailHTML(
          subject,
          `Welcome Home, ${name}!`,
          `<p>Your trip to <strong>${tripName}</strong> is now complete.</p>
           <p>We hope it was everything you imagined and more. Head to your portal to begin your Integration Workshop and capture the insights from your journey while they're still fresh.</p>`
        );
      }

      sendEmail(email, name, subject, html, () => {});
      res.status(200).json({ success: true, action, tripName });
    });
  });
};
