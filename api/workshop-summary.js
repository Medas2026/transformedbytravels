const https = require('https');

function claudeRequest(prompt) {
  return new Promise((resolve, reject) => {
    const apiKey  = process.env.ANTHROPIC_API_KEY;
    const bodyStr = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          const text   = (parsed.content || [])[0]?.text || '';
          resolve(text);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { travelerName, archetype, passions, lifeStage, questions } = req.body || {};
    if (!travelerName || !questions || !questions.length) {
      return res.status(400).json({ error: 'travelerName and questions required' });
    }

    const qaText = questions
      .filter(q => q.response && q.response.trim())
      .map(q => `Question: ${q.prompt}\nResponse: ${q.response.trim()}`)
      .join('\n\n');

    if (!qaText) return res.status(400).json({ error: 'No responses to summarize' });

    const prompt = `You are writing a third-person pre-trip summary for a traveler preparing for an upcoming journey.

Traveler: ${travelerName}
Archetype: ${archetype || 'not specified'}
Passions: ${passions || 'not specified'}
Life Stage: ${lifeStage || 'not specified'}

Below are their responses to pre-trip workshop questions:

${qaText}

Write a 2–3 paragraph summary in third person that captures ${travelerName}'s mindset, intentions, and what they hope to experience on this journey. Weave the responses into a coherent narrative — do not list answers individually. Use a warm, insightful tone. Refer to the traveler by first name.`;

    const summary = await claudeRequest(prompt);
    res.status(200).json({ summary });
  } catch(e) {
    console.error('[workshop-summary] error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
