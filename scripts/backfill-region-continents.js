// Backfill Continent field on Animal Regions table
// Run: node scripts/backfill-region-continents.js [--dry-run]

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Animal Regions';
const DRY_RUN = process.argv.includes('--dry-run');

const fs   = require('fs');
const path = require('path');
const KEY  = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY'); process.exit(1); }

const REGION_CONTINENT = {
  // Africa
  'East Africa':               'Africa',
  'South Africa':              'Africa',
  'Botswana':                  'Africa',
  'Namibia':                   'Africa',
  'Ethiopia':                  'Africa',
  'Gorilla Countries':         'Africa',
  'Mozambique':                'Africa',
  'Madagascar':                'Africa',

  // Asia
  'Northern India':            'Asia',
  'Indian Tigers & Rhinos':    'Asia',
  'Indian Specialty Wildlife': 'Asia',
  'Borneo':                    'Asia',
  'Sri Lanka':                 'Asia',
  'Indonesia':                 'Asia',
  'Japan':                     'Asia',

  // North America
  'Central America':           'North America',
  'Yellowstone':               'North America',
  'Alaska & Yukon':            'North America',
  'Canadian Arctic':           'North America',
  'Canadian Rockies':          'North America',
  'Mexico':                    'North America',
  'Lake Superior':             'North America',
  'Pacific Coast':             'North America',

  // South America
  'Galápagos':                 'South America',
  'Amazon':                    'South America',
  'Andes':                     'South America',
  'Pantanal':                  'South America',
  'Patagonia':                 'South America',
  'Antarctica & Falklands':    'South America',

  // Oceania
  'Australia':                 'Oceania',
  'New Zealand':               'Oceania',
  'Philippines':               'Oceania',
  'Papua New Guinea':          'Oceania',
  'Micronesia':                'Oceania',
  'Fiji':                      'Oceania',

  // Europe
  'Svalbard':                  'Europe',
  'European Wildlife':         'Europe',
  'Iceland':                   'Europe',

  // Typo variant in Airtable
  'Phillipines':               'Oceania',
};

async function airtableFetch(qs, opts = {}) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${qs}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  });
  return resp.json();
}

(async () => {
  console.log('Fetching Animal Regions…');
  const records = [];
  let offset = '';
  do {
    const data = await airtableFetch(offset ? `?offset=${encodeURIComponent(offset)}` : '');
    if (data.error) throw new Error(JSON.stringify(data.error));
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  console.log(`${records.length} regions found\n`);

  const toUpdate = [];
  const unknown  = [];

  for (const r of records) {
    const name      = r.fields['Region'] || '';
    const continent = REGION_CONTINENT[name];
    if (!continent) {
      unknown.push(name);
      console.log(`  ? unmapped: "${name}"`);
      continue;
    }
    console.log(`  ✓ ${name} → ${continent}`);
    toUpdate.push({ id: r.id, fields: { Continent: continent } });
  }

  console.log(`\n${toUpdate.length} to update, ${unknown.length} unmapped`);
  if (DRY_RUN) { console.log('Dry run — no changes written.'); return; }

  for (let i = 0; i < toUpdate.length; i += 10) {
    const batch = toUpdate.slice(i, i + 10);
    const data  = await airtableFetch('', {
      method: 'PATCH',
      body:   JSON.stringify({ records: batch }),
    });
    if (data.error) throw new Error(JSON.stringify(data.error));
    process.stdout.write('.');
  }
  console.log(`\nDone.`);

  if (unknown.length) {
    console.log(`\n── Unmapped regions (add to script) ──`);
    unknown.forEach(n => console.log(`  "${n}"`));
  }
})().catch(err => { console.error(err); process.exit(1); });
