// Generate TBT Wildlife species records for a given region
// Fetches Wildlife Locations for the region, calls Claude Sonnet to generate
// a species list with location assignments, then creates records in TBT Wildlife.
//
// Run: node scripts/generate-species.js "East Africa" [--dry-run]
//      node scripts/generate-species.js "East Africa" --dry-run  ← preview only

const BASE_ID         = 'appdlxcWb45dIqNK2';
const LOCATIONS_TABLE = 'Wildlife Locations';
const WILDLIFE_TABLE  = 'TBT Wildlife';
const DRY_RUN         = process.argv.includes('--dry-run');
const REGION          = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'East Africa';

const fs   = require('fs');
const path = require('path');

const AIRTABLE_KEY  = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
const ANTHROPIC_KEY = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/ANTHROPIC_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();

if (!AIRTABLE_KEY)  { console.error('Missing AIRTABLE_API_KEY in .env.local');  process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('Missing ANTHROPIC_API_KEY in .env.local'); process.exit(1); }

async function airtableFetch(table, path, opts = {}) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_KEY, 'Content-Type': 'application/json' }
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

async function createRecords(table, records) {
  const results = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const data  = await airtableFetch(table, '', {
      method: 'POST',
      body:   JSON.stringify({ records: batch.map(f => ({ fields: f })) })
    });
    if (data.error) throw new Error(JSON.stringify(data.error));
    results.push(...(data.records || []));
    process.stdout.write('.');
  }
  console.log();
  return results;
}

async function generateSpecies(region, locations, existingNames) {
  const locationList = locations.map((l, i) =>
    `${i + 1}. ${l.name}${l.country ? ' (' + l.country + ')' : ''}`
  ).join('\n');

  const existingList = existingNames.length > 0
    ? `\nAlready in database (skip these): ${existingNames.join(', ')}`
    : '';

  const prompt = `You are generating wildlife data for a nature travel app. Region: ${region}.

Wildlife locations in this region:
${locationList}
${existingList}

Generate a comprehensive list of 60-80 iconic and notable animal species found across these locations. Include a diverse mix across the ecosystem — large mammals, predators, primates, birds (raptors, waterbirds, songbirds), reptiles, and any notable marine/freshwater species.

For each species include:
- Which specific locations from the list above it is found at (use the EXACT name from the list — no country suffixes, no parentheses, copy the name verbatim)
- Accurate ecological information

Use EXACTLY these Type values (no others): Mammal, Bird, Reptile, Amphibian, Insect
Use EXACTLY these Category values (no others): Big Five, Predator, Primate, Hoofed Mammal, Other Mammal, Raptor, Storks, Songbird, Waterbird, Other Bird
Use EXACTLY these Conservation Status values (full names, no abbreviations): Least Concern, Near Threatened, Vulnerable, Endangered, Critically Endangered
Best Months: abbreviated month names (Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec) — when the species is most reliably seen

For marine/aquatic species: use Type "Reptile" for fish/sharks/rays, Type "Mammal" for whales/dolphins/dugongs, and Category "Other Mammal" or "Other Bird" as appropriate.

Respond with a JSON array only — no markdown, no explanation:
[
  {
    "name": "African Lion",
    "scientific": "Panthera leo",
    "type": "Mammal",
    "category": "Big Five",
    "description": "The apex predator of the savanna, lions are most easily spotted in East Africa's open grasslands where prides of up to 30 can be seen hunting cooperatively at dawn and dusk.",
    "habitat": "Savanna, open woodland",
    "conservation": "Vulnerable",
    "locations": ["Serengeti", "Masai Mara", "Ngorongoro", "Tsavo East", "Tsavo West", "Amboseli"],
    "bestMonths": ["Jun", "Jul", "Aug", "Sep", "Oct"]
  },
  ...
]`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 16000,
      messages:   [{ role: 'user', content: prompt }]
    })
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  console.log(`  (stop_reason: ${data.stop_reason}, tokens: ${data.usage?.output_tokens})`);
  let text = (data.content?.[0]?.text || '[]').trim();
  text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  // If truncated (max_tokens), try to close the JSON array gracefully
  if (data.stop_reason === 'max_tokens') {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace >= 0) text = text.substring(0, lastBrace + 1) + ']';
  }
  return JSON.parse(text);
}

(async () => {
  console.log(`\nRegion: ${REGION}\n`);

  // 1. Fetch locations for this region
  process.stdout.write('Fetching locations… ');
  const locRecords = await fetchAll(LOCATIONS_TABLE, `Region="${REGION}"`);
  console.log(`${locRecords.length} locations`);
  if (!locRecords.length) { console.error('No locations found for region:', REGION); process.exit(1); }

  const locations = locRecords.map(r => ({
    id:      r.id,
    name:    (r.fields['Location Name'] || '').trim(),
    country: r.fields['Country'] || ''
  }));

  // Build lookup: normalized name → record ID
  const locationMap = {};
  for (const l of locations) {
    locationMap[l.name.toLowerCase()] = l.id;
    // Also map without parenthetical suffixes like "NP", "National Park"
    locationMap[l.name.toLowerCase().replace(/\s+(np|national park|national reserve|game reserve|conservation area|marine park|game park|wildlife sanctuary|forest reserve|forest)\s*$/i, '').trim()] = l.id;
  }

  // 2. Fetch existing species for this region (to avoid duplicates)
  process.stdout.write('Checking existing species… ');
  const existingRecords = await fetchAll(WILDLIFE_TABLE,
    `FIND("${REGION}", ARRAYJOIN({Animal Regions}, ",")) > 0`);
  const existingNames = existingRecords.map(r => r.fields['Species Name']).filter(Boolean);
  console.log(`${existingNames.length} already in database`);

  // 3. Generate species via Claude
  console.log('Generating species list via Claude Sonnet…');
  const species = await generateSpecies(REGION, locations, existingNames);
  console.log(`\nClaude returned ${species.length} species`);

  // Deduplicate for dry-run preview too
  const seenDry = new Set();
  const dedupedDry = species.filter(s => {
    const key = s.name.toLowerCase();
    if (seenDry.has(key)) return false;
    seenDry.add(key); return true;
  });

  if (DRY_RUN) {
    console.log('\n── Preview ──');
    let unmatched = 0;
    dedupedDry.forEach(s => {
      const ids = (s.locations || []).map(name => {
        const id = locationMap[name.toLowerCase()] ||
                   locationMap[name.toLowerCase().replace(/\s+(np|national park|national reserve|game reserve|conservation area|marine park|game park|wildlife sanctuary|forest reserve|forest)\s*$/i, '').trim()];
        return id ? name : `⚠ ${name}`;
      });
      const warned = ids.filter(i => i.startsWith('⚠')).length;
      unmatched += warned;
      console.log(`  ${s.name} (${s.type}/${s.category}) — ${s.conservation} — ${ids.length} locations`);
      if (warned) console.log(`    Unmatched: ${ids.filter(i=>i.startsWith('⚠')).join(', ')}`);
    });
    console.log(`\nTotal: ${dedupedDry.length} species, ${unmatched} unmatched location names`);
    console.log('Dry run — no changes written.');
    return;
  }

  // 4. Deduplicate species by name (keep first occurrence)
  const seen = new Set();
  const deduped = species.filter(s => {
    const key = s.name.toLowerCase();
    if (seen.has(key)) { console.log(`  ↷ duplicate: ${s.name}`); return false; }
    seen.add(key);
    return true;
  });
  console.log(`After dedup: ${deduped.length} species\n`);

  // Map location names to IDs and build Airtable records
  const toCreate = [];
  const unmatchedLog = [];

  for (const s of deduped) {
    // Skip if already exists (case-insensitive name match)
    if (existingNames.some(n => n.toLowerCase() === s.name.toLowerCase())) {
      console.log(`  ↷ skip (exists): ${s.name}`);
      continue;
    }

    const locationIdSet = new Set();
    for (const locName of (s.locations || [])) {
      const stripped = locName.toLowerCase()
        .replace(/\s*\([^)]+\)\s*$/, '')    // strip "(Country)" suffixes
        .replace(/\s+(np|national park|national reserve|game reserve|conservation area|marine park|game park|wildlife sanctuary|forest reserve|forest)\s*$/i, '')
        .trim();
      const id = locationMap[locName.toLowerCase()] || locationMap[stripped];
      if (id) {
        locationIdSet.add(id);
      } else {
        unmatchedLog.push(`${s.name} → "${locName}"`);
      }
    }
    const locationIds = [...locationIdSet];

    const clean = v => (v || '').replace(/^["']+|["']+$/g, '').trim();

    const CONSERVATION = {
      'lc': 'Least Concern', 'nt': 'Near Threatened', 'vu': 'Vulnerable',
      'en': 'Endangered',    'cr': 'Critically Endangered',
      'least concern': 'Least Concern', 'near threatened': 'Near Threatened',
      'vulnerable': 'Vulnerable', 'endangered': 'Endangered',
      'critically endangered': 'Critically Endangered'
    };
    const VALID_TYPES  = new Set(['Mammal','Bird','Reptile','Amphibian','Insect']);
    const VALID_CATS   = new Set(['Big Five','Predator','Primate','Hoofed Mammal','Other Mammal','Raptor','Storks','Songbird','Waterbird','Other Bird']);

    const rawType = clean(s.type);
    const rawCat  = clean(s.category);
    const rawCons = clean(s.conservation).toLowerCase();

    const finalType = VALID_TYPES.has(rawType) ? rawType : 'Mammal';
    const finalCat  = VALID_CATS.has(rawCat)   ? rawCat  : 'Other Mammal';
    const finalCons = CONSERVATION[rawCons] || 'Least Concern';

    toCreate.push({
      'Species Name':        clean(s.name),
      'Scientific Name':     clean(s.scientific),
      'Type':                finalType,
      'Category':            finalCat,
      'Description':         clean(s.description),
      'Habitat':             clean(s.habitat),
      'Conservation Status': finalCons,
      'Animal Regions':      [REGION],
      'Locations':           locationIds,
      'Best Months':         (s.bestMonths || []).map(m => clean(m)).filter(Boolean)
    });
  }

  console.log(`\nCreating ${toCreate.length} species records…`);
  await createRecords(WILDLIFE_TABLE, toCreate);
  console.log(`Done — created ${toCreate.length} records in TBT Wildlife.\n`);

  if (unmatchedLog.length) {
    console.log(`── Unmatched location names (${unmatchedLog.length}) ──`);
    unmatchedLog.forEach(m => console.log(' ', m));
  }
})().catch(err => { console.error(err); process.exit(1); });
