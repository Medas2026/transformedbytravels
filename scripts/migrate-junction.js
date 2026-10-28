// Phase 2: populate the Itinerary Places junction from existing Itinerary Stops.
// Usage:
//   Dry run (safe, no writes):  AIRTABLE_API_KEY=xxx node scripts/migrate-junction.js
//   Live run:                   AIRTABLE_API_KEY=xxx node scripts/migrate-junction.js --live
//
// What it does:
//   1. Reads every Itinerary record (name → record ID map)
//   2. Reads every Itinerary Stops record
//   3. For each stop, matches its text "Itineraries" field to an Itinerary record ID
//   4. Creates one Itinerary Places record per stop with:
//        - Itinerary  (link)  = matched itinerary ID
//        - Place      (link)  = current stop's record ID
//        - Stop Order (int)   = current stop's Stop Number
//        - Nights             = blank (fill in manually per itinerary later)
//   5. Idempotent: skips a junction record if one already exists for that
//      Itinerary+Place combination.

const https = require('https');

const AIRTABLE_KEY   = process.env.AIRTABLE_API_KEY;
const BASE_ID        = 'appdlxcWb45dIqNK2';
const TABLE_ITINS    = 'Itineraries';
const TABLE_STOPS    = 'Itinerary Stops';
const TABLE_JUNCTION = 'Itinerary Places';
const LIVE           = process.argv.includes('--live');

if (!AIRTABLE_KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }

console.log(LIVE ? '=== LIVE RUN (will write) ===' : '=== DRY RUN (no writes) ===');

// ── Airtable helpers ──────────────────────────────────────────────────────────

function airtableRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com', path, method,
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
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function fetchAll(table) {
  const enc = encodeURIComponent(table);
  const all = [];
  let offset = '';
  do {
    const qs = new URLSearchParams();
    if (offset) qs.set('offset', offset);
    qs.set('pageSize', '100');
    const data = await airtableRequest('GET', `/v0/${BASE_ID}/${enc}?${qs.toString()}`, null);
    if (data.error) throw new Error(`${table}: ${JSON.stringify(data.error)}`);
    all.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return all;
}

function createJunction(fields) {
  return airtableRequest('POST', `/v0/${BASE_ID}/${encodeURIComponent(TABLE_JUNCTION)}`, { fields });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n1. Reading Itineraries…');
  const itinRecs = await fetchAll(TABLE_ITINS);
  const itinByName = new Map();
  itinRecs.forEach(r => {
    const name = ((r.fields || {})['Itineraries'] || '').trim();
    if (name) itinByName.set(name.toLowerCase(), { id: r.id, name });
  });
  console.log(`   Found ${itinRecs.length} itineraries`);

  console.log('\n2. Reading Itinerary Stops…');
  const stopRecs = await fetchAll(TABLE_STOPS);
  console.log(`   Found ${stopRecs.length} stops`);

  console.log('\n3. Reading existing Itinerary Places (for idempotency)…');
  let existing = [];
  try { existing = await fetchAll(TABLE_JUNCTION); }
  catch(e) { console.log(`   (couldn't read junction — table may not exist yet: ${e.message})`); return; }
  const existingKeys = new Set(existing.map(r => {
    const f = r.fields || {};
    const it = (f['Itinerary'] || [])[0];
    const pl = (f['Place']     || [])[0];
    return it && pl ? `${it}|${pl}` : null;
  }).filter(Boolean));
  console.log(`   Found ${existing.length} existing junction records`);

  console.log('\n4. Planning junction rows…');
  const toCreate = [];
  const problems = [];

  stopRecs.forEach(sr => {
    const f       = sr.fields || {};
    const itName  = ((f['Itineraries'] || '')).trim();
    const stopName = (f['Stop Name']  || '').trim();
    const stopNum = f['Stop Number'];

    if (!itName) { problems.push(`Stop "${stopName || sr.id}" has no Itineraries text — skipped`); return; }
    const itin = itinByName.get(itName.toLowerCase());
    if (!itin) { problems.push(`Stop "${stopName}": no Itinerary matches "${itName}" — skipped`); return; }

    const key = `${itin.id}|${sr.id}`;
    if (existingKeys.has(key)) {
      // already migrated
      return;
    }

    toCreate.push({
      stopName,
      itName,
      itineraryId: itin.id,
      placeId:     sr.id,
      stopOrder:   (stopNum == null || stopNum === '') ? null : Number(stopNum),
    });
  });

  console.log(`   ${toCreate.length} junction rows to create`);
  console.log(`   ${existing.length} already present (idempotent skip)`);
  if (problems.length) {
    console.log(`   ${problems.length} problems:`);
    problems.forEach(p => console.log(`     - ${p}`));
  }

  if (!toCreate.length) {
    console.log('\nNothing to create. Done.');
    return;
  }

  console.log(`\n5. ${LIVE ? 'Creating' : 'Would create'}:`);
  toCreate.forEach(r => {
    const order = r.stopOrder == null ? '?' : r.stopOrder;
    console.log(`   [${order}] ${r.itName} → ${r.stopName}`);
  });

  if (!LIVE) {
    console.log('\n(Dry run complete. Re-run with --live to write.)');
    return;
  }

  console.log('\n6. Writing…');
  let ok = 0, err = 0;
  for (const r of toCreate) {
    const fields = {
      Itinerary: [r.itineraryId],
      Place:     [r.placeId],
    };
    if (r.stopOrder != null) fields['Stop Order'] = r.stopOrder;

    const resp = await createJunction(fields);
    if (resp.error) {
      console.log(`   ERROR ${r.itName} → ${r.stopName}: ${JSON.stringify(resp.error).slice(0,120)}`);
      err++;
    } else {
      ok++;
    }
    await new Promise(res => setTimeout(res, 200));
  }
  console.log(`\nDone. Created ${ok}, errors ${err}.`);
}

main().catch(err => { console.error(err); process.exit(1); });
