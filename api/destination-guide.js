module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { destination, country, continent, scores, archetype } = req.body;

  if (!destination || !scores) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const { Curiosity, Adventure, Reflection, Connection, Intention } = scores;

  const prompt = `You are a transformational travel expert who specializes in matching destinations to a traveler's personal psychology.

A traveler has completed the Transformational Travel Profile assessment. Here are their results:

Archetype: ${archetype}

Dimension Scores (out of 7):
- Curiosity (intellectual exploration & culture): ${Curiosity}/7
- Adventure (physical challenge & novelty): ${Adventure}/7
- Reflection (solitude & inner contemplation): ${Reflection}/7
- Connection (human bonds & community): ${Connection}/7
- Intention (purposeful, meaningful travel): ${Intention}/7

They are exploring: ${destination}, ${country} (${continent})

Write a personalized destination guide for this specific traveler. Structure it as follows:

**Why ${destination} Could Transform You**
2–3 sentences explaining why this destination speaks to their particular profile.

**Experiences Tailored to Your Profile**
4–5 bullet points of specific activities or approaches at this destination that align with their highest-scoring dimensions. Be concrete and vivid.

**Your Growth Edge Here**
1–2 sentences on what this destination might gently challenge them on (based on lower scores) and why that stretch could be valuable.

**How to Travel Here as a ${archetype}**
2–3 sentences of practical mindset advice for getting the most transformational value from this trip given who they are.

Keep the tone warm, inspiring, and personal — speak directly to "you". Be specific to the destination, not generic. Total length: 250–320 words.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Anthropic API error', detail: data.error?.message });
    }

    const text = data.content?.[0]?.text;
    if (!text) {
      console.error('Unexpected response shape:', JSON.stringify(data));
      return res.status(502).json({ error: 'Unexpected response from API' });
    }

    return res.status(200).json({ guide: text });

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
