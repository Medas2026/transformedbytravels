module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, traveler, destination, year, day, allParks } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type required' });

  let prompt;

  if (type === 'opening') {
    const parks = (allParks || []).join(', ');
    prompt = `Write a 2 sentence opening paragraph for a personal travel memoir book.

Traveler: ${traveler || 'the traveler'}
Destination: ${destination || 'Africa'}
Year: ${year || ''}
Places visited: ${parks || destination}

Write in first person. Capture the anticipation, what drew them here, and the feeling of arrival. Be specific to ${destination} — its landscape, wildlife, or atmosphere. Warm and personal, not brochure-like. No clichés ("once in a lifetime", "breathtaking", "magical"). No markdown. Plain prose only.`;

  } else if (type === 'day') {
    const { num, location, park, lodge, date, notes } = day || {};
    prompt = `Write a short journal entry (2-3 sentences, maximum 60 words) for a personal travel memoir.

Traveler: ${traveler || 'the traveler'}
Day ${num || ''}: ${date || ''}
Location: ${location || park || ''}
Park / Wildlife area: ${park || ''}
${lodge ? `Lodge: ${lodge}` : ''}
${notes ? `Traveler's own notes and highlights: "${notes}"` : ''}

Write in first person.${notes ? ' Draw directly from the traveler\'s notes above — use their specific highlights, moments, and language as the foundation.' : ` Be specific to what ${park || location} is known for — its wildlife, landscape, sounds, or atmosphere.`} Capture a single vivid moment or feeling rather than a summary. Warm and personal. No clichés ("breathtaking", "magical", "once in a lifetime"). No markdown. Plain prose only. Stay under 60 words.`;

  } else if (type === 'closing') {
    const parks = (allParks || []).join(', ');
    prompt = `Write a 2 sentence closing reflection for a personal travel memoir book.

Traveler: ${traveler || 'the traveler'}
Destination: ${destination || 'Africa'}
Places visited: ${parks || destination}

Write in first person. Reflect on what the journey revealed or changed. Be specific to ${destination} — not generic travel wisdom. End with a forward-looking thought about carrying something from this place into everyday life. No clichés. No markdown. Plain prose only.`;

  } else if (type === 'back-cover') {
    const parks = (allParks || []).join(', ');
    prompt = `Write 2 short sentences (about 30 words total) for the back cover of a personal travel memoir — a closing crescendo.

Traveler: ${traveler || 'the traveler'}
Destination: ${destination || 'Africa'}
Places visited: ${parks || destination}

Write in first person only ("I", "me", "my") — never second or third person. This is the very last word in the book — make it linger. Capture the transformation: what the land gave, what the traveler carries forward. Poetic, resonant, specific to ${destination}. No clichés. No markdown. Plain prose only.`;

  } else {
    return res.status(400).json({ error: 'type must be opening, day, closing, or back-cover' });
  }

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content?.[0]?.text?.trim() || '';
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
