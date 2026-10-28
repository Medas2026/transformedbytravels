// Two-step script for Galápagos:
//   1. Create 8 Wildlife Location records (one per island)
//   2. Link each Galápagos species (already inserted) to the matching islands
//      via the Species.Locations field (which appears as "TBT Wildlife" on
//      the Wildlife Locations side).
//
// Run: node scripts/link-galapagos-locations.js [--dry-run]

const fs   = require('fs');
const path = require('path');
const DRY  = process.argv.includes('--dry-run');

const BASE_ID  = 'appdlxcWb45dIqNK2';
const T_LOC    = 'Wildlife Locations';
const T_SPEC   = 'tblYtFaj6UYMUEwFQ'; // Species / "TBT Wildlife" table
const KEY = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY'); process.exit(1); }

// The 8 island records to create. Lat/lng from earlier Places entries; all
// Ocean=true because they're volcanic islands with heavy marine wildlife. Land
// = true because they all have terrestrial species too.
const ISLANDS = [
  { name: 'Isabela',              lat: -0.50, lng: -91.00 },
  { name: 'Santa Cruz Island',    lat: -0.65, lng: -90.35 },
  { name: 'San Cristóbal Island', lat: -0.85, lng: -89.40 },
  { name: 'Pinzon Island',        lat: -0.60, lng: -90.70 },
  { name: 'Darwin Island',        lat:  1.68, lng: -91.99 },
  { name: 'Wolf Island',          lat:  1.38, lng: -91.82 },
  { name: 'Espanola Island',      lat: -1.37, lng: -89.65 },
  { name: 'Floreana Island',      lat: -1.28, lng: -90.42 },
];

async function airtable(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}${path}`, opts);
  return resp.json();
}

async function fetchAll(table, params) {
  const records = [];
  let offset = '';
  do {
    const p = new URLSearchParams(params || {});
    if (offset) p.set('offset', offset);
    const data = await airtable(`/${encodeURIComponent(table)}${p.toString() ? '?' + p : ''}`);
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

async function main() {
  console.log(`${DRY ? '[DRY RUN] ' : ''}Linking Galápagos species → Wildlife Locations`);

  // ── Step 1: Create Wildlife Location records ──────────────────────────────
  console.log('\n1. Checking existing Wildlife Locations for Galapagos Islands…');
  const existing = await fetchAll(T_LOC, {
    filterByFormula: `{Region}="Galapagos Islands"`,
  });
  const existingByName = new Map(existing.map(r => [r.fields['Location Name'], r.id]));
  console.log(`   Found ${existing.length} existing records:`, [...existingByName.keys()]);

  const toCreate = ISLANDS.filter(i => !existingByName.has(i.name));
  console.log(`   Need to create ${toCreate.length}: ${toCreate.map(i => i.name).join(', ') || '(none)'}`);

  if (toCreate.length && !DRY) {
    for (let i = 0; i < toCreate.length; i += 10) {
      const batch = toCreate.slice(i, i + 10);
      const body = {
        typecast: true,
        records: batch.map(isl => ({
          fields: {
            'Location Name': isl.name,
            'Region':        'Galapagos Islands',
            'Continent':     'South America',
            'Country':       'Ecuador',
          },
        })),
      };
      const data = await airtable(`/${encodeURIComponent(T_LOC)}`, 'POST', body);
      if (data.error) { console.error('   ✗ Batch failed:', data.error); process.exit(1); }
      data.records.forEach(r => existingByName.set(r.fields['Location Name'], r.id));
      console.log(`   ✓ Created ${data.records.length}`);
    }
  }

  // ── Step 2: Link Galápagos species → their island Wildlife Location IDs ───
  console.log('\n2. Fetching Galápagos species…');
  const species = await fetchAll(T_SPEC, {
    filterByFormula: `FIND("Galapagos Islands",ARRAYJOIN({Animal Regions},","))`,
  });
  console.log(`   Found ${species.length} species tagged Galapagos Islands`);

  const updates = [];
  for (const s of species) {
    const parks = Array.isArray(s.fields['Best Parks']) ? s.fields['Best Parks'] : [];
    const locIds = parks
      .map(p => existingByName.get(p))
      .filter(Boolean);
    if (!locIds.length) {
      console.log(`   · ${s.fields['Species Name']}: no matching Wildlife Locations (parks: ${parks.join(', ')})`);
      continue;
    }
    const existingLocs = Array.isArray(s.fields['Locations']) ? s.fields['Locations'] : [];
    const merged = Array.from(new Set([...existingLocs, ...locIds]));
    if (existingLocs.length === merged.length && existingLocs.every(id => merged.includes(id))) {
      continue; // already up to date
    }
    updates.push({ id: s.id, fields: { 'Locations': merged } });
    console.log(`   → ${s.fields['Species Name']}: linking to ${locIds.length} island${locIds.length===1?'':'s'}`);
  }

  console.log(`\n   ${updates.length} species need linking`);
  if (!updates.length) { console.log('   Nothing to do.'); return; }

  if (DRY) { console.log('[DRY RUN] Skipping PATCH.'); return; }

  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const data = await airtable(`/${encodeURIComponent(T_SPEC)}`, 'PATCH', { records: batch });
    if (data.error) { console.error('   ✗ PATCH batch failed:', data.error); process.exit(1); }
    console.log(`   ✓ PATCHed ${data.records.length}`);
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
