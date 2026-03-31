const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const TRAVEL_TABLE  = 'Traveler';

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

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b     = req.body || {};
  const email = (b.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'Email required' });

  const today = new Date().toISOString().split('T')[0];

  // Find traveler record
  const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
  airtableRequest('GET', TRAVEL_TABLE, filter, null, (err, data) => {
    if (err) return res.status(500).json({ error: err.message });
    const record = (data.records || [])[0];
    if (!record) {
      // No record yet — nothing to update (consent will be captured when they create an account)
      return res.status(200).json({ success: true, note: 'no_record' });
    }
    airtableRequest('PATCH', TRAVEL_TABLE, `/${record.id}`, {
      fields: {
        'Marketing Consent':      true,
        'Marketing Consent Date': today
      }
    }, (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.status(200).json({ success: true });
    });
  });
};
