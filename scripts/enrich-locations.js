// Populate Description + Land/Ocean/Sky realm ratings for Wildlife Locations
// Uses Claude Haiku in batches of 20
//
// Realm ratings: 3=World-class  2=Notable  1=Marginal  0=None
//
// Run: AIRTABLE_API_KEY=xxx ANTHROPIC_API_KEY=xxx node scripts/enrich-locations.js
// Add --dry-run to preview record names without writing

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

async function enrichBatch(places) {
  const list = places.map((p, i) =>
    `${i + 1}. ${p.name} (${p.country})`
  ).join('\n');

  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{
      role:    'user',
      content: `For each wildlife park or nature reserve below, provide:
1. A 2-sentence description focused on the wildlife experience — what animals are here and why it's worth visiting.
2. Realm ratings (0-3) for Land, Ocean, and Sky:
   3 = World-class (primary reason to visit)
   2 = Notable (strong secondary draw)
   1 = Marginal (present but incidental)
   0 = None

Parks:
${list}

Respond with a JSON array only — no explanation, no markdown, no code fences:
[{"index":1,"description":"...","land":0,"ocean":0,"sky":0},...]`
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
  console.log('Fetching Wildlife Locations…');
  const records = await getAllRecords();

  // Only process records missing description or realm ratings
  const toProcess = records.filter(r =>
    !r.fields['Description'] &&
    r.fields['Land']  == null &&
    r.fields['Ocean'] == null &&
    r.fields['Sky']   == null
  );

  console.log(`${records.length} total — ${toProcess.length} need enrichment\n`);

  if (DRY_RUN) {
    toProcess.forEach(r => console.log(' ', r.fields['Location Name']));
    console.log('\nDry run — no changes written.');
    return;
  }

  const toUpdate = [];
  const failed   = [];

  for (let i = 0; i < toProcess.length; i += BATCH) {
    const batch  = toProcess.slice(i, i + BATCH);
    const places = batch.map(r => ({
      id:      r.id,
      name:    (r.fields['Location Name'] || '').trim(),
      country: r.fields['Country'] || ''
    }));

    const nums = `${i+1}–${Math.min(i+BATCH, toProcess.length)} of ${toProcess.length}`;
    console.log(`Batch ${Math.floor(i/BATCH)+1} (${nums}): ${places.map(p=>p.name).join(', ').substring(0,80)}…`);

    try {
      const results = await enrichBatch(places);
      results.forEach(r => {
        const place = places[r.index - 1];
        if (!place) return;
        console.log(`  ✓ ${place.name} — L:${r.land} O:${r.ocean} S:${r.sky}`);
        toUpdate.push({
          id:     place.id,
          fields: {
            Description: r.description,
            Land:        r.land  || 0,
            Ocean:       r.ocean || 0,
            Sky:         r.sky   || 0
          }
        });
      });
    } catch(e) {
      console.error('  Batch error:', e.message);
      batch.forEach(r => failed.push(r.fields['Location Name']));
    }
  }

  console.log(`\nWriting ${toUpdate.length} records to Airtable…`);
  await patchRecords(toUpdate);
  console.log(`Done — updated ${toUpdate.length} records.`);

  if (failed.length) {
    console.log(`\n── Failed (${failed.length}) ──`);
    failed.forEach(n => console.log(' ', n));
  }
})().catch(err => { console.error(err); process.exit(1); });
