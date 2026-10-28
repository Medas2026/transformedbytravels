// Returns { exists, name, hasAuthAccount } for a given email — used by the
// unified /login.html to decide whether to render the "returning user" or
// "new account" form.
//
// Usage:  GET /api/check-email?email=someone@example.com

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Traveler';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = String(
    (req.query && req.query.email) ||
    (req.body  && req.body.email)  || ''
  ).toLowerCase().trim();

  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    const filter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${email.replace(/"/g,'\\"')}"`)}&maxRecords=1`;
    const url    = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${filter}`;
    const resp   = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
    const data   = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });

    const rec = (data.records || [])[0];
    if (!rec) return res.status(200).json({ exists: false });

    const f = rec.fields || {};
    return res.status(200).json({
      exists:         true,
      name:           f['Traveler Name']    || '',
      hasAuthAccount: f['Has Auth Account'] === true,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
