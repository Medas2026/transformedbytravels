const https = require('https');

const BASE_ID      = 'appdlxcWb45dIqNK2';
const EMAILS_TABLE = 'Emails';

function fetchTemplate(code) {
  return new Promise((resolve) => {
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
          const f = ((parsed.records || [])[0] || {}).fields || {};
          resolve({
            subject: f['Subject']     || '',
            p1:      f['Paragraph 1'] || '',
            p2:      f['Paragraph 2'] || '',
            p3:      f['Paragraph 3'] || ''
          });
        } catch(e) { resolve({ subject: '', p1: '', p2: '', p3: '' }); }
      });
    });
    req.on('error', () => resolve({ subject: '', p1: '', p2: '', p3: '' }));
    req.end();
  });
}

function substitute(text, vars) {
  if (!text) return '';
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : '{' + key + '}');
}

function buildEmailHTML(name, archetype, archetypePassions, archetypeTag, archetypeDesc, scores, introParagraphs) {
  const dims = ['Curiosity', 'Adventure', 'Reflection', 'Connection', 'Travel Purpose'];
  const dimRows = dims.map(d => {
    const score = Number((scores || {})[d] || 0);
    const pct = Math.round((score / 7) * 100);
    return '<tr><td style="padding:6px 0;"><table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td width="130" style="font-family:Arial,sans-serif;font-size:13px;color:#334155;font-weight:bold;padding-right:12px;">' + d + '</td>' +
      '<td><table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;background:#e2e8f0;"><tr>' +
      '<td width="' + pct + '%" style="background:#2dd4bf;height:14px;border-radius:6px;"></td><td style="height:14px;"></td>' +
      '</tr></table></td>' +
      '<td width="45" style="text-align:right;font-family:Arial,sans-serif;font-size:13px;color:#64748b;padding-left:10px;">' + score + '/7</td>' +
      '</tr></table></td></tr>';
  }).join('');

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">' +
    '<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">' +
    '<tr><td style="padding:36px 40px 28px;">' +
    '<h1 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 20px;">Hello ' + name + ',</h1>' +
    (introParagraphs || []).filter(p => p).map(p =>
      '<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 16px;">' + p.replace(/\n/g, '<br>') + '</p>'
    ).join('') +
    '</td></tr>' +
    '<tr><td style="padding:0 40px 32px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;">' +
    '<tr><td style="padding:32px;text-align:center;">' +
    '<p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 10px;">' + (archetypeTag || '') + '</p>' +
    '<h2 style="font-family:Georgia,serif;font-size:26px;color:#ffffff;margin:0 0 8px;">' + (archetype || '') + '</h2>' +
    (archetypePassions ? '<p style="font-family:Arial,sans-serif;font-size:16px;color:#2dd4bf;font-weight:bold;margin:0 0 16px;">' + archetypePassions + '</p>' : '<div style="margin-bottom:16px;"></div>') +
    '<p style="font-family:Arial,sans-serif;font-size:14px;color:#94a3b8;line-height:1.7;margin:0;">' + (archetypeDesc || '') + '</p>' +
    '</td></tr></table></td></tr>' +
    '<tr><td style="padding:0 40px 36px;">' +
    '<h3 style="font-family:Georgia,serif;font-size:17px;color:#0f172a;margin:0 0 18px;">Your Dimension Scores</h3>' +
    '<table width="100%" cellpadding="0" cellspacing="0">' + dimRows + '</table></td></tr>' +
    '<tr><td style="padding:0 40px 48px;text-align:center;">' +
    '<a href="https://transformedbytravels.vercel.app/trip-planner.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Explore Your Destinations</a>' +
    '</td></tr>' +
    '<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">' +
    '<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>' +
    '</td></tr></table></td></tr></table></body></html>';
}

function sendViaResend(payload, apiKey, res) {
  const body = JSON.stringify(payload);
  const options = {
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const req = https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => {
      console.log('Resend status:', response.statusCode, 'body:', data);
      try {
        const parsed = JSON.parse(data);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          res.status(200).json({ success: true, id: parsed.id });
        } else {
          res.status(500).json({ error: parsed.message || 'Send failed', detail: parsed });
        }
      } catch(e) {
        res.status(500).json({ error: 'Parse error', raw: data.slice(0, 300) });
      }
    });
  });

  req.on('error', (err) => {
    console.log('HTTPS error:', err.message);
    res.status(500).json({ error: err.message });
  });

  req.write(body);
  req.end();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    console.log('API key present:', !!apiKey);

    const b = req.body || {};
    const type = b.type || 'profile';
    const name = b.name || '';
    const email = b.email || '';

    console.log('type:', type, 'name:', name, 'email:', email);

    if (!email || !name) {
      return res.status(400).json({ error: 'Missing name or email', body: b });
    }

    if (type === 'destination') {
      const destination = b.destination || 'Your Destination';
      const guideHtml = (b.guideHtml || '').replace(/color:#fff/g, 'color:#0f172a').replace(/color: #fff/g, 'color:#0f172a');
      const destEmailHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">' +
        '<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">' +
        '<tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">' +
        '<img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" /></td></tr>' +
        '<tr><td style="padding:36px 40px;">' +
        '<h2 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 24px;">Your Guide to ' + destination + '</h2>' +
        '<div style="font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.75;">' + guideHtml + '</div>' +
        '</td></tr>' +
        '<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">' +
        '<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>' +
        '</td></tr></table></td></tr></table></body></html>';

      sendViaResend({
        from: 'YourResults@transformedbytravels.com',
        to: email,
        subject: 'Destination: ' + destination,
        html: destEmailHtml
      }, apiKey, res);
      return;
    }

    if (type === 'template') {
      const code = (b.code || '').trim();
      if (!code) return res.status(400).json({ error: 'code required for template type' });
      const sendTemplateEmail = require('./template-email');
      await sendTemplateEmail(code, email, { name, ...b });
      return res.status(200).json({ success: true });
    }

    if (type === 'dna-query') {
      const destination = b.destination || '';
      const country     = b.country     || '';
      const now         = new Date();
      const dateStr     = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      const timeStr     = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', timeZone:'UTC' }) + ' UTC';

      const tmpl = await fetchTemplate('DNA_GUIDES');
      console.log('dna-query template:', JSON.stringify(tmpl).slice(0, 300));
      console.log('dna-query vars: name=', name, 'dest=', destination, 'country=', country);
      const vars = { name, destination, country };
      const p1 = substitute(tmpl.p1, vars);
      const p2 = substitute(tmpl.p2, vars);
      const p3 = substitute(tmpl.p3, vars);
      const subject = tmpl.subject
        ? substitute(tmpl.subject, vars)
        : name + ', your DNA Guide for ' + destination;

      const guide = b.guide || '';

      const para = (t) => t
        ? '<p style="font-family:Arial,sans-serif;font-size:15px;color:#334155;line-height:1.75;margin:0 0 14px;">' + t.replace(/\n/g, '<br>') + '</p>'
        : '';

      // Convert markdown guide to email-safe HTML
      function guideToHtml(text) {
        if (!text) return '';
        return text
          .replace(/^# (.+)$/gm, '<h2 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:24px 0 10px;padding-bottom:8px;border-bottom:2px solid #2dd4bf;">$1</h2>')
          .replace(/^## (.+)$/gm, '<h3 style="font-family:Arial,sans-serif;font-weight:bold;font-size:14px;color:#0f172a;text-transform:uppercase;letter-spacing:0.08em;margin:20px 0 6px;">$1</h3>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/^- (.+)$/gm, '<li style="font-family:Arial,sans-serif;font-size:14px;color:#334155;margin-bottom:5px;">$1</li>')
          .replace(/(<li[\s\S]*?<\/li>)+/g, '<ul style="padding-left:20px;margin:8px 0 14px;">$&</ul>')
          .replace(/\n\n/g, '</p><p style="font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.75;margin:0 0 14px;">')
          .replace(/\n/g, '<br>');
      }

      const guideBlock = guide
        ? '<div style="margin-top:24px;padding-top:24px;border-top:1px solid #e2e8f0;">' +
          '<p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.1em;text-transform:uppercase;color:#2dd4bf;margin:0 0 16px;">Your Destination DNA Guide</p>' +
          '<div style="font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.75;">' +
          '<p style="font-family:Arial,sans-serif;font-size:14px;color:#334155;line-height:1.75;margin:0 0 14px;">' +
          guideToHtml(guide) + '</p></div></div>'
        : '';

      const dnaHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">' +
        '<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">' +
        '<tr><td style="padding:36px 40px 28px;">' +
        '<h1 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 20px;">Hello ' + name + ',</h1>' +
        para(p1) + para(p2) + para(p3) +
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border-radius:12px;">' +
        '<tr><td style="padding:20px 24px;">' +
        '<p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.1em;text-transform:uppercase;color:#2dd4bf;margin:0 0 6px;">Destination DNA Guide</p>' +
        '<p style="font-family:Georgia,serif;font-size:20px;color:#ffffff;margin:0 0 4px;">' + destination + (country ? ', ' + country : '') + '</p>' +
        '<p style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;margin:0;">' + dateStr + ' · ' + timeStr + '</p>' +
        '</td></tr></table>' +
        guideBlock +
        '</td></tr>' +
        '<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">' +
        '<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>' +
        '</td></tr></table></td></tr></table></body></html>';

      sendViaResend({ from: 'YourResults@transformedbytravels.com', to: email, subject, html: dnaHtml }, apiKey, res);
      return;
    }

    const archetype        = b.archetype        || '';
    const archetypePassions = b.archetypePassions || '';
    const archetypeTag     = b.archetypeTag     || '';
    const archetypeDesc    = b.archetypeDesc    || '';
    const scores           = b.scores           || {};

    // Fetch ASSESSMENT template from Airtable
    const tmpl = await fetchTemplate('ASSESSMENT');
    const vars = { name };
    const p1 = substitute(tmpl.p1, vars);
    const p2 = substitute(tmpl.p2, vars);
    const p3 = substitute(tmpl.p3, vars);
    const subject = tmpl.subject
      ? substitute(tmpl.subject, vars)
      : name + ', your Travel for Growth Assessment is ready';

    const html = buildEmailHTML(name, archetype, archetypePassions, archetypeTag, archetypeDesc, scores, [p1, p2, p3]);

    sendViaResend({
      from: 'YourResults@transformedbytravels.com',
      to: email,
      subject,
      html: html.replace('trip-planner.html', 'trip-planner.html?email=' + encodeURIComponent(email))
    }, apiKey, res);

  } catch(err) {
    console.log('Handler error:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
};
