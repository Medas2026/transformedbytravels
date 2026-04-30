// Blend a base passion article into 5 archetype versions and write to Airtable
// Usage: ANTHROPIC_API_KEY=xxx AIRTABLE_API_KEY=xxx node scripts/blend-passion-articles.js
//
// What it does:
//   1. Reads the base article from Airtable (Archetype field blank) for each passion
//   2. Calls Claude once per archetype to rewrite it in that archetype's voice
//   3. Writes the result into the matching blank Airtable row

const https = require('https');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_KEY  = process.env.AIRTABLE_API_KEY;
const BASE_ID       = 'appdlxcWb45dIqNK2';
const TABLE_NAME    = 'Passion Content';

if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
if (!AIRTABLE_KEY)  { console.error('AIRTABLE_API_KEY not set');  process.exit(1); }

const ARCHETYPES = [
  {
    name: 'Transformational Traveler',
    description: 'Seeks deep personal growth through travel. Wants experiences that change them. Values depth, meaning, and reflection. Drawn to the profound and the life-altering.'
  },
  {
    name: 'Purpose-Driven Traveler',
    description: 'Travel has intention and meaning. Values reflection, culture, history, wellness. Often drawn to pilgrimage, voluntourism, and purposeful exploration. Thoughtful and deliberate.'
  },
  {
    name: 'Adventure-Oriented Traveler',
    description: 'Physical challenge and adrenaline first. Drawn to pushing limits, outdoor extremes, and testing themselves. Practical, energetic, focused on the doing.'
  },
  {
    name: 'Cultural Explorer',
    description: 'Intellectually curious. Deep interest in history, art, food, and local life. Wants to understand places deeply. Prefers meaning over adrenaline.'
  },
  {
    name: 'Easygoing Traveler',
    description: 'Relaxed, comfort-seeking, social. Enjoys travel without intensity. Wants to enjoy experiences without pressure or complexity. Warm, unhurried tone.'
  },
];

// ── Airtable helpers ──────────────────────────────────────────────────────────

function airtableRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${AIRTABLE_KEY}`,
        'Content-Type':  'application/json',
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Airtable parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getRecords() {
  const encoded = encodeURIComponent(TABLE_NAME);
  const url = `/v0/${BASE_ID}/${encoded}?maxRecords=100`;
  console.log('  Fetching:', url);
  const result = await airtableRequest('GET', url, null);
  if (result.error) console.log('  Airtable error:', JSON.stringify(result.error));
  return result;
}

function updateRecord(id, fields) {
  const encoded = encodeURIComponent(TABLE_NAME);
  return airtableRequest('PATCH', `/v0/${BASE_ID}/${encoded}/${id}`, { fields });
}

// ── Claude helper ─────────────────────────────────────────────────────────────

function claudeRewrite(baseArticle, passion, archetype) {
  return new Promise((resolve, reject) => {
    const prompt = `You are a travel content writer for a transformational travel app.

A traveler's archetype is: ${archetype.name}
${archetype.description}

Below is a base article about ${passion}. Rewrite it in a voice and emphasis that speaks directly to this type of traveler. Keep the same facts, personal anecdotes, and core advice — but adjust the tone, emphasis, and framing so it resonates with their travel personality.

For example:
- A Transformational Traveler version should emphasize how photography changes the way you see and experience the world.
- An Adventure-Oriented Traveler version should emphasize capturing action, wildlife, and extreme conditions.
- A Cultural Explorer version should emphasize documenting art, architecture, people, and local life.
- A Purpose-Driven Traveler version should emphasize intentional, mindful photography as a practice.
- An Easygoing Traveler version should emphasize effortless, enjoyable photography with no pressure.

Keep it conversational, warm, and practical. Same approximate length as the original. Do not add a title or heading — just the article body.

BASE ARTICLE:
${baseArticle}`;

    const body = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1200,
      messages:   [{ role: 'user', content: prompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve((parsed.content && parsed.content[0] && parsed.content[0].text) || '');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching Passion Content records from Airtable...');
  const result = await getRecords();
  const records = result.records || [];
  console.log(`  Found ${records.length} records`);

  // Group by passion
  const byPassion = {};
  records.forEach(r => {
    const passion   = (r.fields['Passion'] || '').trim();
    const archetype = (r.fields['Archetype'] || '').trim();
    if (!passion) return;
    if (!byPassion[passion]) byPassion[passion] = { base: null, archetypeRows: {} };
    if (!archetype) {
      byPassion[passion].base = r;
    } else {
      byPassion[passion].archetypeRows[archetype] = r;
    }
  });

  for (const passion of Object.keys(byPassion)) {
    const { base, archetypeRows } = byPassion[passion];
    if (!base) {
      console.log(`\n[${passion}] No base article found — skipping`);
      continue;
    }
    const baseArticle = (base.fields['Intro Article'] || '').trim();
    if (!baseArticle) {
      console.log(`\n[${passion}] Base article is empty — skipping`);
      continue;
    }

    console.log(`\n[${passion}] Base article found (${baseArticle.length} chars)`);

    for (const arch of ARCHETYPES) {
      const row = archetypeRows[arch.name];
      if (!row) {
        console.log(`  ${arch.name}: no row found in Airtable — skipping`);
        continue;
      }

      // const existing = (row.fields['Intro Article'] || '').trim();
      // if (existing) { console.log(`  ${arch.name}: already has content — skipping`); continue; }

      console.log(`  ${arch.name}: generating...`);
      try {
        const blended = await claudeRewrite(baseArticle, passion, arch);
        const updateResult = await updateRecord(row.id, {
          'Archetype':     arch.name,
          'Intro Article': blended,
        });
        if (updateResult.error) {
          console.error(`  ${arch.name}: Airtable write error —`, JSON.stringify(updateResult.error));
        } else {
          console.log(`  ${arch.name}: ✓ written (${blended.length} chars)`);
        }
      } catch(e) {
        console.error(`  ${arch.name}: ERROR —`, e.message);
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
