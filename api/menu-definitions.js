const https = require('https');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Menu Definitions';

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey  = process.env.AIRTABLE_API_KEY;
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`,
    method:   'GET',
    headers:  { 'Authorization': 'Bearer ' + apiKey }
  };

  const req2 = https.request(options, (r) => {
    let data = '';
    r.on('data', c => { data += c; });
    r.on('end', () => {
      try {
        const parsed  = JSON.parse(data);
        const records = parsed.records || [];
        // Return as a simple { "Item Name": "Tooltip text" } map
        const map = {};
        records.forEach(rec => {
          const item    = (rec.fields['Item']    || '').trim();
          const tooltip = (rec.fields['Tooltip'] || '').trim();
          if (item) map[item] = tooltip;
        });
        res.status(200).json(map);
      } catch(e) {
        res.status(500).json({ error: e.message });
      }
    });
  });
  req2.on('error', e => res.status(500).json({ error: e.message }));
  req2.end();
};
