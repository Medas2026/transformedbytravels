const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const place       = (req.query.place       || '').trim();
  const destination = (req.query.destination || '').trim();
  const country     = (req.query.country     || '').trim();

  if (!place) return res.status(400).json({ error: 'place required' });

  const context = [destination, country].filter(Boolean).join(', ');
  const prompt  = `You are a travel expert. Give a brief overview of "${place}"${context ? ' in ' + context : ''} for a traveler planning a visit.

Return exactly 4 bullet points covering:
1. What it is / why it's worth visiting
2. Top thing to do or see there
3. Best time to visit or practical tip
4. One insider tip or hidden gem

Format as a simple HTML unordered list using <ul> and <li> tags only. No headings, no extra text outside the list. Keep each bullet concise (one sentence).`;

  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 400,
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
        let text = parsed.content && parsed.content[0] && parsed.content[0].text || '';
        // Strip markdown code fences if present
        text = text.replace(/^```[\w]*\n?/,'').replace(/\n?```$/,'').trim();
        res.status(200).json({ guide: text });
      } catch(e) {
        res.status(500).json({ error: 'Parse error: ' + e.message });
      }
    });
  });
  reqOut.on('error', e => res.status(500).json({ error: e.message }));
  reqOut.write(body);
  reqOut.end();
};
