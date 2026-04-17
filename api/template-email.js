const https = require('https');

const BASE_ID      = 'appdlxcWb45dIqNK2';
const EMAILS_TABLE = 'Emails';

// ── Airtable: fetch email template by code ───────────────────────────────────
function fetchTemplate(code, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const filter  = `?filterByFormula=${encodeURIComponent(`({Code}="${code}")`)}`;
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
        callback(null, {
          subject: f['Subject']     || '',
          p1:      f['Paragraph 1'] || '',
          p2:      f['Paragraph 2'] || '',
          p3:      f['Paragraph 3'] || ''
        });
      } catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

// ── Merge variable substitution: replace {name}, {plan}, etc. ────────────────
function substitute(text, vars) {
  if (!text) return '';
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : '{' + key + '}');
}

// ── Build branded HTML email from 3 paragraphs ───────────────────────────────
function buildHTML(p1, p2, p3, photoUrl) {
  const para = (text) => text
    ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${text.replace(/\n/g, '<br>')}</p>`
    : '';
  const photoHtml = photoUrl
    ? `<tr><td style="padding:0;"><img src="${photoUrl}" alt="" style="width:100%;max-height:220px;object-fit:cover;display:block;" /></td></tr>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      ${photoHtml}
      <tr><td style="padding:36px 40px 28px;">
        ${para(p1)}
        ${para(p2)}
        ${para(p3)}
      </td></tr>
      <tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="https://app.transformedbytravels.com/portal.html"
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
}

// ── Send via Resend ───────────────────────────────────────────────────────────
function sendViaResend(payload, callback) {
  const apiKey  = process.env.RESEND_API_KEY;
  const body    = JSON.stringify(payload);
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
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) callback(null, parsed);
        else callback(new Error(parsed.message || 'Resend error ' + res.statusCode));
      } catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(body);
  req.end();
}

// ── Exported helper — call from other API handlers ───────────────────────────
// sendTemplateEmail('WELCOME_SUB', 'user@example.com', { name: 'Jane', plan: 'Annual' })
function sendTemplateEmail(code, toEmail, mergeFields) {
  return new Promise((resolve, reject) => {
    fetchTemplate(code, (err, tmpl) => {
      if (err) return reject(err);
      const vars    = mergeFields || {};
      const subject = substitute(tmpl.subject, vars);
      const p1      = substitute(tmpl.p1, vars);
      const p2      = substitute(tmpl.p2, vars);
      const p3      = substitute(tmpl.p3, vars);
      const html    = buildHTML(p1, p2, p3, vars.photoUrl || '');
      sendViaResend({
        from:    'TravelForGrowth@transformedbytravels.com',
        to:      toEmail,
        subject: subject,
        html:    html
      }, (err2, result) => {
        if (err2) return reject(err2);
        resolve(result);
      });
    });
  });
}

// ── HTTP handler — POST { code, email, name, ...mergeFields } ─────────────────
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const b     = req.body || {};
  const code  = (b.code  || '').trim();
  const email = (b.email || '').trim();
  if (!code || !email) return res.status(400).json({ error: 'code and email required' });

  const { code: _c, email: _e, ...mergeFields } = b;

  try {
    const result = await sendTemplateEmail(code, email, mergeFields);
    res.status(200).json({ success: true, id: result.id });
  } catch(e) {
    console.error('template-email error:', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports         = handler;
module.exports.sendTemplateEmail = sendTemplateEmail;
