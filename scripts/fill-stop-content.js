// Fill blank "Why Stop Here" and "Insider Tip" fields on Itinerary Stops via Claude.
// Usage: ANTHROPIC_API_KEY=xxx AIRTABLE_API_KEY=xxx node scripts/fill-stop-content.js
//
// What it does:
//   1. Fetches all Itinerary Stops records
//   2. For each stop where BOTH Why Stop Here AND Insider Tip are blank,
//      asks Claude to generate content based on Stop Name + Country + Region
//   3. Writes both fields back to Airtable
//   4. Skips stops where either field already has content (safe re-run)
//
// Does NOT touch: Description, Suggested Time Here, or any other field.
// You still fill Suggested Time Here manually since it's a controlled dropdown.

const https = require('https');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_KEY  = process.env.AIRTABLE_API_KEY;
const BASE_ID       = 'appdlxcWb45dIqNK2';
const TABLE_NAME    = 'Places';

if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
if (!AIRTABLE_KEY)  { console.error('AIRTABLE_API_KEY not set');  process.exit(1); }

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

async function fetchAllStops() {
  const encoded = encodeURIComponent(TABLE_NAME);
  const all = [];
  let offset = '';
  do {
    const qs = new URLSearchParams();
    if (offset) qs.set('offset', offset);
    qs.set('pageSize', '100');
    const data = await airtableRequest('GET', `/v0/${BASE_ID}/${encoded}?${qs.toString()}`, null);
    if (data.error) throw new Error(JSON.stringify(data.error));
    all.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return all;
}

function updateStop(id, fields) {
  const encoded = encodeURIComponent(TABLE_NAME);
  return airtableRequest('PATCH', `/v0/${BASE_ID}/${encoded}/${id}`, { fields });
}

// ── Claude helper ─────────────────────────────────────────────────────────────

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 800,
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
    const req = https.request(options, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          if (parsed.error) {
            reject(new Error(`Claude API error: ${JSON.stringify(parsed.error)}`));
            return;
          }
          const text = (parsed.content && parsed.content[0] && parsed.content[0].text) || '';
          if (!text) {
            reject(new Error(`Claude returned no text. Status: ${r.statusCode}. Body: ${d.slice(0, 500)}`));
            return;
          }
          resolve(text);
        } catch(e) {
          reject(new Error(`Parse fail. Status: ${r.statusCode}. Body: ${d.slice(0, 500)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildPrompt(stopName, country, region, existingDescription) {
  return `You are a travel writer for Three Realms Travel, a wildlife-focused travel company. Write content for a stop on a sample itinerary.

Stop: ${stopName}
${country ? `Country: ${country}` : ''}
${region ? `Region: ${region}` : ''}
${existingDescription ? `\nExisting description (for context, do not repeat verbatim):\n${existingDescription}` : ''}

Write TWO short pieces of content, tailored specifically to ${stopName}:

1. WHY STOP HERE — 2 to 3 sentences, ~50-70 words. What makes this stop special or worth the detour. Vivid, specific, aspirational. Focus on what a traveler will experience, not a generic overview. Do not start with the stop name.

2. INSIDER TIP — 1 to 2 sentences, ~30-50 words. A practical, specific piece of local knowledge: best timing, what to skip, a small thing most visitors miss, or a booking/logistics tip. Should feel like advice from someone who has actually been there.

Format your response EXACTLY as:

===WHY===
[Why Stop Here content, plain text, no headings, no bold, no asterisks]
===TIP===
[Insider Tip content, plain text, no headings, no bold, no asterisks]

Do not include any other text before or after. Do not use markdown formatting inside the content — no **, no *, no headings.`;
}

function parseResponse(text) {
  if (!text) return { why: '', tip: '' };

  // Try strict template first
  let why = (text.match(/===\s*WHY\s*===\s*([\s\S]*?)\s*===\s*TIP\s*===/i) || [])[1] || '';
  let tip = (text.match(/===\s*TIP\s*===\s*([\s\S]*?)$/i) || [])[1] || '';

  // Fallback: Claude may use ## Why / ## Tip or **Why:** / **Tip:** style
  if (!why) {
    const m = text.match(/(?:^|\n)\s*(?:#+\s*|\*+\s*)?WHY[\s:_-]*(?:STOP\s*HERE)?\s*(?:\*+)?\s*[:\n]([\s\S]*?)(?=(?:^|\n)\s*(?:#+\s*|\*+\s*)?(?:INSIDER\s*)?TIP)/i);
    if (m) why = m[1];
  }
  if (!tip) {
    const m = text.match(/(?:^|\n)\s*(?:#+\s*|\*+\s*)?(?:INSIDER\s*)?TIP\s*(?:\*+)?\s*[:\n]([\s\S]*)$/i);
    if (m) tip = m[1];
  }

  // Strip stray markdown and section labels from the content
  const clean = s => String(s || '')
    .replace(/^[\s`'"*_#>-]+/gm, m => m.replace(/[*_#>`]/g, ''))
    .replace(/\*\*/g, '')
    .replace(/^===.*===\s*$/gm, '')
    .trim();

  return { why: clean(why), tip: clean(tip) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching Itinerary Stops from Airtable…');
  const records = await fetchAllStops();
  console.log(`  Found ${records.length} total stops`);

  const needsContent = records.filter(r => {
    const f    = r.fields || {};
    const why  = (f['Why Stop Here'] || '').trim();
    const tip  = (f['Insider Tip']   || '').trim();
    const name = (f['Stop Name']     || '').trim();
    return name && !why && !tip;
  });
  console.log(`  ${needsContent.length} stops need content (both fields blank)`);

  let filled = 0, failed = 0;

  for (const r of needsContent) {
    const f       = r.fields;
    const name    = f['Stop Name']   || '';
    const country = f['Country']     || '';
    const region  = f['Region']      || '';
    const desc    = f['Description'] || '';

    process.stdout.write(`  ${name} (${country || 'no country'})… `);

    try {
      const prompt = buildPrompt(name, country, region, desc);
      const raw    = await callClaude(prompt);
      const { why, tip } = parseResponse(raw);

      if (!why || !tip) {
        console.log('parse failed — raw response preview:');
        console.log('    >>> ' + raw.replace(/\n/g, '\n    >>> ').slice(0, 800));
        failed++;
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const upd = await updateStop(r.id, {
        'Why Stop Here': why,
        'Insider Tip':   tip,
      });

      if (upd.error) {
        console.log(`Airtable ERROR: ${JSON.stringify(upd.error).slice(0,120)}`);
        failed++;
      } else {
        console.log(`✓ (${why.length} + ${tip.length} chars)`);
        filled++;
      }
    } catch(e) {
      console.log(`ERROR: ${e.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 500)); // brief pause between stops
  }

  console.log('\nDone.');
  console.log(`  Filled:  ${filled}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skipped: ${records.length - needsContent.length} (already had content or no name)`);
}

main().catch(err => { console.error(err); process.exit(1); });
