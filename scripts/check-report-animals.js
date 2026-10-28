// Checks the species names in a trip report's "Animals A".."Animals K" fields against
// the TBT Wildlife table, and suggests close matches for anything that does not resolve.
// Read-only — it never writes.
//
//   node scripts/check-report-animals.js                    # every report
//   node scripts/check-report-animals.js "Uganda"           # one report
//
// Names must match a Species Name or Scientific Name exactly (case-insensitive). There is
// deliberately no fuzzy matching on the site: "Lion" partially matches five different sea
// lions, and showing the wrong animal is worse than showing a plain name with no photo.

(function loadEnv() {
  const fs = require('fs'), path = require('path');
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
})();

const BASE_ID = 'appdlxcWb45dIqNK2';
const LETTERS = 'ABCDEFGHIJK'.split('');
const KEY = process.env.AIRTABLE_API_KEY;
if (!KEY) { console.error('AIRTABLE_API_KEY missing from .env.local'); process.exit(1); }

const only = process.argv.slice(2).find(a => !a.startsWith('--'));
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const get = url => fetch(url, { headers: { Authorization: 'Bearer ' + KEY } }).then(r => r.json());

async function allSpecies() {
  const out = [];
  let offset = '';
  do {
    const p = new URLSearchParams({ pageSize: '100' });
    ['Species Name', 'Scientific Name'].forEach(f => p.append('fields[]', f));
    if (offset) p.set('offset', offset);
    const j = await get(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('TBT Wildlife')}?${p}`);
    (j.records || []).forEach(r => out.push({
      name: r.fields['Species Name'] || '',
      sci: r.fields['Scientific Name'] || '',
    }));
    offset = j.offset || '';
  } while (offset);
  return out;
}

// Candidates that share a significant word with what was typed — good enough to point a
// human at the right row without ever guessing on their behalf.
function suggest(input, species) {
  const words = norm(input).split(' ').filter(w => w.length > 3);
  if (!words.length) return [];
  return species
    .filter(s => { const n = norm(s.name); return words.some(w => n.includes(w)); })
    .slice(0, 6)
    .map(s => s.name);
}

(async () => {
  const species = await allSpecies();
  const known = new Set();
  species.forEach(s => { if (s.name) known.add(norm(s.name)); if (s.sci) known.add(norm(s.sci)); });
  console.log(`${species.length} species in TBT Wildlife\n`);

  let q = '';
  if (only) q = '?filterByFormula=' + encodeURIComponent(`LOWER({Destination})=LOWER("${only.replace(/"/g, '\\"')}")`);
  const recs = (await get(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Trip Reports')}${q}`)).records || [];
  if (!recs.length) { console.error(only ? `No report matching "${only}".` : 'No reports found.'); process.exit(1); }

  let totalNames = 0, totalBad = 0, reportsWithAnimals = 0;

  for (const rec of recs) {
    const f = rec.fields;
    const problems = [];
    let count = 0;

    for (const L of LETTERS) {
      const names = String(f[`Animals ${L}`] || '').split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
      count += names.length;
      names.forEach(n => { if (!known.has(norm(n))) problems.push({ L, n }); });
    }
    if (!count) continue;

    reportsWithAnimals++;
    totalNames += count;
    totalBad += problems.length;

    console.log(`${f['Destination']} — ${count} name${count === 1 ? '' : 's'}, ${problems.length} unmatched`);
    problems.forEach(({ L, n }) => {
      const s = suggest(n, species);
      console.log(`   ${L}: "${n}"`);
      if (s.length) console.log(`        did you mean: ${s.join(' · ')}`);
      else          console.log(`        no similar species in the table`);
    });
    console.log('');
  }

  if (!reportsWithAnimals) { console.log('No reports have any Animals fields filled in yet.'); return; }
  console.log(`${totalNames} names across ${reportsWithAnimals} report${reportsWithAnimals === 1 ? '' : 's'} — ${totalBad} need attention.`);
  if (totalBad) console.log('Unmatched names still display on the page, just without a photo or realm.');
})().catch(e => { console.error(e); process.exit(1); });
