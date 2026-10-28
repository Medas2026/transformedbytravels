// Moves trip-report photos from the per-slot Photo A1..A4 fields into the consolidated
// "Photos A".."Photos K" long-text fields (one photo per line, "url | optional caption").
//
// Requires the Photos A..Photos K fields to exist first — this script writes values, it
// cannot create fields.
//
// Dry run is the DEFAULT. Nothing is written unless you pass --write.
//
//   node scripts/migrate-report-photos.js                       # preview every report
//   node scripts/migrate-report-photos.js "Canadian Rockies"    # preview one
//   node scripts/migrate-report-photos.js "Canadian Rockies" --write
//   node scripts/migrate-report-photos.js --all --write
//
// The original Photo A1..A4 fields are left untouched, so this is reversible: clear a
// "Photos A" field and the API falls straight back to the old slots.

(function loadEnv() {
  const fs = require('fs'), path = require('path');
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    if (!(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
})();

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE = 'Trip Reports';
const LETTERS = 'ABCDEFGHIJK'.split('');
const KEY = process.env.AIRTABLE_API_KEY;

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ALL = args.includes('--all');
const only = args.find(a => !a.startsWith('--'));

if (!KEY) { console.error('AIRTABLE_API_KEY missing from .env.local'); process.exit(1); }
if (!only && !ALL) {
  console.log('No report named — previewing all. Pass a destination to narrow, or --all to be explicit.\n');
}

const api = (path, opts = {}) => fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`,
  { ...opts, headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

(async () => {
  // Confirm the destination fields exist before promising anything.
  const meta = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`,
    { headers: { Authorization: 'Bearer ' + KEY } }).then(r => r.json());
  const table = (meta.tables || []).find(t => t.name === TABLE);
  const have = new Set((table ? table.fields : []).map(f => f.name));
  const missing = LETTERS.map(L => `Photos ${L}`).filter(n => !have.has(n));
  if (missing.length) {
    console.error(`These fields do not exist yet on "${TABLE}" — create them as Long text first:\n`);
    missing.forEach(n => console.error('   ' + n));
    console.error('\n(The script writes values; it cannot create fields.)');
    process.exit(1);
  }

  let q = '';
  if (only) q = '?filterByFormula=' + encodeURIComponent(`LOWER({Destination})=LOWER("${only.replace(/"/g, '\\"')}")`);
  const recs = (await api(q).then(r => r.json())).records || [];
  if (!recs.length) { console.error(only ? `No report matching "${only}".` : 'No reports found.'); process.exit(1); }

  const updates = [];
  let movedPhotos = 0, movedSections = 0, skipped = 0;

  for (const rec of recs) {
    const f = rec.fields;
    const fields = {};
    const lines = [];

    for (const L of LETTERS) {
      if (f[`Photos ${L}`] && String(f[`Photos ${L}`]).trim()) { skipped++; continue; }  // already converted
      const urls = [1, 2, 3, 4, 5, 6]
        .map(n => String(f[`Photo ${L}${n}`] || '').trim())
        .filter(Boolean);
      if (!urls.length) continue;
      fields[`Photos ${L}`] = urls.join('\n');       // captions get added by hand afterwards
      lines.push(`      ${L}: ${urls.length} photo${urls.length === 1 ? '' : 's'}`);
      movedPhotos += urls.length;
      movedSections++;
    }

    if (!Object.keys(fields).length) continue;
    console.log(`  ${f['Destination'] || rec.id}`);
    lines.forEach(l => console.log(l));
    updates.push({ id: rec.id, fields });
  }

  console.log(`\n${movedSections} sections, ${movedPhotos} photos` + (skipped ? `  (${skipped} sections already converted, left alone)` : ''));

  if (!updates.length) { console.log('Nothing to do.'); return; }
  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write to apply.');
    return;
  }

  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const resp = await api('', { method: 'PATCH', body: JSON.stringify({ records: batch }) });
    const j = await resp.json();
    if (j.error) { console.error('FAILED:', JSON.stringify(j.error)); process.exit(1); }
    console.log(`wrote ${j.records.length} report${j.records.length === 1 ? '' : 's'}`);
  }
  console.log('\nDone. The old Photo A1..A4 fields are untouched — clear a "Photos X" field to fall back.');
})().catch(e => { console.error(e); process.exit(1); });
