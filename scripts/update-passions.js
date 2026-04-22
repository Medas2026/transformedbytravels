// One-time script to update old passion values to new names in the Trips table
// Run with: AIRTABLE_API_KEY=your_key node scripts/update-passions.js

const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE      = 'Trips';
const FIELD      = 'Trip Passions';
const API_KEY    = process.env.AIRTABLE_API_KEY;

const MAPPING = {
  'History and Art Tracker':          'Ancient History & Archaeology',
  'Mountain Climbing/Mountaineering': 'Mountain Climbing',
  'Scuba Diving':                     'SCUBA & Marine Exploration',
  'Canoeing/Kayaking':                'Canoeing, Kayaking & Whitewater',
  'Wildlife Tracking':                'Wildlife & Safari',
  'Sports Fishing':                   'Fishing',
  'Archaeology and Science':          'Ancient History & Archaeology',
  'Wine Tasting':                     'Wine & Vineyards',
  'Day Hiking':                       'Day Hiking & Trekking',
  'Mountain Biking':                  'Cycling & Mountain Biking',
  'Volunteerism':                     'Voluntourism & Service',
  'Culinary Travel':                  'Culinary Travel & Street Food',
  'Sailing':                          'Sailing & Boating',
};

function airtableGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`,
      method:   'GET',
      headers:  { 'Authorization': 'Bearer ' + API_KEY }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function airtablePatch(recordId, fields) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({ fields });
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${recordId}`,
      method:   'PATCH',
      headers:  {
        'Authorization':  'Bearer ' + API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function applyMapping(value) {
  if (!value) return null;
  const parts = value.split(',').map(s => s.trim()).filter(Boolean);
  const updated = parts.map(p => MAPPING[p] || p);
  return updated.join(', ');
}

async function run() {
  if (!API_KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }

  let offset = '';
  let allRecords = [];

  // Fetch all records (paginate)
  do {
    const qs = '?fields[]=' + encodeURIComponent(FIELD) + (offset ? '&offset=' + offset : '');
    const data = await airtableGet(qs);
    allRecords = allRecords.concat(data.records || []);
    offset = data.offset || '';
  } while (offset);

  console.log(`Fetched ${allRecords.length} trip records`);

  let updated = 0;
  let skipped = 0;

  for (const rec of allRecords) {
    const original = rec.fields[FIELD] || '';
    if (!original) { skipped++; continue; }

    const mapped = applyMapping(original);
    if (mapped === original) { skipped++; continue; }

    console.log(`  Updating ${rec.id}: "${original}" → "${mapped}"`);
    await airtablePatch(rec.id, { [FIELD]: mapped });
    updated++;

    // Airtable rate limit: 5 requests/sec
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (no change): ${skipped}`);
}

run().catch(err => { console.error(err); process.exit(1); });
