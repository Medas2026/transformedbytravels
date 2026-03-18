const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Workshop Slides';

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = (req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Workshop code required' });

  const apiKey  = process.env.AIRTABLE_API_KEY;
  const filter  = encodeURIComponent(`({Workshop Code}="${code}")`);
  const sort    = '&sort%5B0%5D%5Bfield%5D=Slide%20Number&sort%5B0%5D%5Bdirection%5D=asc';
  const path    = `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?filterByFormula=${filter}${sort}`;

  const options = {
    hostname: 'api.airtable.com',
    path,
    method:  'GET',
    headers: { 'Authorization': 'Bearer ' + apiKey }
  };

  const req2 = https.request(options, (resp) => {
    let data = '';
    resp.on('data', chunk => { data += chunk; });
    resp.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const slides = (parsed.records || []).map(r => r.fields);
        res.status(200).json({ slides });
      } catch(e) {
        res.status(500).json({ error: 'Parse error' });
      }
    });
  });
  req2.on('error', err => res.status(500).json({ error: err.message }));
  req2.end();
};
