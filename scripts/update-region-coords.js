// Write Latitude + Longitude to Animal Regions table in Airtable
// Run AFTER adding Latitude and Longitude as Number fields to the table
// node scripts/update-region-coords.js

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const KEY     = (fs.readFileSync(path.join(__dirname,'../.env.local'),'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/)||[])[1]?.trim();
const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Animal Regions';

// Central coordinates for each region
const COORDS = {
  'East Africa':               { lat:  -1.5,  lng:  36.0 },
  'South Africa':              { lat: -24.0,  lng:  31.5 },
  'Botswana':                  { lat: -20.0,  lng:  23.5 },
  'Gorilla Countries':         { lat:  -1.2,  lng:  29.5 },
  'Namibia':                   { lat: -21.0,  lng:  17.5 },
  'Madagascar':                { lat: -19.0,  lng:  46.5 },
  'Ethiopia':                  { lat:   7.5,  lng:  38.0 },
  'Mozambique':                { lat: -17.5,  lng:  35.5 },
  'Indian Tigers & Rhinos':    { lat:  22.5,  lng:  79.0 },
  'Indian Specialty Wildlife': { lat:  26.5,  lng:  91.0 },
  'Sri Lanka':                 { lat:   8.0,  lng:  81.0 },
  'Borneo':                    { lat:   2.0,  lng: 114.5 },
  'Indonesia':                 { lat:  -3.0,  lng: 117.0 },
  'Galápagos':                 { lat:  -0.5,  lng: -90.5 },
  'Amazon':                    { lat:  -5.0,  lng: -62.0 },
  'Andes':                     { lat:  -3.5,  lng: -78.0 },
  'Pantanal':                  { lat: -17.5,  lng: -57.0 },
  'Central America':           { lat:   9.5,  lng: -84.0 },
  'Patagonia':                 { lat: -50.0,  lng: -73.0 },
  'Antarctica & Falklands':    { lat: -65.0,  lng: -62.0 },
  'Yellowstone':               { lat:  44.5,  lng:-110.5 },
  'Alaska & Yukon':            { lat:  63.0,  lng:-151.0 },
  'Canadian Arctic':           { lat:  63.5,  lng: -95.0 },
  'Australia':                 { lat: -25.0,  lng: 133.0 },
  'New Zealand':               { lat: -42.0,  lng: 172.0 },
  'Svalbard':                  { lat:  78.0,  lng:  16.0 },
  'European Wildlife':         { lat:  52.5,  lng:  22.0 },
};

function atReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.airtable.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function fetchAll() {
  const records = [];
  let offset = '';
  do {
    const qs = offset ? `?offset=${offset}` : '';
    const data = await atReq('GET', `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${qs}`);
    if (data.error) { console.error('Fetch error:', data.error); process.exit(1); }
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

(async () => {
  console.log('Fetching Animal Regions…');
  const records = await fetchAll();
  console.log(`Found ${records.length} regions`);

  const updates = records
    .filter(r => COORDS[r.fields['Region']])
    .map(r => ({
      id: r.id,
      fields: {
        'Lattitude': COORDS[r.fields['Region']].lat,
        'Longitude': COORDS[r.fields['Region']].lng,
      }
    }));

  const missing = records.filter(r => !COORDS[r.fields['Region']]).map(r => r.fields['Region']);
  if (missing.length) console.warn('No coords defined for:', missing.join(', '));

  console.log(`Updating ${updates.length} regions…`);
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const result = await atReq('PATCH', `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`, { records: batch });
    if (result.error) { console.error('Update error:', result.error); process.exit(1); }
    process.stdout.write(`  ${Math.min(i + 10, updates.length)}/${updates.length}\r`);
  }
  console.log('\nDone.');
})();
