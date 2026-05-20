// Extract wildlife locations from destinations.js for import into Airtable
// Outputs CSV with: Location Name, Region, Continent, Park Type
//
// Run: node scripts/extract-wildlife-locations.js > scripts/wildlife-locations.csv

const fs   = require('fs');
const path = require('path');

// ── Load destinations ────────────────────────────────────────────────────────
const raw   = fs.readFileSync(path.join(__dirname, '../js/destinations.js'), 'utf8');
const match = raw.match(/const DESTINATIONS\s*=\s*(\[[\s\S]*?\]);/);
if (!match) { console.error('Could not parse destinations.js'); process.exit(1); }
const DESTINATIONS = eval(match[1]);

// ── Wildlife passion filter ──────────────────────────────────────────────────
const WILDLIFE_PASSIONS = new Set([
  'Wildlife & Safari',
  'Birding',
  'National Parks',
  'Game Drive',
  'Scuba Diving',
  'Snorkeling',
]);

function isWildlife(dest) {
  const passions = dest[6] || [];
  return passions.some(p => WILDLIFE_PASSIONS.has(p));
}

// ── Park type inference ───────────────────────────────────────────────────────
function inferParkType(name) {
  const n = name.toLowerCase();
  if (n.includes('marine') || n.includes('reef') || n.includes('atoll'))
    return 'Marine Reserve';
  if (n.includes('national park') || n.includes('np ') || n.endsWith(' np'))
    return 'National Park';
  if (n.includes('nature reserve') || n.includes('game reserve') || n.includes('wildlife reserve'))
    return 'Wildlife Reserve';
  if (n.includes('national reserve'))
    return 'National Reserve';
  if (n.includes('conservation area') || n.includes('conservancy'))
    return 'Conservancy';
  if (n.includes('forest reserve') || n.includes('forest'))
    return 'Forest Reserve';
  if (n.includes('sanctuary'))
    return 'Sanctuary';
  if (n.includes('biosphere'))
    return 'Biosphere Reserve';
  if (n.includes('wetland') || n.includes('delta') || n.includes('lake') || n.includes('lagoon'))
    return 'Wetland / Water';
  if (n.includes('peninsula') || n.includes('island') || n.includes('archipelago') || n.includes('bay'))
    return 'Coastal / Island';
  if (n.includes('mountain') || n.includes('valley') || n.includes('canyon') || n.includes('desert'))
    return 'Natural Area';
  if (n.includes('ranch') || n.includes('lodge') || n.includes('camp'))
    return 'Private Reserve';
  return 'Wildlife Area';
}

// ── Filter and deduplicate ────────────────────────────────────────────────────
const seen = new Set();
const results = [];

DESTINATIONS.forEach(dest => {
  const [name, country, continent, airport, arch1, arch2, passions, , , , , , lat, lng, , animalRegion] = dest;

  if (!isWildlife(dest)) return;
  if (!animalRegion) return; // skip destinations without a region assigned

  const key = name.toLowerCase().trim();
  if (seen.has(key)) return;
  seen.add(key);

  results.push({
    name,
    region:    animalRegion,
    continent,
    parkType:  inferParkType(name),
  });
});

// Sort by continent, region, name
results.sort((a, b) =>
  a.continent.localeCompare(b.continent) ||
  a.region.localeCompare(b.region) ||
  a.name.localeCompare(b.name)
);

// ── Output CSV ────────────────────────────────────────────────────────────────
const escape = v => `"${String(v).replace(/"/g, '""')}"`;
console.log('Location Name,Region,Continent,Park Type');
results.forEach(r => {
  console.log([r.name, r.region, r.continent, r.parkType].map(escape).join(','));
});

process.stderr.write(`\nTotal wildlife locations: ${results.length}\n`);

// Region summary
const byRegion = {};
results.forEach(r => { byRegion[r.region] = (byRegion[r.region] || 0) + 1; });
Object.entries(byRegion).sort((a,b) => a[0].localeCompare(b[0])).forEach(([region, count]) => {
  process.stderr.write(`  ${region}: ${count}\n`);
});
