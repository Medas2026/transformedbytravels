// Fill blank Photo URL fields on the Animals table using iNaturalist.
// Usage: AIRTABLE_API_KEY=xxx node scripts/fill-species-photos.js
//
// What it does:
//   1. Fetches every Animals record whose Photo URL is blank
//   2. If the record has an iNaturalist ID, pulls the default photo from iNaturalist
//      (medium size, ~500px wide) and writes the URL back
//   3. If no iNaturalist ID but Scientific Name is present, searches iNaturalist
//      for the taxon and uses whatever it finds
//   4. Skips species with no ID and no scientific name
//   5. Writes attribution back to the "Photo Credit" field if it exists
//
// Rate limits:
//   iNaturalist asks for max ~1 request/second. This script waits 1.1s between calls.
//   For ~200 species, that's about 4 minutes.

const https = require('https');

const AIRTABLE_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID      = 'appdlxcWb45dIqNK2';
const TABLE_ID     = 'tblYtFaj6UYMUEwFQ'; // Animals

if (!AIRTABLE_KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }

// ── Airtable helpers ──────────────────────────────────────────────────────────

function airtableRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${AIRTABLE_KEY}`,
        'Content-Type':  'application/json',
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Airtable parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function fetchAllAnimals() {
  const all = [];
  let offset = '';
  do {
    const qs = new URLSearchParams();
    if (offset) qs.set('offset', offset);
    qs.set('pageSize', '100');
    const data = await airtableRequest('GET', `/v0/${BASE_ID}/${TABLE_ID}?${qs.toString()}`, null);
    if (data.error) throw new Error(JSON.stringify(data.error));
    all.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return all;
}

function updateAnimal(id, fields) {
  return airtableRequest('PATCH', `/v0/${BASE_ID}/${TABLE_ID}/${id}`, { fields });
}

// ── iNaturalist helpers ───────────────────────────────────────────────────────

function iNatGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.inaturalist.org',
      path,
      method:   'GET',
      headers:  { 'User-Agent': 'ThreeRealmsTravel/1.0 (photo backfill)' },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('iNat parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Fetch a taxon by iNaturalist ID → return { url, attribution } or null
async function getPhotoByINatId(id) {
  const data = await iNatGet(`/v1/taxa/${encodeURIComponent(id)}`);
  const t    = (data.results || [])[0];
  if (!t || !t.default_photo) return null;
  const p = t.default_photo;
  return {
    url:         p.medium_url || p.url || p.large_url || '',
    attribution: p.attribution || '',
    licenseCode: p.license_code || '',
  };
}

// Search iNaturalist by scientific name → return { url, attribution, taxonId } or null
async function getPhotoByScientificName(name) {
  const data = await iNatGet(`/v1/taxa?q=${encodeURIComponent(name)}&per_page=1`);
  const t    = (data.results || [])[0];
  if (!t || !t.default_photo) return null;
  const p = t.default_photo;
  return {
    url:         p.medium_url || p.url || p.large_url || '',
    attribution: p.attribution || '',
    licenseCode: p.license_code || '',
    taxonId:     t.id,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching Animals records from Airtable…');
  const records = await fetchAllAnimals();
  console.log(`  Found ${records.length} total records`);

  const missing = records.filter(r => !((r.fields['Photo URL'] || '').trim()));
  console.log(`  ${missing.length} records missing a Photo URL`);

  let filled = 0, skipped = 0, failed = 0;

  for (const r of missing) {
    const f       = r.fields;
    const name    = (f['Species Name']    || '').trim();
    const sciName = (f['Scientific Name'] || '').trim();
    const inatId  = (f['iNaturalist ID']  || '').toString().trim();

    if (!name && !sciName) { skipped++; continue; }

    process.stdout.write(`  ${name || sciName} … `);

    let photo = null;
    try {
      if (inatId) {
        photo = await getPhotoByINatId(inatId);
      } else if (sciName) {
        photo = await getPhotoByScientificName(sciName);
      }
    } catch(e) {
      console.log(`ERROR: ${e.message}`);
      failed++;
      await new Promise(r => setTimeout(r, 1100));
      continue;
    }

    if (!photo || !photo.url) {
      console.log('no photo found');
      skipped++;
      await new Promise(r => setTimeout(r, 1100));
      continue;
    }

    const fields = { 'Photo URL': photo.url };
    if (photo.taxonId && !inatId) fields['iNaturalist ID'] = String(photo.taxonId);
    if (photo.attribution && 'Photo Credit' in f) fields['Photo Credit'] = photo.attribution;

    const upd = await updateAnimal(r.id, fields);
    if (upd.error) {
      console.log(`Airtable ERROR: ${JSON.stringify(upd.error).slice(0,120)}`);
      failed++;
    } else {
      console.log('✓');
      filled++;
    }

    await new Promise(r => setTimeout(r, 1100)); // iNat rate limit courtesy
  }

  console.log('\nDone.');
  console.log(`  Filled:  ${filled}`);
  console.log(`  Skipped: ${skipped} (no ID/scientific name, or no photo on iNat)`);
  console.log(`  Failed:  ${failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
