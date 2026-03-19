const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Workshop Responses';

function airtableRequest(method, path, body, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = body ? JSON.stringify(body) : '';
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${path}`,
    method,
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — load all responses for a traveler + workshop
  if (req.method === 'GET') {
    const email = (req.query.email || '').toLowerCase().trim();
    const code  = (req.query.code  || '').trim();
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const filter = `?filterByFormula=${encodeURIComponent(`AND({Traveler Email}="${email}",{Workshop Code}="${code}")`)}`;
    airtableRequest('GET', filter, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      const responses = {};
      (data.records || []).forEach(r => {
        responses[r.fields['Question ID']] = {
          response:  r.fields['Response']   || '',
          response2: r.fields['Response 2'] || '',
          response3: r.fields['Response 3'] || '',
          recordId:  r.id
        };
      });
      res.status(200).json({ responses });
    });
    return;
  }

  // POST — save or update a response
  if (req.method === 'POST') {
    const b           = req.body || {};
    const email       = (b.email || '').toLowerCase().trim();
    const code        = (b.workshopCode || '').trim();
    const questionId  = (b.questionId   || '').trim();
    const response    = b.response   || '';
    const response2   = b.response2  || '';
    const response3   = b.response3  || '';
    const questionId2 = b.questionId2 || '';
    const questionId3 = b.questionId3 || '';

    if (!email || !code || !questionId) return res.status(400).json({ error: 'Missing required fields' });

    const filter = `?filterByFormula=${encodeURIComponent(`AND({Traveler Email}="${email}",{Workshop Code}="${code}",{Question ID}="${questionId}")`)}`;
    airtableRequest('GET', filter, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });

      const patchFields = {
        'Response':      response,
        'Response 2':    response2,
        'Question ID 2': questionId2,
        'Response 3':    response3,
        'Question ID 3': questionId3
      };

      if (data.records && data.records.length > 0) {
        const recordId = data.records[0].id;
        airtableRequest('PATCH', `/${recordId}`, { fields: patchFields }, (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.status(200).json({ success: true, action: 'updated' });
        });
      } else {
        const fields = {
          'Traveler Email': email,
          'Workshop Code':  code,
          'Question ID':    questionId,
          'Date':           new Date().toISOString().split('T')[0],
          ...patchFields
        };
        airtableRequest('POST', '', { fields }, (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.status(200).json({ success: true, action: 'created' });
        });
      }
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
