const https = require('https');

const BASE_ID      = 'appdlxcWb45dIqNK2';
const TRAVEL_TABLE = 'Traveler';
const MKTG_TABLE   = 'Marketing Communications';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email = (
    (req.method === 'GET' ? req.query && req.query.email : (req.body || {}).email) || ''
  ).toLowerCase().trim();

  if (!email) return res.status(400).json({ error: 'Email required' });

  const today = new Date().toISOString().split('T')[0];

  // 1. Mark Marketing Consent = false in Traveler table
  const travelerFilter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
  airtableRequest('GET', TRAVEL_TABLE, travelerFilter, null, (err, data) => {
    if (!err && data.records && data.records[0]) {
      airtableRequest('PATCH', TRAVEL_TABLE, `/${data.records[0].id}`, {
        fields: { 'Marketing Consent': false }
      }, () => {});
    }
  });

  // 2. Mark all open Marketing Communications rows for this email as unsubscribed
  const mktgFilter = `?filterByFormula=${encodeURIComponent(`AND({Traveler Email}="${email}",{Unsubscribed}!=TRUE())`)}`;
  airtableRequest('GET', MKTG_TABLE, mktgFilter, null, (err2, mktgData) => {
    const records = (mktgData && mktgData.records) || [];
    records.forEach(r => {
      airtableRequest('PATCH', MKTG_TABLE, `/${r.id}`, {
        fields: { 'Unsubscribed': true, 'Unsubscribe Date': today }
      }, () => {});
    });
  });

  res.status(200).json({ success: true });
};
