// Rescore all destinations + add UNESCO sites using Claude Haiku Batch API
// Run with: ANTHROPIC_API_KEY=your_key node scripts/rescore-destinations.js
//
// Phase 1: node scripts/rescore-destinations.js submit
//   → submits batch, prints batch_id, saves batch_id to /tmp/rescore-batch-id.txt
//
// Phase 2 (next day): node scripts/rescore-destinations.js collect <batch_id>
//   → downloads results, writes js/destinations.new.js for review
//
// Phase 3 (after review): cp js/destinations.new.js js/destinations.js

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

// ── Constants ──────────────────────────────────────────────────────────────

const ARCHETYPES = [
  'Transformational Traveler',
  'Purpose-Driven Traveler',
  'Adventure-Oriented Traveler',
  'Cultural Explorer',
  'Easygoing Traveler',
];

const ARCHETYPE_DESCRIPTIONS = `
Transformational Traveler: Seeks deep personal growth through travel. High across all dimensions — Curiosity, Adventure, Connection, Intention, Reflection. Wants experiences that change them. Scores: Cur 6-7, Adv 5-7, Con 5-7, Int 6-7, Ref 6-7.

Purpose-Driven Traveler: Travel has meaning and intention. High Reflection and Travel Purpose (Intention). Moderate Adventure. Often drawn to culture, history, wellness, pilgrimage, voluntourism. Scores: Ref 5-7, Int 5-7, Adv 2-5.

Adventure-Oriented Traveler: Physical challenge and adrenaline first. High Adventure, moderate other dimensions. Drawn to mountains, water sports, trekking, extreme environments. Scores: Adv 6-7, Ref 2-4, Int 2-5.

Cultural Explorer: Intellectually curious. Deep interest in history, art, food, local life. High Curiosity and Connection. Lower Adventure. Scores: Cur 6-7, Con 5-7, Adv 1-5.

Easygoing Traveler: Relaxed, comfort-seeking, social. Enjoys travel without intensity. Moderate across all dimensions, nothing extreme. Scores: all dimensions 3-6, no dominant spike.
`;

const PASSIONS = [
  'Open Spaces','Rainforests & Jungles','Urban Places','Mountains & High Places','Oceans & Coastlines',
  'Day Hiking & Trekking','Mountain Climbing','Cycling & Mountain Biking','SCUBA & Marine Exploration',
  'Sailing & Boating','Canoeing, Kayaking & Whitewater','Skiing & Snow Sports','Rock Climbing',
  'Golf','Tennis','Fishing',
  'Wildlife & Safari','Birding','National Parks',
  'Ancient History & Archaeology','Art & Architecture','Local Traditions & Village Life',
  'Religious & Sacred Sites','Literary & Book Travel','Music & Performing Arts',
  'Culinary Travel & Street Food','Wine & Vineyards','Craft Beer & Distilleries','Coffee Culture',
  'Wellness & Spa','Yoga & Meditation','Gardens & Landscapes','Photography',
  'Voluntourism & Service','Pilgrimage','Cultural Immersion','Pet-Friendly Travel',
];

// ── Load existing destinations ─────────────────────────────────────────────

function loadExistingDestinations() {
  const src = fs.readFileSync(path.join(__dirname, '../js/destinations.js'), 'utf8');
  // Extract the array content
  const match = src.match(/const DESTINATIONS\s*=\s*(\[[\s\S]*\]);/);
  if (!match) throw new Error('Could not parse destinations.js');
  return eval(match[1]); // safe — local file we control
}

// ── Load UNESCO new sites ──────────────────────────────────────────────────

function loadUnescoNewSites() {
  const raw = fs.readFileSync('/tmp/unesco_new.json', 'utf8');
  return JSON.parse(raw);
}

// ── Build prompt for a destination ────────────────────────────────────────

function buildPrompt(name, country, continent, isNew, unescoCategory) {
  const airportLine = isNew
    ? '\n- "airport": the IATA code of the nearest major international airport (3 letters, e.g. "CDG")'
    : '';
  const categoryHint = unescoCategory ? `\nUNESCO category: ${unescoCategory}` : '';

  return `You are scoring travel destinations for a transformational travel app.

Destination: ${name}
Country: ${country}
Continent: ${continent}${categoryHint}

ARCHETYPES (choose Arch1 = primary, Arch2 = secondary, must be different):
${ARCHETYPE_DESCRIPTIONS}

PASSIONS (choose 1-3 that best fit this destination, in order of relevance):
${PASSIONS.join(', ')}

DIMENSION SCORES (integers 1-7):
- Curiosity (Cur): intellectual stimulation, history, culture, novelty
- Adventure (Adv): physical challenge, risk, outdoor activity
- Connection (Con): social richness, local interaction, community
- Intention (Int): purposeful travel, meaning, service, growth
- Reflection (Ref): introspection, solitude, contemplation, spirituality

Return ONLY valid JSON, no explanation:
{
  "Arch1": "<archetype name>",
  "Arch2": "<archetype name>",
  "passions": ["<passion1>", "<passion2>", "<passion3>"],
  "Cur": <1-7>,
  "Adv": <1-7>,
  "Con": <1-7>,
  "Int": <1-7>,
  "Ref": <1-7>${airportLine}
}`;
}

// ── Anthropic API helpers ──────────────────────────────────────────────────

function anthropicRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.anthropic.com',
      path:     apiPath,
      method,
      headers: {
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'message-batches-2024-09-24',
        'Content-Type':      'application/json',
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── SUBMIT phase ───────────────────────────────────────────────────────────

async function submit() {
  console.log('Loading destinations...');
  const existing = loadExistingDestinations();
  console.log(`  Existing: ${existing.length}`);

  let newSites = [];
  if (fs.existsSync('/tmp/unesco_new.json')) {
    newSites = loadUnescoNewSites();
    console.log(`  New UNESCO: ${newSites.length}`);
  } else {
    console.log('  No /tmp/unesco_new.json found — rescoring existing only');
  }

  // Build batch requests
  const requests = [];

  // Existing destinations
  existing.forEach((d, i) => {
    const [name, country, continent] = d;
    requests.push({
      custom_id: `existing-${i}`,
      params: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: buildPrompt(name, country, continent, false, null) }]
      }
    });
  });

  // New UNESCO sites
  newSites.forEach((s, i) => {
    requests.push({
      custom_id: `new-${i}`,
      params: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: buildPrompt(s.site, s.country, s.continent, true, s.category) }]
      }
    });
  });

  console.log(`\nSubmitting batch of ${requests.length} requests...`);

  // Anthropic batch max is 10,000 requests — chunk if needed
  const CHUNK_SIZE = 10000;
  const batchIds = [];

  for (let start = 0; start < requests.length; start += CHUNK_SIZE) {
    const chunk = requests.slice(start, start + CHUNK_SIZE);
    const res = await anthropicRequest('POST', '/v1/messages/batches', { requests: chunk });
    if (res.status !== 200) {
      console.error('Batch submit failed:', JSON.stringify(res.body));
      process.exit(1);
    }
    const batchId = res.body.id;
    batchIds.push(batchId);
    console.log(`  Chunk ${batchIds.length}: batch_id = ${batchId} (${chunk.length} requests)`);
  }

  const meta = { batchIds, existingCount: existing.length, newCount: newSites.length, submittedAt: new Date().toISOString() };
  fs.writeFileSync('/tmp/rescore-batch-meta.json', JSON.stringify(meta, null, 2));
  console.log('\nSaved batch metadata to /tmp/rescore-batch-meta.json');
  console.log('Run tomorrow: node scripts/rescore-destinations.js collect');
}

// ── COLLECT phase ──────────────────────────────────────────────────────────

async function collect() {
  if (!fs.existsSync('/tmp/rescore-batch-meta.json')) {
    console.error('No batch metadata found. Run submit first.');
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync('/tmp/rescore-batch-meta.json', 'utf8'));
  const { batchIds, existingCount, newCount } = meta;

  console.log(`Checking ${batchIds.length} batch(es)...`);

  // Check all batches are complete
  for (const batchId of batchIds) {
    const res = await anthropicRequest('GET', `/v1/messages/batches/${batchId}`, null);
    const status = res.body.processing_status;
    console.log(`  ${batchId}: ${status}`);
    if (status !== 'ended') {
      console.log('Not all batches complete yet. Try again later.');
      process.exit(0);
    }
  }

  // Download all results
  console.log('\nDownloading results...');
  const resultMap = {}; // custom_id → parsed response

  for (const batchId of batchIds) {
    await fetchBatchResults(batchId, resultMap);
  }

  buildOutput(meta, resultMap);
}

async function fetchBatchResults(batchId, resultMap) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path:     `/v1/messages/batches/${batchId}/results`,
      method:   'GET',
      headers: {
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'message-batches-2024-09-24',
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const lines = data.split('\n').filter(l => l.trim());
        let parsed = 0;
        lines.forEach(line => {
          try {
            const result = JSON.parse(line);
            const customId = result.custom_id;
            if (result.result && result.result.type === 'succeeded') {
              const text = result.result.message.content[0].text;
              try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) resultMap[customId] = JSON.parse(jsonMatch[0]);
                parsed++;
              } catch(e) {
                console.warn(`  Parse error for ${customId}:`, text.slice(0, 100));
              }
            } else {
              console.warn(`  Failed: ${customId}`, result.result?.error);
            }
          } catch(e) {}
        });
        console.log(`  Batch ${batchId}: ${parsed}/${lines.length} parsed`);
        resolve();
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function buildOutput(meta, resultMap) {
  const { existingCount, newCount } = meta;
  const existing = loadExistingDestinations();
  const newSites = newCount > 0 && fs.existsSync('/tmp/unesco_new.json')
    ? loadUnescoNewSites() : [];

  const rows = [];
  let updated = 0, failed = 0;

  // Existing destinations
  existing.forEach((d, i) => {
    const r = resultMap[`existing-${i}`];
    if (!r) { failed++; rows.push(d); return; } // keep original on failure

    const passions = Array.isArray(r.passions) ? r.passions.filter(p => PASSIONS.includes(p)).slice(0, 3) : [];
    const arch1 = ARCHETYPES.includes(r.Arch1) ? r.Arch1 : d[4];
    const arch2 = ARCHETYPES.includes(r.Arch2) ? r.Arch2 : d[5];
    const cur = clamp(r.Cur, 1, 7);
    const adv = clamp(r.Adv, 1, 7);
    const con = clamp(r.Con, 1, 7);
    const int_ = clamp(r.Int, 1, 7);
    const ref = clamp(r.Ref, 1, 7);
    const lat = d[12], lng = d[13];
    const unesco = 0; // existing destinations — UNESCO flag set separately

    rows.push([d[0], d[1], d[2], d[3], arch1, arch2, passions, cur, adv, con, int_, ref, lat, lng, unesco]);
    updated++;
  });

  // New UNESCO sites
  newSites.forEach((s, i) => {
    const r = resultMap[`new-${i}`];
    if (!r) { failed++; return; }

    const passions = Array.isArray(r.passions) ? r.passions.filter(p => PASSIONS.includes(p)).slice(0, 3) : [];
    const arch1 = ARCHETYPES.includes(r.Arch1) ? r.Arch1 : 'Cultural Explorer';
    const arch2 = ARCHETYPES.includes(r.Arch2) ? r.Arch2 : 'Easygoing Traveler';
    const cur = clamp(r.Cur, 1, 7);
    const adv = clamp(r.Adv, 1, 7);
    const con = clamp(r.Con, 1, 7);
    const int_ = clamp(r.Int, 1, 7);
    const ref = clamp(r.Ref, 1, 7);
    const airport = r.airport || '';
    const lat = s.lat || 0;
    const lng = s.lng || 0;

    rows.push([s.site, s.country, s.continent, airport, arch1, arch2, passions, cur, adv, con, int_, ref, lat, lng, 1]);
    updated++;
  });

  // Sort: by continent, then country, then name
  rows.sort((a, b) => {
    if (a[2] < b[2]) return -1; if (a[2] > b[2]) return 1;
    if (a[1] < b[1]) return -1; if (a[1] > b[1]) return 1;
    if (a[0] < b[0]) return -1; if (a[0] > b[0]) return 1;
    return 0;
  });

  // Write output
  const header = '// [Destination, Country, Continent, Airport, Arch1, Arch2, [Passion1,Passion2,Passion3], Cur, Adv, Con, Int, Ref, Lat, Lng, UNESCO]\n';
  const body   = 'const DESTINATIONS = [\n' + rows.map(r => '  ' + JSON.stringify(r)).join(',\n') + '\n];\n';
  const outPath = path.join(__dirname, '../js/destinations.new.js');
  fs.writeFileSync(outPath, header + body);

  console.log(`\nDone!`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Failed (kept original): ${failed}`);
  console.log(`  Total rows: ${rows.length}`);
  console.log(`\nReview: js/destinations.new.js`);
  console.log('When satisfied: cp js/destinations.new.js js/destinations.js');
}

function clamp(v, min, max) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return Math.round((min + max) / 2);
  return Math.min(max, Math.max(min, n));
}

// ── Main ───────────────────────────────────────────────────────────────────

const phase = process.argv[2] || 'submit';
if (phase === 'submit') {
  submit().catch(err => { console.error(err); process.exit(1); });
} else if (phase === 'collect') {
  collect().catch(err => { console.error(err); process.exit(1); });
} else {
  console.error('Usage: node scripts/rescore-destinations.js [submit|collect]');
  process.exit(1);
}
