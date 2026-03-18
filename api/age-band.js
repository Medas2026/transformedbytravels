const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Age Bands';

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const name = ((req.query && req.query.name) || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });

  const apiKey  = process.env.AIRTABLE_API_KEY;
  const filter  = `?filterByFormula=${encodeURIComponent(`({Name}="${name}")`)}`;
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${filter}`,
    method:   'GET',
    headers:  { 'Authorization': 'Bearer ' + apiKey }
  };

  const req2 = https.request(options, (resp) => {
    let data = '';
    resp.on('data', chunk => { data += chunk; });
    resp.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.records && parsed.records.length > 0) {
          res.status(200).json({ record: parsed.records[0] });
        } else {
          res.status(200).json({ record: null });
        }
      } catch(e) {
        res.status(500).json({ error: 'Parse error' });
      }
    });
  });

  req2.on('error', err => res.status(500).json({ error: err.message }));
  req2.end();
};
