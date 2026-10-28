// Fetch Wikimedia Commons photos for TBT Wildlife species missing Photo URL
// Uses scientific name for best accuracy, falls back to common name
// Stores the direct Wikimedia thumbnail URL in the Photo URL field
//
// Run: node scripts/fetch-species-photos.js [--dry-run]

const BASE_ID  = 'appdlxcWb45dIqNK2';
const TABLE    = 'TBT Wildlife';
const DRY_RUN  = process.argv.includes('--dry-run');
const DELAY_MS = 500;

// Geographic prefixes that confuse Wikipedia lookups (e.g. "African Buffalo" → try "Buffalo" too)
const GEO_PREFIXES = ['African ', 'Asian ', 'American ', 'Bornean ', 'Indian ', 'Australian ',
  'Eastern ', 'Western ', 'Southern ', 'Northern ', 'European ', 'Madagascar '];

const fs   = require('fs');
const path = require('path');
const KEY  = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY'); process.exit(1); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function airtableFetch(qs, opts = {}) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${qs}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' }
  });
  return resp.json();
}

async function fetchAll() {
  const records = [];
  let offset = '';
  do {
    const qs   = offset ? `?offset=${encodeURIComponent(offset)}` : '';
    const data = await airtableFetch(qs);
    if (data.error) throw new Error(JSON.stringify(data.error));
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

async function wikimediaPhoto(scientificName, commonName) {
  const queries = [scientificName, commonName].filter(Boolean);
  // Try prefix-stripped common name as extra fallback (e.g. "African Buffalo" → "Buffalo")
  if (commonName) {
    for (const pfx of GEO_PREFIXES) {
      if (commonName.startsWith(pfx)) { queries.push(commonName.slice(pfx.length)); break; }
    }
  }
  for (const query of queries) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      const resp = await fetch(url, { headers: { 'User-Agent': 'ThreeRealmsTravel/1.0 (wildlife guide app)' } });
      if (!resp.ok) continue;
      const data = await resp.json();
      const img = data.originalimage || data.thumbnail;
      if (img?.source) return img.source;
    } catch { /* try next */ }
    await sleep(200);
  }
  return null;
}

async function patchRecords(updates) {
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const data  = await airtableFetch('', {
      method: 'PATCH',
      body:   JSON.stringify({ records: batch })
    });
    if (data.error) throw new Error(JSON.stringify(data.error));
    process.stdout.write('.');
  }
  console.log();
}

(async () => {
  console.log('Fetching TBT Wildlife records…');
  const records = await fetchAll();
  const missing = records.filter(r => !r.fields['Photo URL']);
  console.log(`${records.length} total — ${missing.length} missing Photo URL\n`);

  if (!missing.length) { console.log('All species already have photos.'); return; }

  const toUpdate = [];
  const failed   = [];

  for (let i = 0; i < missing.length; i++) {
    const r       = missing[i];
    const common  = r.fields['Species Name'] || '';
    const sci     = r.fields['Scientific Name'] || '';

    process.stdout.write(`[${i + 1}/${missing.length}] ${common} (${sci}) … `);

    const url = await wikimediaPhoto(sci, common);
    await sleep(DELAY_MS);

    if (url) {
      console.log('✓');
      toUpdate.push({ id: r.id, fields: { 'Photo URL': url } });
    } else {
      console.log('✗ not found');
      failed.push(common);
    }

    // Write in batches of 50 to avoid losing progress
    if (toUpdate.length && toUpdate.length % 50 === 0) {
      if (!DRY_RUN) {
        process.stdout.write(`  [writing batch…] `);
        await patchRecords(toUpdate.slice(-50));
      }
    }
  }

  console.log(`\nFound: ${toUpdate.length}  |  Not found: ${failed.length}`);

  if (DRY_RUN) { console.log('Dry run — no changes written.'); return; }

  console.log(`Writing ${toUpdate.length} Photo URLs to Airtable…`);
  await patchRecords(toUpdate);
  console.log(`Done.`);

  if (failed.length) {
    console.log(`\n── Not found (${failed.length}) ──`);
    failed.slice(0, 20).forEach(n => console.log(' ', n));
    if (failed.length > 20) console.log(`  … and ${failed.length - 20} more`);
  }
})().catch(err => { console.error(err); process.exit(1); });
