// Called by /login.html AFTER the Auth0 redirect callback succeeds.
// - If a Traveler record exists for the email: PATCH only "Has Auth Account".
//   (Never touches assessment scores, archetype, or contact fields.)
// - If no Traveler record exists: CREATE a minimal one with email, name,
//   Has Auth Account = true, and standard first-run defaults.
//
// Usage:
//   POST /api/auth-signin  { email, name }

const https = require('https');
const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Traveler';

function airtable(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${path}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + process.env.AIRTABLE_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, resp => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(raw || '{}')); }
        catch(e) { reject(new Error('parse: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b     = req.body || {};
  const email = String(b.email || '').toLowerCase().trim();
  const name  = String(b.name  || '').trim();

  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    // Look up existing record
    const filter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${email.replace(/"/g,'\\"')}"`)}&maxRecords=1`;
    const found  = await airtable('GET', filter);
    if (found.error) return res.status(500).json({ error: found.error.message || JSON.stringify(found.error) });

    const rec = (found.records || [])[0];

    if (rec) {
      // Update — only auth-related fields, never scores or existing data.
      const fields = { 'Has Auth Account': true };
      // Backfill Traveler Name only if it was blank AND we now have one.
      if (name && !rec.fields['Traveler Name']) fields['Traveler Name'] = name;

      const patched = await airtable('PATCH', `/${rec.id}`, { fields });
      if (patched.error) return res.status(500).json({ error: patched.error.message || JSON.stringify(patched.error) });
      return res.status(200).json({ success: true, action: 'updated', id: rec.id });
    }

    // Create — brand new traveler. Match the first-run defaults used elsewhere.
    const fields = {
      'Traveler Email':       email,
      'Traveler Name':        name,
      'Has Auth Account':     true,
      'DNA Guides To Date':   0,
      'DNA Guides Remaining': 5,
      'Package Status':       'Free',
      'Created Date':         new Date().toISOString().split('T')[0],
    };
    const created = await airtable('POST', '', { fields });
    if (created.error) return res.status(500).json({ error: created.error.message || JSON.stringify(created.error) });
    return res.status(200).json({ success: true, action: 'created', id: created.id });

  } catch(e) {
    console.error('[auth-signin] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
