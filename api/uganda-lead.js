const https = require('https');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Journey Book Leads';

function airtablePost(fields) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ fields });
    const req  = https.request({
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`,
      method:   'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, role, message } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

  try {
    const result = await airtablePost({
      'Name':      name,
      'Email':     email,
      'Role':      role || '',
      'Message':   message || '',
      'Source':    'Uganda Landing Page',
      'Submitted': new Date().toISOString()
    });

    if (result.status === 200 || result.status === 201) {
      return res.status(200).json({ ok: true });
    }
    console.error('[uganda-lead] Airtable error:', result.status, result.body);
    return res.status(500).json({ error: 'Could not save lead' });
  } catch(e) {
    console.error('[uganda-lead]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
