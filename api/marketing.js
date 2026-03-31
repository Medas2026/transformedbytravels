/**
 * Marketing Communications — nurture email cron + response/unsubscribe tracking
 *
 * GET ?action=cron        — daily cron: send next nurture step to eligible travelers
 * GET ?action=respond     — traveler clicked a nurture email CTA (tracks response + stops sequence)
 *   &email=...
 *   &campaign=...
 */

const https = require('https');

const BASE_ID      = 'appdlxcWb45dIqNK2';
const TRAVEL_TABLE = 'Traveler';
const MKTG_TABLE   = 'Marketing Communications';
const EMAILS_TABLE = 'Emails';

const CAMPAIGN      = 'NURTURE';
const STEPS         = ['NURTURE_1', 'NURTURE_2', 'NURTURE_3'];
const DAYS_BETWEEN  = 3; // days between steps

// ─── Airtable helper ──────────────────────────────────────────────────────────

function airtableRequest(method, table, path, body, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = { 'Authorization': 'Bearer ' + apiKey };
  if (bodyStr) {
    headers['Content-Type']   = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`,
    method,
    headers
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  if (bodyStr) req.write(bodyStr);
  req.end();
}

// ─── Emails table template fetch ─────────────────────────────────────────────

function fetchTemplate(code, callback) {
  const filter = `?filterByFormula=${encodeURIComponent(`({Code}="${code}")`)}`;
  airtableRequest('GET', EMAILS_TABLE, filter, null, (err, data) => {
    if (err) return callback(err);
    const record = (data.records || [])[0];
    if (!record) return callback(new Error('Template not found: ' + code));
    const f = record.fields;
    callback(null, {
      subject: f['Subject'] || '',
      p1: f['Paragraph 1'] || '',
      p2: f['Paragraph 2'] || '',
      p3: f['Paragraph 3'] || ''
    });
  });
}

function substitute(text, vars) {
  if (!text) return '';
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : '{' + key + '}');
}

// ─── Email send ───────────────────────────────────────────────────────────────

function sendEmail(to, subject, html, callback) {
  const apiKey = process.env.RESEND_API_KEY;
  const body   = JSON.stringify({ from: 'YourResults@transformedbytravels.com', to, subject, html });
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
      console.log('[marketing] Resend status:', res.statusCode);
      callback(null);
    });
  });
  req.on('error', e => { console.error('[marketing] send error:', e.message); callback(e); });
  req.write(body);
  req.end();
}

function buildNurtureHTML(name, subject, p1, p2, p3, email, campaign) {
  const baseUrl       = 'https://transformedbytravels.vercel.app';
  const respondUrl    = `${baseUrl}/api/marketing?action=respond&email=${encodeURIComponent(email)}&campaign=${encodeURIComponent(campaign)}`;
  const unsubUrl      = `${baseUrl}/unsubscribe.html?email=${encodeURIComponent(email)}`;
  const para = (text, vars) => text
    ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${substitute(text, vars).replace(/\n/g, '<br>')}</p>`
    : '';
  const vars = { name };

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
<img src="${baseUrl}/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" /></td></tr>
<tr><td style="padding:36px 40px;">
<h2 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 16px;">${subject}</h2>
<div style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;">
${para(p1, vars)}${para(p2, vars)}${para(p3, vars)}
</div>
</td></tr>
<tr><td style="padding:0 40px 40px;text-align:center;">
<a href="${respondUrl}&redirect=${encodeURIComponent(baseUrl + '/portal.html')}"
   style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">
  Go to My Portal
</a>
</td></tr>
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0 0 8px;">© Transformed by Travels · All rights reserved</p>
<p style="font-family:Arial,sans-serif;font-size:11px;color:#cbd5e1;margin:0;">
  <a href="${unsubUrl}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe from marketing emails</a>
</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query && req.query.action;

  // ── RESPOND: traveler clicked a CTA in a nurture email ─────────────────────
  if (action === 'respond') {
    const email    = ((req.query.email    || '')).toLowerCase().trim();
    const campaign = (req.query.campaign  || CAMPAIGN);
    const redirect = req.query.redirect   || 'https://transformedbytravels.vercel.app/portal.html';

    if (email) {
      const now = new Date().toISOString();
      const today = now.split('T')[0];
      const time  = now.split('T')[1].substring(0, 5) + ' UTC';

      // Mark all unsent steps for this email+campaign with Response Date
      const filter = `?filterByFormula=${encodeURIComponent(
        `AND({Traveler Email}="${email}",{Campaign}="${campaign}",{Unsubscribed}!=TRUE())`
      )}`;
      airtableRequest('GET', MKTG_TABLE, filter, null, (err, data) => {
        const records = (data && data.records) || [];
        records.forEach(r => {
          // Only update records that haven't been marked responded yet
          if (!r.fields['Response Date']) {
            airtableRequest('PATCH', MKTG_TABLE, `/${r.id}`, {
              fields: { 'Response Date': today, 'Response Time': time }
            }, () => {});
          }
        });
      });
    }

    // Redirect to portal (or whatever URL was passed)
    res.writeHead(302, { Location: redirect });
    return res.end();
  }

  // ── CRON: send next nurture step ───────────────────────────────────────────
  if (action === 'cron') {
    const today     = new Date().toISOString().split('T')[0];
    const cutoff    = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_BETWEEN);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    // Fetch all travelers with Marketing Consent = true
    const travelerFilter = `?filterByFormula=${encodeURIComponent(`({Marketing Consent}=TRUE())`)}`;
    airtableRequest('GET', TRAVEL_TABLE, travelerFilter, null, (err, tData) => {
      if (err) {
        console.error('[marketing cron] traveler fetch error:', err.message);
        return res.status(500).json({ error: err.message });
      }

      const travelers = (tData.records || []).filter(r => {
        const f = r.fields;
        // Skip travelers who already have a paid subscription
        return !f['Subscription Plan'] || f['Subscription Plan'] === 'Free';
      });

      console.log(`[marketing cron] ${travelers.length} eligible travelers`);

      if (travelers.length === 0) return res.status(200).json({ success: true, sent: 0 });

      let pending  = travelers.length;
      let sentCount = 0;

      travelers.forEach(traveler => {
        const tFields = traveler.fields;
        const email   = (tFields['Traveler Email'] || '').toLowerCase().trim();
        const name    = tFields['Traveler Name'] || 'Traveler';
        if (!email) { if (--pending === 0) res.status(200).json({ success: true, sent: sentCount }); return; }

        // Fetch existing marketing comms for this traveler+campaign
        const mktgFilter = `?filterByFormula=${encodeURIComponent(
          `AND({Traveler Email}="${email}",{Campaign}="${CAMPAIGN}")`
        )}`;
        airtableRequest('GET', MKTG_TABLE, mktgFilter, null, (err2, mData) => {
          const mRecords = (mData && mData.records) || [];

          // Check if already unsubscribed
          const unsubscribed = mRecords.some(r => r.fields['Unsubscribed']);
          // Check if responded (clicked CTA) — stop sequence
          const responded    = mRecords.some(r => r.fields['Response Date']);

          if (unsubscribed || responded) {
            if (--pending === 0) res.status(200).json({ success: true, sent: sentCount });
            return;
          }

          // Determine which steps have been sent
          const sentSteps = mRecords.map(r => r.fields['Template Code']).filter(Boolean);

          // Find next step to send
          const nextStep = STEPS.find(s => !sentSteps.includes(s));
          if (!nextStep) {
            // All steps sent — done
            if (--pending === 0) res.status(200).json({ success: true, sent: sentCount });
            return;
          }

          // Check timing — last sent date must be >= DAYS_BETWEEN days ago (or no prior sends)
          const lastRecord = mRecords
            .filter(r => r.fields['Sent Date'])
            .sort((a, b) => b.fields['Sent Date'].localeCompare(a.fields['Sent Date']))[0];

          if (lastRecord && lastRecord.fields['Sent Date'] > cutoffStr) {
            // Too soon
            if (--pending === 0) res.status(200).json({ success: true, sent: sentCount });
            return;
          }

          // Fetch email template
          fetchTemplate(nextStep, (tmplErr, tmpl) => {
            if (tmplErr) {
              console.error('[marketing cron] template error:', tmplErr.message);
              if (--pending === 0) res.status(200).json({ success: true, sent: sentCount });
              return;
            }

            const vars    = { name };
            const subject = substitute(tmpl.subject, vars) || 'A message from Transformed by Travels';
            const html    = buildNurtureHTML(name, subject, tmpl.p1, tmpl.p2, tmpl.p3, email, CAMPAIGN);

            sendEmail(email, subject, html, (sendErr) => {
              if (!sendErr) {
                sentCount++;
                // Log to Marketing Communications table
                airtableRequest('POST', MKTG_TABLE, '', {
                  fields: {
                    'Traveler Email': email,
                    'Campaign':       CAMPAIGN,
                    'Step':           nextStep,
                    'Sent Date':      today,
                    'Template Code':  nextStep
                  }
                }, () => {});
              }
              if (--pending === 0) res.status(200).json({ success: true, sent: sentCount });
            });
          });
        });
      });
    });
    return;
  }

  res.status(400).json({ error: 'action required: cron or respond' });
};
