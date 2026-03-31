const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'DNA Queries';

function airtableRequest(method, path, body, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = body ? JSON.stringify(body) : '';
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${path}`,
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
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  if (bodyStr) req.write(bodyStr);
  req.end();
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — fetch all queries for a traveler
  if (req.method === 'GET') {
    const email = ((req.query && req.query.email) || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}` +
                   `&sort[0][field]=Date&sort[0][direction]=desc`;
    airtableRequest('GET', filter, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ records: data.records || [] });
    });
    return;
  }

  // POST — save a new query
  if (req.method === 'POST') {
    const b     = req.body || {};
    const email = (b.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email required' });
    const fields = {
      'Traveler Email': email,
      'Destination':   b.destination || '',
      'Country':       b.country     || '',
      'Date':          b.date        || new Date().toISOString().split('T')[0],
      'Guide':         b.guide       || ''
    };
    airtableRequest('POST', '', { fields }, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      if (data.error) return res.status(500).json({ error: data.error });
      res.status(200).json({ success: true, id: data.id });
    });
    return;
  }

  // DELETE — remove a query by record ID
  if (req.method === 'DELETE') {
    const id = ((req.query && req.query.id) || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    airtableRequest('DELETE', `/${id}`, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ success: true });
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
