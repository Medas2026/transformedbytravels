// Apply animal region assignments to destinations.js
// Reads scripts/region-proposals.csv, adds animalRegion as index 15
//
// Run: node scripts/apply-animal-regions.js
// Creates destinations.js backup at js/destinations.backup2.js before writing

const fs   = require('fs');
const path = require('path');

const DEST_FILE   = path.join(__dirname, '../js/destinations.js');
const CSV_FILE    = path.join(__dirname, 'region-proposals.csv');
const BACKUP_FILE = path.join(__dirname, '../js/destinations.backup2.js');

// ── Parse CSV ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n').slice(1); // skip header
  const map = new Map();
  for (const line of lines) {
    // Parse quoted CSV fields
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQ)         { inQ = true; }
      else if (ch === '"' && inQ) {
        if (line[i+1] === '"')        { cur += '"'; i++; }
        else                          { inQ = false; }
      } else if (ch === ',' && !inQ)  { fields.push(cur); cur = ''; }
      else                            { cur += ch; }
    }
    fields.push(cur);
    const [name, country, , , , region] = fields;
    if (region && region !== 'REVIEW') {
      // key = name|country for uniqueness
      map.set(`${name}|${country}`, region);
    }
  }
  return map;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const csvText  = fs.readFileSync(CSV_FILE, 'utf8');
const regionMap = parseCSV(csvText);
console.log(`Loaded ${regionMap.size} region assignments from CSV`);

const raw = fs.readFileSync(DEST_FILE, 'utf8');

// Back up original
fs.writeFileSync(BACKUP_FILE, raw);
console.log(`Backed up to js/destinations.backup2.js`);

// Parse the array
const arrMatch = raw.match(/const DESTINATIONS\s*=\s*(\[[\s\S]*?\]);/);
if (!arrMatch) { console.error('Could not parse destinations.js'); process.exit(1); }
const DESTINATIONS = eval(arrMatch[1]);

// Apply regions
let tagged = 0, alreadyHad = 0;
const updated = DESTINATIONS.map(dest => {
  const [name, country] = dest;
  const key    = `${name}|${country}`;
  const region = regionMap.get(key) || null;
  if (dest.length >= 16) {
    alreadyHad++;
    return [...dest.slice(0, 15), region]; // overwrite existing
  }
  if (region) tagged++;
  return [...dest, region];
});

if (alreadyHad > 0) console.log(`Overwrote existing region field on ${alreadyHad} entries`);
console.log(`Tagged ${tagged} destinations with animal regions`);
console.log(`Untagged (null): ${updated.length - tagged - alreadyHad}`);

// Serialize back — one destination per line to match original style
function serializeDest(dest) {
  const parts = dest.map((v, i) => {
    if (i === 6) return JSON.stringify(v);               // passions array
    if (v === null) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
  });
  return `  [${parts.join(',')}]`;
}

const header  = raw.slice(0, raw.indexOf('const DESTINATIONS'));
const newBody = `const DESTINATIONS = [\n${updated.map(serializeDest).join(',\n')}\n];`;
const footer  = raw.slice(raw.indexOf('];') + 2);

fs.writeFileSync(DEST_FILE, header + newBody + footer);
console.log(`Written to js/destinations.js — ${updated.length} destinations total`);
