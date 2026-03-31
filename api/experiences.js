module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b           = req.body || {};
  const destination = (b.destination || '').trim();
  const archetype   = (b.archetype   || '').trim();
  const activities  = Array.isArray(b.activities) ? b.activities : [];

  if (!destination) {
    return res.status(400).json({ error: 'destination required' });
  }

  const hasActivities = activities.length > 0;
  const activityList = hasActivities
    ? activities.slice(0, 6).map((a, i) => `${i + 1}. ${a}`).join('\n')
    : '';

  const prompt = `You are a knowledgeable travel experience specialist. A traveler with the archetype "${archetype || 'Transformational Traveler'}" is planning a trip to ${destination} and wants specific experience recommendations tailored to their interests.

${hasActivities ? `Their top activities based on their travel profile:\n${activityList}` : `Based on their "${archetype || 'Transformational Traveler'}" archetype, identify 5 activities that would suit them best at this destination.`}

For each activity listed, suggest 2 specific experiences, operators, or providers they could book in ${destination}. These should be real, named companies, tour operators, local guides, or well-known experiences actually available in ${destination}. Be specific — use real names where possible.

Format your response as JSON only, no other text. Use this exact structure:
{
  "destination": "${destination}",
  "experiences": [
    {
      "activity": "activity name",
      "suggestions": [
        { "name": "provider or experience name", "description": "one sentence describing what it is and why it suits this traveler" },
        { "name": "provider or experience name", "description": "one sentence describing what it is and why it suits this traveler" }
      ]
    }
  ]
}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages:   [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    const text = data.content?.[0]?.text || '';
    const json = JSON.parse(text.replace(/^```json\n?|\n?```$/g, '').trim());
    return res.status(200).json(json);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
