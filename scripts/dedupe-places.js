// Phase 3: deduplicate Itinerary Stops (Places) by Stop Name.
// Usage:
//   Dry run:  AIRTABLE_API_KEY=xxx node scripts/dedupe-places.js
//   Live:     AIRTABLE_API_KEY=xxx node scripts/dedupe-places.js --live
//
// What it does:
//   1. Reads all Itinerary Stops records
//   2. Groups by Stop Name (case-insensitive, trimmed)
//   3. For each group with 2+ records:
//        - Picks a MASTER (the record with the most non-empty content fields)
//        - Merges fields from duplicate(s) into master where master is empty
//        - Redirects every "Itinerary Places" junction row from duplicate → master
//        - Redirects every "Activities" row from duplicate → master
//        - Deletes the duplicate stop record
//
// Content fields considered (master gets duplicate's value only if master's is empty):
//   Description, Why Stop Here, Suggested Time Here, Insider Tip,
//   Hero Photo, Latitude, Longitude, Continent, Country, Region, Hide Animals

const https = require('https');

const AIRTABLE_KEY   = process.env.AIRTABLE_API_KEY;
const BASE_ID        = 'appdlxcWb45dIqNK2';
const TABLE_STOPS    = 'Itinerary Stops';
const TABLE_JUNCTION = 'Itinerary Places';
const TABLE_ACTS     = 'Activities';
const LIVE           = process.argv.includes('--live');

const MERGE_FIELDS = [
  'Description',
  'Why Stop Here',
  'Suggested Time Here',
  'Insider Tip',
  'Hero Photo',
  'Latitude',
  'Longitude',
  'Continent',
  'Country',
  'Region',
  'Hide Animals',
];

if (!AIRTABLE_KEY) { console.error('AIRTABLE_API_KEY not set'); process.exit(1); }

console.log(LIVE ? '=== LIVE RUN (will write and delete) ===' : '=== DRY RUN (no writes) ===');

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
        try { resolve(data ? JSON.parse(data) : {}); }
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

function updateRec(table, id, fields) {
  return airtableRequest('PATCH', `/v0/${BASE_ID}/${encodeURIComponent(table)}/${id}`, { fields });
}
function deleteRec(table, id) {
  return airtableRequest('DELETE', `/v0/${BASE_ID}/${encodeURIComponent(table)}/${id}`, null);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Merge logic ───────────────────────────────────────────────────────────────

function isEmpty(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

function contentScore(rec) {
  const f = rec.fields || {};
  let score = 0;
  MERGE_FIELDS.forEach(k => { if (!isEmpty(f[k])) score++; });
  return score;
}

function planMerge(master, duplicate) {
  const mf = master.fields    || {};
  const df = duplicate.fields || {};
  const patch = {};
  MERGE_FIELDS.forEach(k => {
    if (isEmpty(mf[k]) && !isEmpty(df[k])) patch[k] = df[k];
  });
  return patch;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n1. Reading Itinerary Stops…');
  const stops = await fetchAll(TABLE_STOPS);
  console.log(`   Found ${stops.length}`);

  // Group by trimmed lowercase Stop Name
  const groups = new Map();
  stops.forEach(r => {
    const name = ((r.fields || {})['Stop Name'] || '').trim();
    if (!name) return; // skip orphans (should be deleted manually already)
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  const duplicated = [...groups.entries()].filter(([, list]) => list.length > 1);
  console.log(`\n2. Duplicate groups (Stop Name shared by 2+ records): ${duplicated.length}`);

  if (!duplicated.length) {
    console.log('\nNo duplicates. Nothing to do.');
    return;
  }

  console.log('\n3. Reading Itinerary Places junction…');
  const junction = await fetchAll(TABLE_JUNCTION);
  console.log(`   Found ${junction.length}`);

  console.log('\n4. Reading Activities…');
  let activities = [];
  try { activities = await fetchAll(TABLE_ACTS); }
  catch(e) { console.log(`   (skipped: ${e.message})`); }
  console.log(`   Found ${activities.length}`);

  const plans = [];

  duplicated.forEach(([key, records]) => {
    const scored = records.map(r => ({ r, score: contentScore(r) }))
      .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));
    const master = scored[0].r;
    const dupes  = scored.slice(1).map(x => x.r);

    dupes.forEach(dup => {
      const patch = planMerge(master, dup);
      const juncToRedirect = junction.filter(j => ((j.fields || {})['Place'] || [])[0] === dup.id);
      const actsToRedirect = activities.filter(a => ((a.fields || {})['Place'] || [])[0] === dup.id);
      plans.push({
        stopName:    (master.fields['Stop Name'] || '').trim(),
        masterId:    master.id,
        masterScore: scored[0].score,
        dupId:       dup.id,
        dupScore:    scored.find(x => x.r.id === dup.id).score,
        patch,
        juncIds:     juncToRedirect.map(j => j.id),
        actIds:      actsToRedirect.map(a => a.id),
      });
    });
  });

  console.log('\n5. Planned merges:');
  plans.forEach(p => {
    console.log(`\n   ${p.stopName}`);
    console.log(`     Master: ${p.masterId} (score ${p.masterScore})`);
    console.log(`     Duplicate to remove: ${p.dupId} (score ${p.dupScore})`);
    const patchKeys = Object.keys(p.patch);
    if (patchKeys.length) console.log(`     Fields to fill on master: ${patchKeys.join(', ')}`);
    else                  console.log(`     Fields to fill on master: (none — master already complete)`);
    console.log(`     Junction rows to redirect: ${p.juncIds.length}`);
    console.log(`     Activities to redirect:    ${p.actIds.length}`);
  });

  if (!LIVE) {
    console.log('\n(Dry run complete. Re-run with --live to execute.)');
    return;
  }

  console.log('\n6. Executing…');
  let ok = 0, err = 0;
  for (const p of plans) {
    try {
      // 1. Merge content into master
      if (Object.keys(p.patch).length) {
        const r = await updateRec(TABLE_STOPS, p.masterId, p.patch);
        if (r.error) throw new Error('master patch: ' + JSON.stringify(r.error));
        await sleep(200);
      }
      // 2. Redirect junction rows
      for (const jid of p.juncIds) {
        const r = await updateRec(TABLE_JUNCTION, jid, { Place: [p.masterId] });
        if (r.error) throw new Error('junction: ' + JSON.stringify(r.error));
        await sleep(200);
      }
      // 3. Redirect activity rows
      for (const aid of p.actIds) {
        const r = await updateRec(TABLE_ACTS, aid, { Place: [p.masterId] });
        if (r.error) throw new Error('activity: ' + JSON.stringify(r.error));
        await sleep(200);
      }
      // 4. Delete duplicate
      const r = await deleteRec(TABLE_STOPS, p.dupId);
      if (r.error) throw new Error('delete: ' + JSON.stringify(r.error));
      await sleep(200);

      console.log(`   ✓ ${p.stopName}`);
      ok++;
    } catch(e) {
      console.log(`   ✗ ${p.stopName}: ${e.message}`);
      err++;
    }
  }
  console.log(`\nDone. Merged ${ok}, errors ${err}.`);
}

main().catch(err => { console.error(err); process.exit(1); });
