// Geocode Wildlife Locations records missing lat/lng using OpenCage API
// Free tier: 2,500 requests/day, 1 request/second
//
// Run: AIRTABLE_API_KEY=xxx OPENCAGE_API_KEY=xxx node scripts/geocode-missing-coords.js
// Add --dry-run to preview without writing

const BASE_ID  = 'appdlxcWb45dIqNK2';
const TABLE    = 'Wildlife Locations';
const DRY_RUN  = process.argv.includes('--dry-run');
const DELAY_MS = 1100;

const AIRTABLE_KEY  = process.env.AIRTABLE_API_KEY;
const OPENCAGE_KEY  = process.env.OPENCAGE_API_KEY;

if (!AIRTABLE_KEY)  { console.error('Missing AIRTABLE_API_KEY');  process.exit(1); }
if (!OPENCAGE_KEY)  { console.error('Missing OPENCAGE_API_KEY');   process.exit(1); }

async function airtableFetch(path, opts = {}) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_KEY, 'Content-Type': 'application/json' }
  });
  return resp.json();
}

async function getAllRecords() {
  const records = [];
  let offset = '';
  do {
    const qs   = offset ? `?offset=${encodeURIComponent(offset)}` : '';
    const data = await airtableFetch(qs);
    if (data.error) throw new Error(data.error.message);
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

async function patchRecords(updates) {
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const data  = await airtableFetch('', {
      method: 'PATCH',
      body:   JSON.stringify({ records: batch })
    });
    if (data.error) throw new Error(data.error.message);
    process.stdout.write('.');
  }
  console.log();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocode(name, country) {
  const query = country ? `${name}, ${country}` : name;
  const url   = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(query)}&key=${OPENCAGE_KEY}&limit=1&no_annotations=1`;
  const resp  = await fetch(url);
  const data  = await resp.json();
  if (data.results && data.results.length > 0) {
    const { lat, lng } = data.results[0].geometry;
    return { lat, lng, confidence: data.results[0].confidence, formatted: data.results[0].formatted };
  }
  return null;
}

(async () => {
  console.log('Fetching records missing coordinates…');
  const records = await getAllRecords();
  const missing = records.filter(r => r.fields['Lattitude'] == null || r.fields['Longitude'] == null);
  console.log(`Found ${missing.length} records without coordinates\n`);

  const toUpdate = [];
  const failed   = [];

  for (let i = 0; i < missing.length; i++) {
    const r       = missing[i];
    const name    = (r.fields['Location Name'] || '').trim();
    const country = r.fields['Country'] || '';

    process.stdout.write(`[${i+1}/${missing.length}] ${name} … `);

    if (!name) { console.log('skip'); continue; }

    const result = await geocode(name, country);
    await sleep(DELAY_MS);

    if (result && result.confidence >= 4) {
      console.log(`✓ ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}  (${result.confidence}/10) — ${result.formatted}`);
      toUpdate.push({ id: r.id, fields: { Lattitude: result.lat, Longitude: result.lng } });
    } else if (result) {
      console.log(`⚠ low confidence (${result.confidence}/10) — ${result.formatted}`);
      failed.push({ name, reason: `low confidence: ${result.formatted}` });
    } else {
      console.log('✗ no result');
      failed.push({ name, reason: 'no result' });
    }
  }

  console.log(`\nReady to update: ${toUpdate.length}  |  Failed: ${failed.length}`);

  if (failed.length) {
    console.log('\n── Needs manual coordinates ──');
    failed.forEach(f => console.log(`  ${f.name}  (${f.reason})`));
  }

  if (DRY_RUN) { console.log('\nDry run — no changes written.'); return; }

  if (toUpdate.length) {
    console.log('\nWriting to Airtable…');
    await patchRecords(toUpdate);
    console.log(`Done — updated ${toUpdate.length} records.`);
  }
})().catch(err => { console.error(err); process.exit(1); });
