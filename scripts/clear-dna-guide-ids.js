// Clears DNA Guide ID from all Trip Days records that have one set.
// Usage: AIRTABLE_API_KEY=your_key node scripts/clear-dna-guide-ids.js

const https = require('https');

const BASE_ID   = 'appdlxcWb45dIqNK2';
const TABLE     = 'Trip Days';
const API_KEY   = process.env.AIRTABLE_API_KEY;

if (!API_KEY) { console.error('Set AIRTABLE_API_KEY env var'); process.exit(1); }

function airtable(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + API_KEY,
        'Content-Type':   'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getAllRecordsWithGuide() {
  const records = [];
  let offset = null;
  do {
    const qs = '?filterByFormula=' + encodeURIComponent(`{DNA Guide ID}!=""`)
             + (offset ? '&offset=' + offset : '');
    const data = await airtable('GET', qs, null);
    if (data.error) throw new Error(JSON.stringify(data.error));
    (data.records || []).forEach(r => records.push(r));
    offset = data.offset || null;
  } while (offset);
  return records;
}

(async () => {
  try {
    console.log('Fetching Trip Days records with DNA Guide ID set...');
    const records = await getAllRecordsWithGuide();
    console.log(`Found ${records.length} record(s) to clear.`);
    if (!records.length) { console.log('Nothing to do.'); return; }

    let cleared = 0;
    for (const rec of records) {
      const result = await airtable('PATCH', '/' + rec.id, {
        fields: { 'DNA Guide ID': '' }
      });
      if (result.error) {
        console.error(`Failed on ${rec.id}:`, result.error);
      } else {
        cleared++;
        console.log(`Cleared ${rec.id} (Day ${rec.fields['Day Number'] || '?'})`);
      }
    }
    console.log(`\nDone. ${cleared} of ${records.length} records cleared.`);
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
