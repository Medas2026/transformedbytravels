const https = require('https');
const KEY  = process.env.AIRTABLE_API_KEY;
const BASE = 'appdlxcWb45dIqNK2';

const req = https.request({
  hostname: 'api.airtable.com',
  path:     `/v0/meta/bases/${BASE}/tables`,
  method:   'GET',
  headers:  { 'Authorization': 'Bearer ' + KEY }
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const parsed = JSON.parse(data);
    (parsed.tables || []).forEach(t => console.log(t.name));
  });
});
req.end();
