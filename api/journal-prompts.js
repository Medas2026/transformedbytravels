const https = require('https');

const BASE_ID = 'appdlxcWb45dIqNK2';

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.AIRTABLE_API_KEY;
  const filter = '?filterByFormula=' + encodeURIComponent('{Active}=1');
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent('Journal Prompts')}${filter}`,
    method:   'GET',
    headers:  { 'Authorization': 'Bearer ' + apiKey }
  };

  const req2 = https.request(options, (r) => {
    let data = '';
    r.on('data', c => { data += c; });
    r.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const result = {};
        (parsed.records || []).forEach(rec => {
          const type = (rec.fields['Day Type'] || '').toUpperCase().trim();
          result[type] = rec.fields['Lead-in'] || '';
        });
        res.status(200).json(result);
      } catch(e) {
        res.status(500).json({ error: 'Parse error' });
      }
    });
  });
  req2.on('error', e => res.status(500).json({ error: e.message }));
  req2.end();
};
