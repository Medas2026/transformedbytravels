#!/usr/bin/env node
// Find near-duplicate species records in Airtable and consolidate them.
//
// Detection: same species after case + hyphen + punctuation normalization.
//   e.g. "Grey Crowned Crane" == "Gray crowned crane" == "GREY-CROWNED CRANE"
//
// Merge: keep the record with the most Best Parks (or the most enriched if tied).
// Copy over Best Parks, Best Months, and Category (if canonical lacks one) from
// the losing record. Delete the loser.
//
// Usage:
//   AIRTABLE_API_KEY=... node scripts/dedupe-species.js --dry-run
//   AIRTABLE_API_KEY=... node scripts/dedupe-species.js
//
// Always run --dry-run first and review the plan. Then re-run without the flag.

const https = require('https');
const BASE_ID       = 'appdlxcWb45dIqNK2';
const SPECIES_TABLE = 'tblYtFaj6UYMUEwFQ';

const apiKey = process.env.AIRTABLE_API_KEY;
if (!apiKey) {
  console.error('AIRTABLE_API_KEY env var required');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const r = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('parse: ' + data.slice(0, 200))); }
      });
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

async function fetchAllSpecies() {
  const records = [];
  let offset = '';
  do {
    const qs = offset ? `?offset=${encodeURIComponent(offset)}` : '';
    const r = await req('GET', `/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}${qs}`);
    if (r.body.error) throw new Error(r.body.error.message || JSON.stringify(r.body.error));
    records.push(...(r.body.records || []));
    offset = r.body.offset || '';
  } while (offset);
  return records;
}

// Normalize a name aggressively: lowercase, unify hyphens, strip punctuation
function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[-‐–—]/g, ' ')       // hyphens and dashes → space
    .replace(/'/g, "'")             // curly to straight
    .replace(/[.,;:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bestParksArr(f) {
  const v = f['Best Parks'];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v) return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

function bestMonthsArr(f) {
  const v = f['Best Months'];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v) return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

// Score a record on how enriched it is — used to pick the canonical winner
function enrichmentScore(rec) {
  const f = rec.fields || {};
  let s = 0;
  s += (bestParksArr(f).length) * 10;
  s += (bestMonthsArr(f).length) * 2;
  if (f['Photo URL'])             s += 5;
  if (f['Scientific Name'])       s += 3;
  if (f['Description'])           s += 3;
  if (f['Habitat'])               s += 2;
  if (f['Conservation Status'])   s += 2;
  if (f['Category'])              s += 1;
  return s;
}

async function run() {
  console.log(`Loading all species${dryRun ? ' (DRY RUN)' : ''}...`);
  const all = await fetchAllSpecies();
  console.log(`  ${all.length} records loaded.`);

  // Group by normalized name
  const groups = {};
  for (const rec of all) {
    const name = rec.fields['Species Name'] || '';
    if (!name.trim()) continue;
    const key = normalize(name);
    if (!groups[key]) groups[key] = [];
    groups[key].push(rec);
  }

  // Find duplicate groups
  const dupGroups = Object.entries(groups).filter(([_, list]) => list.length > 1);
  console.log(`\nFound ${dupGroups.length} duplicate groups.\n`);

  if (!dupGroups.length) { console.log('Nothing to do.'); return; }

  const plan = [];
  for (const [key, list] of dupGroups) {
    // Sort by enrichment score descending
    list.sort((a, b) => enrichmentScore(b) - enrichmentScore(a));
    const winner = list[0];
    const losers = list.slice(1);

    // Merge Best Parks and Best Months from losers into winner (union)
    const wParks  = new Set(bestParksArr(winner.fields));
    const wMonths = new Set(bestMonthsArr(winner.fields));
    for (const l of losers) {
      bestParksArr(l.fields).forEach(p => wParks.add(p));
      bestMonthsArr(l.fields).forEach(m => wMonths.add(m));
    }
    const mergedParks  = [...wParks];
    const mergedMonths = [...wMonths];

    // Category: if winner's category is missing OR the questionable "Predator"
    // and a loser has a specific bird category, prefer the loser's category
    let mergedCategory = winner.fields['Category'] || '';
    const birdCats = new Set(['Songbird', 'Waterbird', 'Raptor', 'Storks', 'Other Bird']);
    if ((!mergedCategory || mergedCategory === 'Predator') && (winner.fields['Type'] === 'Bird' || losers.some(l => l.fields['Type'] === 'Bird'))) {
      for (const l of losers) {
        if (birdCats.has(l.fields['Category'])) {
          mergedCategory = l.fields['Category'];
          break;
        }
      }
    }

    // Fill any missing scalar fields on winner from losers
    const patchFields = { 'Best Parks': mergedParks };
    if (mergedMonths.length) patchFields['Best Months'] = mergedMonths;
    if (mergedCategory && mergedCategory !== winner.fields['Category']) patchFields['Category'] = mergedCategory;
    ['Scientific Name', 'Description', 'Habitat', 'Conservation Status', 'Photo URL', 'iNaturalist ID'].forEach(field => {
      if (!winner.fields[field]) {
        for (const l of losers) {
          if (l.fields[field]) { patchFields[field] = l.fields[field]; break; }
        }
      }
    });

    plan.push({ key, winner, losers, patchFields });
  }

  // Print the plan
  console.log('=== Plan ===\n');
  for (const p of plan) {
    console.log(`"${p.winner.fields['Species Name']}"  (canonical: ${p.winner.id})`);
    p.losers.forEach(l => {
      console.log(`   - DELETE "${l.fields['Species Name']}" (${l.id}) parks=${bestParksArr(l.fields).length}`);
    });
    const newParks = p.patchFields['Best Parks'] || [];
    console.log(`   → merged Best Parks (${newParks.length}): ${newParks.slice(0, 6).join(', ')}${newParks.length > 6 ? '...' : ''}`);
    if (p.patchFields['Category']) console.log(`   → set Category = ${p.patchFields['Category']}`);
    console.log('');
  }

  if (dryRun) {
    console.log('=== DRY RUN — no changes made. ===');
    console.log('Re-run without --dry-run to apply.');
    return;
  }

  // Apply the plan
  console.log('=== Applying changes ===\n');
  let patched = 0, deleted = 0, failed = 0;
  for (const p of plan) {
    try {
      // PATCH winner
      const r1 = await req('PATCH',
        `/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}/${p.winner.id}`,
        { fields: p.patchFields, typecast: true }
      );
      if (r1.body.error) throw new Error('PATCH: ' + (r1.body.error.message || JSON.stringify(r1.body.error)));
      patched++;

      // DELETE losers (up to 10 per batch)
      for (const l of p.losers) {
        const r2 = await req('DELETE', `/v0/${BASE_ID}/${encodeURIComponent(SPECIES_TABLE)}/${l.id}`);
        if (r2.body.error) throw new Error('DELETE ' + l.id + ': ' + (r2.body.error.message || JSON.stringify(r2.body.error)));
        deleted++;
      }
      console.log(`✓ ${p.winner.fields['Species Name']}: patched + deleted ${p.losers.length}`);
    } catch(e) {
      console.warn(`✗ ${p.winner.fields['Species Name']}: ${e.message}`);
      failed++;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n=== Summary ===`);
  console.log(`Patched:  ${patched}`);
  console.log(`Deleted:  ${deleted}`);
  console.log(`Failed:   ${failed}`);
}

run().catch(e => { console.error(e); process.exit(1); });
