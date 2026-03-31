const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b           = req.body || {};
  const places      = (b.places      || []).filter(Boolean);
  const destination = (b.destination || '').trim();
  const country     = (b.country     || '').trim();

  if (!places.length) return res.status(400).json({ error: 'places required' });

  const list = places.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const prompt = `You are a geocoding assistant. Return the latitude and longitude for each of the following places.

Places:
${list}

Respond with a JSON array only — no explanation, no markdown, no code fences. Example:
[{"name":"Place Name","lat":48.8566,"lng":2.3522}]

Include every place in order. Use the most precise coordinates available.`;

  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 500,
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

  const reqOut = https.request(options, (r) => {
    let data = '';
    r.on('data', c => { data += c; });
    r.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        let text = (parsed.content && parsed.content[0] && parsed.content[0].text) || '[]';
        // Strip any accidental markdown fences
        text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
        const coords = JSON.parse(text);
        res.status(200).json({ coords });
      } catch(e) {
        res.status(500).json({ error: 'Parse error: ' + e.message });
      }
    });
  });
  reqOut.on('error', e => res.status(500).json({ error: e.message }));
  reqOut.write(body);
  reqOut.end();
};
