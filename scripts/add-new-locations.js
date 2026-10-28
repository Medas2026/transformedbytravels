// Add new Wildlife Locations for Fiji, Mexico, and Japan
// Run: node scripts/add-new-locations.js [--dry-run]

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Wildlife Locations';
const DRY_RUN = process.argv.includes('--dry-run');

const fs   = require('fs');
const path = require('path');
const KEY  = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY'); process.exit(1); }

const NEW_LOCATIONS = [
  // ── Fiji ─────────────────────────────────────────────────────────────────
  { name: 'Beqa Lagoon',           region: 'Fiji', continent: 'Oceania', country: 'Fiji',        lat: -18.37, lng: 178.07 },
  { name: 'Rainbow Reef',          region: 'Fiji', continent: 'Oceania', country: 'Fiji',        lat: -16.82, lng: -179.98 },
  { name: 'Taveuni',               region: 'Fiji', continent: 'Oceania', country: 'Fiji',        lat: -16.85, lng: -179.97 },
  { name: 'Bligh Water',           region: 'Fiji', continent: 'Oceania', country: 'Fiji',        lat: -17.00, lng: 178.00 },
  { name: 'Yasawa Islands',        region: 'Fiji', continent: 'Oceania', country: 'Fiji',        lat: -17.00, lng: 177.45 },
  { name: 'Namena Marine Reserve', region: 'Fiji', continent: 'Oceania', country: 'Fiji',        lat: -17.10, lng: 179.07 },

  // ── Mexico ───────────────────────────────────────────────────────────────
  { name: 'Baja California',                    region: 'Mexico', continent: 'North America', country: 'Mexico', lat: 27.00, lng: -113.00 },
  { name: 'Sea of Cortez',                      region: 'Mexico', continent: 'North America', country: 'Mexico', lat: 28.00, lng: -111.00 },
  { name: 'Sian Ka\'an Biosphere Reserve',      region: 'Mexico', continent: 'North America', country: 'Mexico', lat: 19.55, lng: -87.55 },
  { name: 'Calakmul Biosphere Reserve',         region: 'Mexico', continent: 'North America', country: 'Mexico', lat: 18.50, lng: -89.80 },
  { name: 'El Rosario Monarch Butterfly',       region: 'Mexico', continent: 'North America', country: 'Mexico', lat: 19.70, lng: -100.28 },
  { name: 'Copper Canyon',                      region: 'Mexico', continent: 'North America', country: 'Mexico', lat: 27.30, lng: -107.70 },
  { name: 'Isla Contoy',                        region: 'Mexico', continent: 'North America', country: 'Mexico', lat: 21.48, lng: -86.79 },
  { name: 'Chamela-Cuixmala Biosphere',         region: 'Mexico', continent: 'North America', country: 'Mexico', lat: 19.50, lng: -105.05 },

  // ── Japan ────────────────────────────────────────────────────────────────
  { name: 'Shiretoko Peninsula',      region: 'Japan', continent: 'Asia', country: 'Japan', lat: 44.10, lng: 145.10 },
  { name: 'Jigokudani Snow Monkey Park', region: 'Japan', continent: 'Asia', country: 'Japan', lat: 36.73, lng: 138.47 },
  { name: 'Yakushima Island',         region: 'Japan', continent: 'Asia', country: 'Japan', lat: 30.38, lng: 130.55 },
  { name: 'Ogasawara Islands',        region: 'Japan', continent: 'Asia', country: 'Japan', lat: 27.09, lng: 142.19 },
  { name: 'Kushiro Wetlands',         region: 'Japan', continent: 'Asia', country: 'Japan', lat: 43.10, lng: 144.40 },
  { name: 'Iriomote Island',          region: 'Japan', continent: 'Asia', country: 'Japan', lat: 24.38, lng: 123.80 },
];

async function airtableFetch(path, opts = {}) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' }
  });
  return resp.json();
}

async function fetchExisting() {
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

(async () => {
  console.log('Fetching existing locations…');
  const existing = await fetchExisting();
  const existingNames = new Set(existing.map(r => (r.fields['Location Name'] || '').toLowerCase().trim()));
  console.log(`${existing.length} existing locations\n`);

  const toAdd = NEW_LOCATIONS.filter(l => {
    if (existingNames.has(l.name.toLowerCase().trim())) {
      console.log(`  ↷ skip (exists): ${l.name}`);
      return false;
    }
    return true;
  });

  console.log(`\n${toAdd.length} new locations to add:`);
  toAdd.forEach(l => console.log(`  ${l.name} (${l.region}, ${l.country}) — ${l.lat}, ${l.lng}`));

  if (DRY_RUN) { console.log('\nDry run — no changes written.'); return; }

  for (let i = 0; i < toAdd.length; i += 10) {
    const batch = toAdd.slice(i, i + 10).map(l => ({
      fields: {
        'Location Name': l.name,
        'Region':        l.region,
        'Continent':     l.continent,
        'Country':       l.country,
        'Lattitude':     l.lat,
        'Longitude':     l.lng,
      }
    }));
    const data = await airtableFetch('', {
      method: 'POST',
      body:   JSON.stringify({ records: batch })
    });
    if (data.error) throw new Error(JSON.stringify(data.error));
    process.stdout.write('.');
  }
  console.log(`\nDone — added ${toAdd.length} locations.`);
  console.log('\nNext: run enrich-locations.js to add descriptions and realm ratings.');
  console.log(`Total locations will be: ~${existing.length + toAdd.length}`);
})().catch(err => { console.error(err); process.exit(1); });
