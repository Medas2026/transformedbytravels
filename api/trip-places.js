const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Trip Places';

function airtableRequest(method, path, body, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = { 'Authorization': 'Bearer ' + apiKey };
  if (bodyStr) {
    headers['Content-Type']   = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${path}`,
    method,
    headers
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log('[trip-places]', method, path, 'status:', res.statusCode, 'body:', data.slice(0,200));
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — fetch places for a trip, sorted by Day
  if (req.method === 'GET') {
    const tripId = (req.query && req.query.tripId) || '';
    if (!tripId) return res.status(400).json({ error: 'tripId required' });
    const filter = '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`);
    const sort   = '&sort[0][field]=Day&sort[0][direction]=asc';
    airtableRequest('GET', filter + sort, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ records: data.records || [] });
    });
    return;
  }

  const b = req.body || {};

  // POST — create a place
  if (req.method === 'POST') {
    const fields = {
      'Trip Name': b.place || '',
      'Trip ID':   b.tripId || '',
      'Place':     b.place || '',
    };
    if (b.tripId)     fields['Trips']    = [b.tripId];
    if (b.travelerId) fields['Traveler'] = [b.travelerId];
    if (b.day)        fields['Day']      = Number(b.day);
    if (b.country)    fields['Country']  = b.country;
    if (b.notes)      fields['Notes']    = b.notes;

    airtableRequest('POST', '', { fields }, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      if (data.error) return res.status(500).json({ error: data.error });
      res.status(200).json({ success: true, record: data });
    });
    return;
  }

  // DELETE — delete a place
  if (req.method === 'DELETE') {
    const id = (req.query && req.query.id) || b.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    airtableRequest('DELETE', `/${id}`, null, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ success: true });
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
