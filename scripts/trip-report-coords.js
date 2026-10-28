// Proposes map coordinates for a trip report's sections by geocoding their subtitles.
// Read-only: prints suggestions to paste into the "Coords A".."Coords K" fields.
// It does NOT write to Airtable — subtitles are headlines, not addresses, so a human
// should eyeball every line before trusting it.
//
//   node scripts/trip-report-coords.js "Canadian Rockies"
//   node scripts/trip-report-coords.js "Canadian Rockies" --hint "Canada"
//
// Uses OpenStreetMap's Nominatim rather than Mapbox: Mapbox's geocoder matches street
// addresses and puts "Jasper National Park" in Ontario, while Nominatim resolves parks,
// lakes, and mountains correctly. Free, no token, 1 request/second by their usage policy.

// Reads .env.local directly — this repo's scripts don't carry a dotenv dependency.
(function loadEnv() {
  const fs = require('fs'), path = require('path');
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE = 'Trip Reports';
const SECTION_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K'];
const UA = 'ThreeRealmsTravel/1.0 (michaele@transformedbytravels.com)';

const args = process.argv.slice(2);
const destination = args.find(a => !a.startsWith('--'));
const hintIdx = args.indexOf('--hint');
const hint = hintIdx > -1 ? (args[hintIdx + 1] || '') : '';

if (!destination) {
  console.error('usage: node scripts/trip-report-coords.js "<Destination>" [--hint "Country"]');
  process.exit(1);
}
if (!process.env.AIRTABLE_API_KEY) { console.error('AIRTABLE_API_KEY missing from .env.local'); process.exit(1); }

// Subtitles are headlines, not addresses, and the place can sit on either side of the
// prose: "Cathedral Mountain Lodge--Paradise on Earth" (place first) vs
// "First stop--Punta Arenas" (place last). So generate several candidate queries and try
// each until one resolves, rather than betting on a single extraction rule.
const LEADERS = [
  /^(?:the\s+)?(?:first|next|last|final)\s+stop\s*(?:was|is)?\s*[—–\-:,]*\s*/i,
  /^\w+\s+days?\s+in\s+/i,                                  // "Four Days in Mana Pools"
  /^(?:a\s+)?(?:quick\s+)?(?:stop|visit|day\s+tour|tour)\s+(?:in|to|of|at)\s+/i,
  /^(?:visiting|diving\s+in|onto|into|exploring|onward\s+to)\s+/i,
  /^the\s+\w+\s+of\s+/i,                                    // "The Beauty of Banff"
  /^the\s+(?:remote|wonerous|wondrous|beautiful|magnificent)\s+/i,
  /^(?:the|a|our|an)\s+/i,
];

function strip(s) {
  let out = String(s || '').replace(/\s+/g, ' ').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of LEADERS) {
      const next = out.replace(re, '');
      if (next !== out) { out = next.trim(); changed = true; }
    }
  }
  return out.replace(/\bNP\b/i, 'National Park').trim();
}

function queryVariants(subtitle) {
  const raw = String(subtitle || '').replace(/\s+/g, ' ').trim();
  const cand = [];
  const push = s => { const v = strip(s); if (v && v.length > 2) cand.push(v); };

  // Both halves of a dash/colon split — the place may be on either side.
  const halves = raw.split(/\s*--\s*|\s*[—–]\s*|\s*:\s*/).map(s => s.trim()).filter(Boolean);
  halves.forEach(push);
  push(raw);

  // Each comma segment ("Lake O'Hara, Yoho National Park" → both).
  halves.concat([raw]).forEach(h => h.split(',').forEach(push));

  // "Into Argentina and El Califate" → try each side of "and".
  cand.slice().forEach(c => c.split(/\s+and\s+/i).forEach(push));

  // Last resort: trailing two- and three-word phrases, where place names usually sit.
  cand.slice().forEach(c => {
    const w = c.split(' ');
    if (w.length > 3) push(w.slice(-3).join(' '));
    if (w.length > 2) push(w.slice(-2).join(' '));
  });

  return [...new Set(cand)].slice(0, 8);
}

async function geocode(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('Nominatim returned ' + r.status);
  const j = await r.json();
  const f = Array.isArray(j) ? j[0] : null;
  if (!f) return null;
  return { lat: Number(f.lat), lng: Number(f.lon), matched: f.display_name };
}

(async () => {
  const params = new URLSearchParams();
  params.set('filterByFormula', `LOWER({Destination}) = LOWER("${destination.replace(/"/g, '\\"')}")`);
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}?${params}`,
    { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  const data = await r.json();
  if (data.error) { console.error('Airtable:', data.error.message || data.error); process.exit(1); }
  const rec = (data.records || [])[0];
  if (!rec) { console.error(`No trip report found for "${destination}".`); process.exit(1); }

  const f = rec.fields || {};
  // A "Map Region" field on the report (e.g. "Canada", "Patagonia, Argentina") steers every
  // lookup without needing --hint on the command line. --hint still wins when given.
  const region = hint || String(f['Map Region'] || f['Country'] || '').trim();

  console.log(`\n${f.Title || destination}\n${'─'.repeat(68)}`);
  if (region) console.log(`Searching within: ${region}`);
  else console.log('No region set — add a "Map Region" field to the report, or pass --hint "Country", for better matches.');
  console.log('Paste each value into the matching Coords field. Verify before trusting.\n');

  let missed = 0;
  for (const L of SECTION_LETTERS) {
    const subtitle = String(f[`Subtitle ${L}`] || '').trim();
    if (!subtitle) continue;

    const existing = String(f[`Coords ${L}`] || '').trim();
    if (existing) {
      console.log(`Coords ${L}  ${existing.padEnd(22)}(already set) — ${subtitle}`);
      continue;
    }

    let hit = null, used = '';
    for (const variant of queryVariants(subtitle)) {
      const query = region ? `${variant}, ${region}` : variant;
      try {
        hit = await geocode(query);
      } catch (e) {
        console.log(`Coords ${L}  lookup failed: ${e.message}`);
        break;
      }
      used = query;
      await new Promise(s => setTimeout(s, 1150));  // Nominatim asks for ≤1 request/second
      if (hit) break;
    }

    if (hit) {
      console.log(`Coords ${L}  ${`${hit.lat.toFixed(4)},${hit.lng.toFixed(4)}`.padEnd(22)}← ${hit.matched.slice(0, 54)}`);
    } else {
      missed++;
      console.log(`Coords ${L}  ⚠ NO MATCH — look this one up by hand`);
    }
    console.log(`            searched "${used}"  (from "${subtitle}")\n`);
  }

  if (missed) console.log(`${missed} stop${missed === 1 ? '' : 's'} need${missed === 1 ? 's' : ''} a manual lookup.`);
  console.log('Tip: right-click any spot in Google Maps to copy exact "lat, lng".\n');
})().catch(e => { console.error(e); process.exit(1); });
