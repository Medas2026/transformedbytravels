// Prepare the list of UNESCO sites not already in destinations.js
// Run with: node scripts/prepare-unesco.js
// Reads:  /tmp/unesco.xml  (download from https://whc.unesco.org/en/list/xml/)
// Writes: /tmp/unesco_new.json  (sites to add, consumed by rescore-destinations.js)
//         /tmp/unesco_match_report.txt  (human-readable match report)

const fs          = require('fs');
const path        = require('path');
const { execSync } = require('child_process');

// ── Continent resolution ───────────────────────────────────────────────────

const NORTH_AMERICA   = new Set(['United States of America','United States','Canada','Mexico','Greenland']);
const CENTRAL_AMERICA = new Set(['Guatemala','Belize','Honduras','El Salvador','Nicaragua','Costa Rica','Panama']);
const CARIBBEAN       = new Set(['Cuba','Haiti','Dominican Republic','Jamaica','Trinidad and Tobago','Barbados',
  'Saint Lucia','Antigua and Barbuda','Saint Kitts and Nevis','Grenada',
  'Saint Vincent and the Grenadines','Bahamas','Puerto Rico','Cayman Islands',
  'Turks and Caicos Islands','Montserrat','Dominica']);
const OCEANIA         = new Set(['Australia','New Zealand','Papua New Guinea','Fiji','Solomon Islands',
  'Vanuatu','Samoa','Tonga','Kiribati','Micronesia','Palau','Marshall Islands',
  'Nauru','Tuvalu','Cook Islands','Niue','New Caledonia','French Polynesia','Guam']);

function resolveContinent(country, regions) {
  if (NORTH_AMERICA.has(country))   return 'North America';
  if (CENTRAL_AMERICA.has(country)) return 'Central America';
  if (CARIBBEAN.has(country))       return 'Caribbean';
  if (OCEANIA.has(country))         return 'Oceania';

  const regionList = (regions || '').split(',').map(s => s.trim());
  for (const r of regionList) {
    if (r === 'Africa')       return 'Africa';
    if (r === 'Arab States')  return 'Asia';
    if (r === 'Asia and the Pacific') return 'Asia';
    if (r === 'Latin America and the Caribbean') return 'South America';
    if (r === 'Europe and North America') return 'Europe';
  }
  return 'Other';
}

// ── Parse UNESCO XML via Python ────────────────────────────────────────────

console.log('Parsing UNESCO XML...');

const pyPath = '/tmp/parse_unesco.py';
fs.writeFileSync(pyPath, `
import xml.etree.ElementTree as ET, json

tree = ET.parse('/tmp/unesco.xml')
rows = tree.getroot().findall('row')

def get(row, tag):
    el = row.find(tag)
    return el.text.strip() if el is not None and el.text else ''

def centroid(row):
    geo = row.find('geolocations')
    if geo is None: return None, None
    pois = geo.findall('poi')
    lats = [float(p.find('latitude').text) for p in pois if p.find('latitude') is not None and p.find('latitude').text]
    lngs = [float(p.find('longitude').text) for p in pois if p.find('longitude') is not None and p.find('longitude').text]
    if not lats: return None, None
    return round(sum(lats)/len(lats), 4), round(sum(lngs)/len(lngs), 4)

sites = []
for row in rows:
    lat, lng = centroid(row)
    states = get(row, 'states')
    countries = [s.strip() for s in states.split(',')]
    sites.append({
        'site': get(row, 'site'),
        'country': countries[0],
        'all_countries': countries,
        'iso': get(row, 'iso_code'),
        'category': get(row, 'category'),
        'regions': get(row, 'regions'),
        'lat': lat,
        'lng': lng,
        'transnational': get(row, 'transnational') == '1'
    })
print(json.dumps(sites))
`);

const rawJson = execSync('python3 /tmp/parse_unesco.py', { maxBuffer: 10 * 1024 * 1024 }).toString();
const unescoSites = JSON.parse(rawJson);
console.log(`  Parsed ${unescoSites.length} UNESCO sites`);

// ── Load existing destinations ─────────────────────────────────────────────

const destSrc   = fs.readFileSync(path.join(__dirname, '../js/destinations.js'), 'utf8');
const destMatch = destSrc.match(/const DESTINATIONS\s*=\s*(\[[\s\S]*\]);/);
const DESTINATIONS = eval(destMatch[1]); // safe — local file we control

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '').trim();
}

function normalize(s) {
  return stripHtml(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Build lookup: existing destinations by normalized name, keyed also by country
const existingByName    = new Map(); // normName → { name, country }
const existingByCountry = new Map(); // country → Set of normNames

DESTINATIONS.forEach(d => {
  const norm = normalize(d[0]);
  existingByName.set(norm, { name: d[0], country: d[1] });
  if (!existingByCountry.has(d[1])) existingByCountry.set(d[1], new Set());
  existingByCountry.get(d[1]).add(norm);
});
console.log(`  Existing destinations: ${DESTINATIONS.length}`);

// ── Match UNESCO sites against existing ────────────────────────────────────

const matched   = [];
const unmatched = [];

for (const s of unescoSites) {
  s.site = stripHtml(s.site); // clean HTML from names
  const norm    = normalize(s.site);
  const country = s.country;

  // 1. Exact normalized match
  if (existingByName.has(norm)) {
    matched.push({ unesco: s, existing: existingByName.get(norm).name, matchType: 'exact' });
    continue;
  }

  // 2. Partial match — existing name must be at least 8 chars AND match same country
  let found = false;
  const sameCountryNorms = existingByCountry.get(country) || new Set();

  for (const exNorm of sameCountryNorms) {
    if (exNorm.length < 8) continue;
    // Existing name is contained in UNESCO name (e.g. "pantanal" in "pantanal conservation area")
    if (norm.includes(exNorm) || exNorm.includes(norm)) {
      matched.push({ unesco: s, existing: existingByName.get(exNorm).name, matchType: 'partial-same-country' });
      found = true;
      break;
    }
  }
  if (!found) unmatched.push(s);
}

console.log(`  Matched (already in DB): ${matched.length}`);
console.log(`  To add: ${unmatched.length}`);

// ── Resolve continents ─────────────────────────────────────────────────────

const newSites = unmatched.map(s => ({
  site:          s.site,
  country:       s.country,
  continent:     resolveContinent(s.country, s.regions),
  category:      s.category,
  lat:           s.lat,
  lng:           s.lng,
  transnational: s.transnational,
}));

const others = newSites.filter(s => s.continent === 'Other');
if (others.length) {
  console.log(`\nWARNING: ${others.length} sites with unresolved continent:`);
  others.forEach(s => console.log(`  "${s.site}" | ${s.country}`));
}

// ── Write outputs ──────────────────────────────────────────────────────────

fs.writeFileSync('/tmp/unesco_new.json', JSON.stringify(newSites, null, 2));
console.log(`\nWrote ${newSites.length} new sites to /tmp/unesco_new.json`);

const report = [
  `UNESCO Match Report — ${new Date().toISOString()}`,
  `Total UNESCO sites: ${unescoSites.length}`,
  `Already in DB: ${matched.length}`,
  `To be added: ${unmatched.length}`,
  '',
  '=== MATCHED (already in DB) ===',
  ...matched.map(m => `[${m.matchType}] "${m.unesco.site}" → "${m.existing}"`),
  '',
  '=== TO ADD (new) ===',
  ...newSites.map(s => `${s.site} | ${s.country} | ${s.continent} | ${s.category} | ${s.lat},${s.lng}`),
].join('\n');

fs.writeFileSync('/tmp/unesco_match_report.txt', report);
console.log('Wrote match report to /tmp/unesco_match_report.txt');
console.log('\nNext: ANTHROPIC_API_KEY=your_key node scripts/rescore-destinations.js submit');
