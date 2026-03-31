const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'TFG Items';

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey  = process.env.AIRTABLE_API_KEY;
  const sort    = 'sort[0][field]=Item%20Number&sort[0][direction]=asc';
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}?${sort}`,
    method:   'GET',
    headers:  { 'Authorization': 'Bearer ' + apiKey }
  };

  const req2 = https.request(options, (resp) => {
    let data = '';
    resp.on('data', chunk => { data += chunk; });
    resp.on('end', () => {
      console.log('[tfg-items] status:', resp.statusCode, 'body:', data.slice(0, 300));
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          console.error('[tfg-items] Airtable error:', parsed.error);
          return res.status(500).json({ error: parsed.error });
        }
        const items  = (parsed.records || []).map(r => ({
          id:        r.fields['Item Number'],
          dim:       r.fields['Dimension']               || '',
          stem:      r.fields['Lead In']                 || '',
          a:         r.fields['Option A']                || '',
          b:         r.fields['Option B']                || '',
          highlight: r.fields['Highlight Item']          || false,
          aCoach:    r.fields['Option A Coaching Text']  || '',
          bCoach:    r.fields['Option B Coaching Text']  || ''
        })).filter(q => q.id && q.stem);
        res.status(200).json({ items });
      } catch(e) {
        res.status(500).json({ error: 'Parse error: ' + e.message });
      }
    });
  });
  req2.on('error', e => res.status(500).json({ error: e.message }));
  req2.end();
};
