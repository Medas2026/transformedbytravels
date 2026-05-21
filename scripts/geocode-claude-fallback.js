// Geocode remaining Wildlife Locations missing coords using Claude Haiku
// Batches 20 at a time — fast, precise for well-known parks
//
// Run: AIRTABLE_API_KEY=xxx ANTHROPIC_API_KEY=xxx node scripts/geocode-claude-fallback.js

const BASE_ID  = 'appdlxcWb45dIqNK2';
const TABLE    = 'Wildlife Locations';
const DRY_RUN  = process.argv.includes('--dry-run');
const BATCH    = 20;

const AIRTABLE_KEY  = process.env.AIRTABLE_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!AIRTABLE_KEY)  { console.error('Missing AIRTABLE_API_KEY');  process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }

async function airtableFetch(path, opts = {}) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + AIRTABLE_KEY, 'Content-Type': 'application/json' }
  });
  return resp.json();
}

async function getAllRecords() {
  const records = [];
  let offset = '';
  do {
    const qs   = offset ? `?offset=${encodeURIComponent(offset)}` : '';
    const data = await airtableFetch(qs);
    if (data.error) throw new Error(data.error.message);
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

async function patchRecords(updates) {
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const data  = await airtableFetch('', {
      method: 'PATCH',
      body:   JSON.stringify({ records: batch })
    });
    if (data.error) throw new Error(data.error.message);
    process.stdout.write('.');
  }
  console.log();
}

async function geocodeBatch(places) {
  const list = places.map((p, i) =>
    `${i + 1}. ${p.name}${p.country ? ' (' + p.country + ')' : ''}`
  ).join('\n');

  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{
      role:    'user',
      content: `Return precise latitude and longitude coordinates for the centre or main entrance of each wildlife park, national park, or nature reserve listed below.

${list}

Respond with a JSON array only — no explanation, no markdown, no code fences:
[{"index":1,"lat":0.0,"lng":0.0},...]

Use park-level precision, not country or city level. If you genuinely cannot find a location, use null for lat and lng.`
    }]
  });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json'
    },
    body
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  let text = (data.content && data.content[0] && data.content[0].text) || '[]';
  text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(text);
}

(async () => {
  console.log('Fetching records missing coordinates…');
  const records = await getAllRecords();
  const missing = records.filter(r => r.fields['Lattitude'] == null || r.fields['Longitude'] == null);
  console.log(`Found ${missing.length} records without coordinates\n`);

  if (DRY_RUN) {
    missing.forEach(r => console.log(' ', r.fields['Location Name'] || '(blank)'));
    console.log('\nDry run — no changes written.');
    return;
  }

  const toUpdate = [];
  const failed   = [];

  for (let i = 0; i < missing.length; i += BATCH) {
    const batch  = missing.slice(i, i + BATCH);
    const places = batch.map(r => ({
      id:      r.id,
      name:    (r.fields['Location Name'] || '').trim(),
      country: r.fields['Country'] || ''
    }));

    const nums = `${i+1}-${Math.min(i+BATCH, missing.length)}`;
    console.log(`\nBatch ${Math.floor(i/BATCH)+1}: records ${nums}`);
    places.forEach(p => console.log(`  ${p.name}`));

    try {
      const results = await geocodeBatch(places);
      results.forEach(r => {
        const place = places[r.index - 1];
        if (!place) return;
        if (r.lat != null && r.lng != null) {
          console.log(`  ✓ ${place.name}: ${r.lat}, ${r.lng}`);
          toUpdate.push({ id: place.id, fields: { Lattitude: r.lat, Longitude: r.lng } });
        } else {
          console.log(`  ✗ ${place.name}: not found`);
          failed.push(place.name);
        }
      });
    } catch(e) {
      console.error('  Batch error:', e.message);
      batch.forEach(r => failed.push(r.fields['Location Name']));
    }
  }

  console.log(`\nUpdating ${toUpdate.length} records…`);
  if (toUpdate.length) {
    await patchRecords(toUpdate);
    console.log(`Done — updated ${toUpdate.length} records.`);
  }

  if (failed.length) {
    console.log(`\n── Still needs manual coordinates (${failed.length}) ──`);
    failed.forEach(n => console.log(' ', n));
  }
})().catch(err => { console.error(err); process.exit(1); });
