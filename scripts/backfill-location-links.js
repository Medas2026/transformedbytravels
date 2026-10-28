// Backfill Locations linked records on existing TBT Wildlife species
// that have Best Parks text but no Locations links.
// Matches Best Parks keywords against Wildlife Locations names for the same region.
//
// Run: node scripts/backfill-location-links.js "Gorilla Countries" [--dry-run]

const BASE_ID         = 'appdlxcWb45dIqNK2';
const LOCATIONS_TABLE = 'Wildlife Locations';
const WILDLIFE_TABLE  = 'TBT Wildlife';
const DRY_RUN         = process.argv.includes('--dry-run');
const REGION          = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'Gorilla Countries';

const fs   = require('fs');
const path = require('path');
const KEY  = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY in .env.local'); process.exit(1); }

async function airtableFetch(table, qs, opts = {}) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${qs}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' }
  });
  return resp.json();
}

async function fetchAll(table, filter) {
  const records = [];
  let offset = '';
  do {
    let qs = offset ? `?offset=${encodeURIComponent(offset)}` : '';
    if (filter) qs = (qs ? qs + '&' : '?') + `filterByFormula=${encodeURIComponent(filter)}`;
    const data = await airtableFetch(table, qs);
    if (data.error) throw new Error(JSON.stringify(data.error));
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

(async () => {
  console.log(`\nBackfilling location links for: ${REGION}\n`);

  // Fetch Wildlife Locations for this region
  process.stdout.write('Fetching locations… ');
  const locRecords = await fetchAll(LOCATIONS_TABLE, `Region="${REGION}"`);
  console.log(`${locRecords.length} locations`);

  // Build lookup: keyword → record ID (try various normalizations)
  const locationMap = {};
  for (const r of locRecords) {
    const name = (r.fields['Location Name'] || '').trim();
    const add  = (key) => { if (key) locationMap[key.toLowerCase()] = r.id; };
    add(name);
    add(name.replace(/\s+(np|national park|national reserve|game reserve|conservation area|marine park|wildlife sanctuary|forest reserve|forest)\s*$/i, '').trim());
    // Also index individual words for partial matching
  }

  // Fetch species for this region that have no Locations links
  process.stdout.write('Fetching species without location links… ');
  const speciesRecords = await fetchAll(WILDLIFE_TABLE,
    `AND(FIND("${REGION}", ARRAYJOIN({Animal Regions}, ",")), LEN(ARRAYJOIN({Locations}, ""))=0)`
  );
  console.log(`${speciesRecords.length} species need backfill`);

  if (!speciesRecords.length) {
    console.log('Nothing to backfill.');
    return;
  }

  const toUpdate    = [];
  const noMatch     = [];

  for (const r of speciesRecords) {
    const name     = r.fields['Species Name'] || '';
    const bestParks = r.fields['Best Parks'] || [];

    if (!bestParks.length) {
      noMatch.push(`${name} (no Best Parks)`);
      continue;
    }

    const locationIds = new Set();
    for (const park of bestParks) {
      const parkLower = park.toLowerCase().trim();
      // Try exact match first
      if (locationMap[parkLower]) {
        locationIds.add(locationMap[parkLower]);
        continue;
      }
      // Try partial: check if any location name contains this park keyword
      for (const [key, id] of Object.entries(locationMap)) {
        if (key.includes(parkLower) || parkLower.includes(key)) {
          locationIds.add(id);
        }
      }
    }

    if (locationIds.size > 0) {
      console.log(`  ✓ ${name} — ${locationIds.size} locations (from: ${bestParks.join(', ')})`);
      toUpdate.push({ id: r.id, fields: { Locations: [...locationIds] } });
    } else {
      console.log(`  ✗ ${name} — no match (Best Parks: ${bestParks.join(', ')})`);
      noMatch.push(name);
    }
  }

  console.log(`\n${toUpdate.length} to update, ${noMatch.length} no match`);

  if (DRY_RUN) { console.log('Dry run — no changes written.'); return; }

  for (let i = 0; i < toUpdate.length; i += 10) {
    const batch = toUpdate.slice(i, i + 10);
    const data  = await airtableFetch(WILDLIFE_TABLE, '', {
      method: 'PATCH',
      body:   JSON.stringify({ records: batch })
    });
    if (data.error) throw new Error(JSON.stringify(data.error));
    process.stdout.write('.');
  }
  console.log(`\nDone — updated ${toUpdate.length} records.`);

  if (noMatch.length) {
    console.log(`\n── No location match (${noMatch.length}) ──`);
    noMatch.forEach(n => console.log(' ', n));
  }
})().catch(err => { console.error(err); process.exit(1); });
