module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, type, category } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });

  const prompt = `You are a wildlife expert writing for a safari travel app. Given the animal below, provide accurate, concise information in JSON format.

Animal: ${name}
Type: ${type || 'unknown'}
Category: ${category || 'unknown'}

Respond with ONLY valid JSON in this exact format:
{
  "scientificName": "the Latin scientific name, e.g. Gorilla beringei beringei",
  "description": "3 engaging sentences about this animal for a traveler who just spotted it on safari. What makes it special, notable behaviors, why travelers love seeing it.",
  "habitat": "1-2 sentences on where this animal lives and how to find it in the wild.",
  "conservationStatus": "one of: Least Concern, Near Threatened, Vulnerable, Endangered, Critically Endangered",
  "bestMonths": ["Jan", "Feb"]
}

For bestMonths, list the months when this animal is most reliably seen in East/Central Africa (Uganda, Rwanda, Tanzania region). Use 3-letter abbreviations. If year-round, include all 12.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':            'application/json',
        'x-api-key':               process.env.ANTHROPIC_API_KEY,
        'anthropic-version':       '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Could not parse response' });
    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json(result);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
