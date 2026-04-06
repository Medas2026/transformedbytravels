const https = require('https');

function claudeActivities(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          resolve((parsed.content && parsed.content[0] && parsed.content[0].text) || '[]');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function salvageJson(text) {
  const start = text.indexOf('[');
  if (start === -1) return [];
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const chunk = end !== -1 ? text.slice(start, end + 1) : text.slice(start);
  // Try trimming to last complete object
  try { return JSON.parse(chunk); } catch(_) {}
  const lastBrace = chunk.lastIndexOf('},');
  if (lastBrace !== -1) {
    try { return JSON.parse(chunk.slice(0, lastBrace + 1) + ']'); } catch(_) {}
  }
  return [];
}

function buildPrompt(type, place, country) {
  const loc = country ? `${place}, ${country}` : place;

  if (type === 'diving') {
    return `You are a scuba diving expert. List the top 5-7 dive sites near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Site Name",
    "depth": "5-25m",
    "difficulty": "Beginner",
    "type": "Reef / Wall / Wreck / Muck",
    "highlights": "One sentence about what makes this site special."
  }
]

Difficulty must be one of: Beginner, Intermediate, Advanced, All levels.
If ${loc} has no notable diving, return an empty array [].`;
  }

  if (type === 'fishing') {
    return `You are a fishing guide expert. List the top 5-7 fishing spots or experiences near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Spot or Experience Name",
    "type": "Fly Fishing / Deep Sea / Shore / Lake / River",
    "species": "Main fish species targeted",
    "highlights": "One sentence about what makes this spot or experience special."
  }
]

If ${loc} has no notable fishing, return an empty array [].`;
  }

  // Generic fallback for future types
  return `You are a local activities expert. List the top 5-7 ${type} spots or experiences near ${loc}.

Return ONLY a JSON array with objects containing: name, type, highlights.
If none exist, return [].`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { place, country, type } = req.body || {};
    if (!place) return res.status(400).json({ error: 'place is required' });
    if (!type)  return res.status(400).json({ error: 'type is required' });

    const prompt = buildPrompt(type, place, country || '');
    const text   = await claudeActivities(prompt);

    let items;
    try {
      items = JSON.parse(text);
    } catch(_) {
      items = salvageJson(text);
    }

    return res.status(200).json({ items: Array.isArray(items) ? items : [] });
  } catch(e) {
    console.error('activities error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
