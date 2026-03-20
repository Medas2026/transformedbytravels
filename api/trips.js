const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Trips';

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

  // GET — all trips for a traveler
  if (req.method === 'GET') {
    const email = ((req.query && req.query.email) || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
    airtableRequest('GET', filter, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ records: data.records || [] });
    });
    return;
  }

  const b  = req.body || {};
  const id = b.id || (req.query && req.query.id);

  // DELETE — remove a trip
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Record ID required' });
    airtableRequest('DELETE', `/${id}`, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ success: true });
    });
    return;
  }

  // PATCH — update a trip
  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'Record ID required' });
    const fields = buildFields(b);
    fields['Last Modified'] = new Date().toISOString().split('T')[0];
    airtableRequest('PATCH', `/${id}`, { fields }, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      if (data.error) return res.status(500).json({ error: data.error, detail: data });
      res.status(200).json({ success: true, record: data });
    });
    return;
  }

  // POST — create a new trip
  if (req.method === 'POST') {
    const email = (b.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });
    const today  = new Date().toISOString().split('T')[0];
    const fields = buildFields(b);
    fields['Traveler Email'] = email;
    fields['Create Date']    = today;
    fields['Last Modified']  = today;
    fields['Status of Trip'] = 'Planning';
    airtableRequest('POST', '', { fields }, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      if (data.error) return res.status(500).json({ error: data.error, detail: data });
      res.status(200).json({ success: true, record: data });
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};

function buildFields(b) {
  const fields = {};
  if (b.tripName    !== undefined) fields['Trip Name']    = b.tripName;
  if (b.destination !== undefined) fields['Destination']  = b.destination;
  if (b.country     !== undefined) fields['Country']      = b.country;
  if (b.startDate   !== undefined) fields['Start Date']   = b.startDate;
  if (b.endDate     !== undefined) fields['End Date']     = b.endDate;
  if (b.airportCode !== undefined) fields['Destination Airport'] = b.airportCode;
  if (b.notes       !== undefined) fields['Notes']        = b.notes;
  if (b.place1      !== undefined) fields['Place 1']      = b.place1;
  if (b.place2      !== undefined) fields['Place 2']      = b.place2;
  if (b.place3      !== undefined) fields['Place 3']      = b.place3;
  if (b.place4      !== undefined) fields['Place 4']      = b.place4;
  if (b.place5      !== undefined) fields['Place 5']      = b.place5;
  if (b.journalTime !== undefined) fields['Journal Time'] = String(b.journalTime);
  if (b.timezone    !== undefined) fields['Time Zone']    = b.timezone;
  return fields;
}
