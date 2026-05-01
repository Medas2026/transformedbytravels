const https = require('https');

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(body)
      }
    }, (r) => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          resolve((parsed.content && parsed.content[0] && parsed.content[0].text) || '');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { location, country, type, passions } = req.body;
  if (!location) return res.status(400).json({ error: 'Missing location' });

  const passionLine = passions ? `Traveler interests: ${passions}.` : '';
  const prompt = `Suggest 3 well-regarded ${type || 'hotel'}s in ${location}${country ? ', ' + country : ''}. ${passionLine}

Rules:
- Only suggest real, established properties you are confident exist
- Prefer properties that match the traveler's interests where possible
- Do not invent or guess property names
- Keep notes brief (one short phrase)

Respond with ONLY a JSON array, no explanation:
[{ "name": "Property Name", "note": "one brief descriptor" }]`;

  try {
    const text = await callClaude(prompt);
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: 'Could not parse response', raw: text });
    const suggestions = JSON.parse(match[0]);
    return res.json({ suggestions });
  } catch(e) {
    console.error('[suggest-lodging]', e);
    return res.status(500).json({ error: e.message });
  }
};
