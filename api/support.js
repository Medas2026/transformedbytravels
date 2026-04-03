const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const ISSUES_TABLE  = 'Support Issues';
const SUPPORT_EMAIL = 'Support@TransformedbyTravels.com';
const FROM_EMAIL    = 'TravelForGrowth@transformedbytravels.com';

function airtablePost(fields, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = JSON.stringify({ fields });
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(ISSUES_TABLE)}`,
    method:   'POST',
    headers: {
      'Authorization':  'Bearer ' + apiKey,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(bodyStr);
  req.end();
}

function sendSupportEmail(name, email, issue, callback) {
  const apiKey = process.env.RESEND_API_KEY;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#ffffff;padding:24px 32px;border-bottom:3px solid #2dd4bf;">
        <p style="font-size:18px;font-weight:bold;color:#0f172a;margin:0;">New Support Issue</p>
      </td></tr>
      <tr><td style="padding:28px 32px;">
        <table cellpadding="0" cellspacing="0" style="width:100%;">
          <tr>
            <td style="font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;padding:6px 16px 6px 0;white-space:nowrap;vertical-align:top;">Name</td>
            <td style="font-size:14px;color:#0f172a;padding:6px 0;">${name}</td>
          </tr>
          <tr>
            <td style="font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;padding:6px 16px 6px 0;white-space:nowrap;vertical-align:top;">Email</td>
            <td style="font-size:14px;color:#0f172a;padding:6px 0;">${email}</td>
          </tr>
          <tr>
            <td style="font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;color:#94a3b8;padding:6px 16px 6px 0;white-space:nowrap;vertical-align:top;">Issue</td>
            <td style="font-size:14px;color:#0f172a;padding:6px 0;line-height:1.6;">${issue.replace(/\n/g, '<br>')}</td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 32px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const body = JSON.stringify({
    from:    FROM_EMAIL,
    to:      SUPPORT_EMAIL,
    subject: `Support Issue from ${name}`,
    html
  });
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
    res.on('data', () => {});
    res.on('end', () => callback(null));
  });
  req.on('error', callback);
  req.write(body);
  req.end();
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b     = req.body || {};
  const name  = (b.name  || '').trim();
  const email = (b.email || '').toLowerCase().trim();
  const issue = (b.issue || '').trim();

  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!issue) return res.status(400).json({ error: 'Issue description required' });

  const today = new Date().toISOString().split('T')[0];
  const fields = {
    'Name':   name,
    'Traveler Email': email,
    'Issue':  issue,
    'Status': 'Open',
    'Date':   today
  };

  airtablePost(fields, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    sendSupportEmail(name, email, issue, () => {});
    res.status(200).json({ success: true });
  });
};
