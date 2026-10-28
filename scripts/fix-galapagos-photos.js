// Replace broken Photo URLs on Galápagos species records with fresh URLs
// from iNaturalist (scientist-curated, stable, medium-res).
//
// Run: node scripts/fix-galapagos-photos.js [--dry-run]

const fs   = require('fs');
const path = require('path');
const DRY  = process.argv.includes('--dry-run');

const BASE_ID = 'appdlxcWb45dIqNK2';
const T_SPEC  = 'tblYtFaj6UYMUEwFQ';
const KEY = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY'); process.exit(1); }

async function airtable(pth, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}${pth}`, opts);
  return resp.json();
}

async function iNatSearch(searchName) {
  const url = `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(searchName)}&per_page=1`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'ThreeRealmsTravel/1.0' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const t = (data.results || [])[0];
    if (!t || !t.default_photo) return null;
    const p = t.default_photo;
    return {
      url:         p.medium_url || p.url || p.large_url || '',
      attribution: p.attribution || '',
      taxonId:     t.id,
    };
  } catch (e) { return null; }
}

async function main() {
  console.log(`${DRY ? '[DRY RUN] ' : ''}Fetching Galápagos species…`);
  const records = [];
  let offset = '';
  do {
    const p = new URLSearchParams({
      filterByFormula: `FIND("Galapagos Islands",ARRAYJOIN({Animal Regions},","))`,
    });
    if (offset) p.set('offset', offset);
    const data = await airtable(`/${T_SPEC}?${p.toString()}`);
    if (data.error) { console.error(data.error); process.exit(1); }
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  console.log(`Found ${records.length} species\n`);

  const updates = [];
  for (const r of records) {
    const name = r.fields['Species Name'] || '';
    const sci  = r.fields['Scientific Name'] || '';
    // Prefer scientific name for iNat search (more precise). Fall back to common.
    const search = sci || name;

    process.stdout.write(`  ${name.padEnd(32)} …  `);
    const photo = await iNatSearch(search);

    if (!photo || !photo.url) {
      console.log('no photo found');
      continue;
    }
    console.log(`✓ taxon ${photo.taxonId}`);

    const fields = { 'Photo URL': photo.url };
    // Photo Credit / Photo Attribution field if it exists — writing is a no-op
    // if the field doesn't exist and typecast:true is set. Safe to include.
    if (photo.attribution) fields['Photo Credit'] = photo.attribution;

    updates.push({ id: r.id, fields });

    // Be polite to the iNat API (asks for ~1 req/sec)
    await new Promise(res => setTimeout(res, 1100));
  }

  console.log(`\n${updates.length} records to update.`);
  if (!updates.length) return;
  if (DRY) { console.log('[DRY RUN] Skipping PATCH.'); return; }

  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const data = await airtable(`/${T_SPEC}`, 'PATCH', { records: batch, typecast: true });
    if (data.error) { console.error('PATCH batch failed:', data.error); process.exit(1); }
    console.log(`  ✓ PATCHed ${data.records.length}`);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
