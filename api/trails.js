const https = require('https');

function claudeRequest(prompt) {
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
          let text = (parsed.content && parsed.content[0] && parsed.content[0].text) || '[]';
          text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { place, country } = req.body || {};
  if (!place) return res.status(400).json({ error: 'place required' });

  const destination = country ? `${place}, ${country}` : place;

  const prompt = `You are a hiking and outdoor recreation expert. List up to 15 real, well-known hiking trails near ${destination}.

Respond with a JSON array only — no explanation, no markdown, no code fences. Each item:
{"name":"Trail Name","difficulty":"Easy|Moderate|Difficult|Strenuous","distance":"X.X km","description":"One sentence about the trail — scenery, highlights, what makes it special.","website":null}

Rules:
- Only include real trails that actually exist near ${destination}
- difficulty must be one of: Easy, Moderate, Difficult, Strenuous
- distance is approximate round-trip in km (or one-way if point-to-point, note it in description)
- website: include the official trail or park URL if you know it with confidence, otherwise null
- Sort easiest to most difficult
- If there are no notable hiking trails within ~30 km, return an empty array []`;

  try {
    const text   = await claudeRequest(prompt);
    const trails = JSON.parse(text);
    res.status(200).json({ trails, count: trails.length });
  } catch(e) {
    console.error('trails error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
