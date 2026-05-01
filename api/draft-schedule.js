const https = require('https');

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 1200,
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

  const { destination, country, totalDays, days, passions, instructions } = req.body;

  if (!destination || !totalDays) return res.status(400).json({ error: 'Missing destination or totalDays' });

  // Separate already-filled days (context) from empty ones (to fill)
  const filledDays   = (days || []).filter(d => d.endingLocation || d.startingLocation);
  const emptyDayNums = (days || []).filter(d => !d.endingLocation && !d.startingLocation).map(d => d.dayNum);

  if (!emptyDayNums.length) return res.json({ suggestions: [] });

  const filledSummary = filledDays.length
    ? filledDays.map(d => `  Day ${d.dayNum}: ${d.startingLocation || '?'} → ${d.endingLocation || '?'}`).join('\n')
    : '  (none yet)';

  const passionLine = passions ? `Traveler passions: ${passions}` : '';
  const instrLine   = instructions ? `Special requests: ${instructions}` : '';

  const prompt = `You are a travel route planner. Fill in a rough draft of locations for a trip to ${destination}, ${country} (${totalDays} days total).

${passionLine}
${instrLine}

Days already filled in by the traveler (do not change these):
${filledSummary}

Fill in ONLY these empty days: ${emptyDayNums.join(', ')}

Rules:
- Suggest real places within or near ${destination}, ${country}
- Cluster nearby locations for 2–3 days before moving on — avoid unrealistic daily relocations
- Starting Location for a day should match the previous day's Ending Location where logical
- This is a rough draft starting point, not a detailed itinerary
- Keep location names short (city or region name, not full address)

Respond with ONLY a JSON array, no explanation. Each element:
{ "dayNum": <number>, "startingLocation": "<place>", "startingCountry": "${country}", "endingLocation": "<place>", "endingCountry": "${country}" }`;

  try {
    const text = await callClaude(prompt);

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: 'Could not parse Claude response', raw: text });

    const suggestions = JSON.parse(match[0]);
    return res.json({ suggestions });
  } catch (e) {
    console.error('[draft-schedule] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
