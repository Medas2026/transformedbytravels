const https = require('https');

function claudeActivities(prompt) {
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
          resolve((parsed.content && parsed.content[0] && parsed.content[0].text) || '[]');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function salvageJson(text) {
  const start = text.indexOf('[');
  if (start === -1) return [];
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  const chunk = end !== -1 ? text.slice(start, end + 1) : text.slice(start);
  // Try trimming to last complete object
  try { return JSON.parse(chunk); } catch(_) {}
  const lastBrace = chunk.lastIndexOf('},');
  if (lastBrace !== -1) {
    try { return JSON.parse(chunk.slice(0, lastBrace + 1) + ']'); } catch(_) {}
  }
  return [];
}

function buildPrompt(type, place, country) {
  const loc = country ? `${place}, ${country}` : place;

  if (type === 'diving') {
    return `You are a scuba diving expert. List the top 5-7 dive sites near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Site Name",
    "depth": "5-25m",
    "difficulty": "Beginner",
    "type": "Reef / Wall / Wreck / Muck",
    "highlights": "One sentence about what makes this site special.",
    "detail": "2-3 sentences covering what divers will see, practical tips (best season, visibility, currents), and why it stands out."
  }
]

Difficulty must be one of: Beginner, Intermediate, Advanced, All levels.
If ${loc} has no notable diving, return an empty array [].`;
  }

  if (type === 'fishing') {
    return `You are a fishing guide expert. List the top 5-7 fishing spots or experiences near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Spot or Experience Name",
    "type": "Fly Fishing / Deep Sea / Shore / Lake / River",
    "species": "Main fish species targeted",
    "highlights": "One sentence about what makes this spot or experience special.",
    "detail": "2-3 sentences covering target species, best techniques or seasons, and practical tips for visiting."
  }
]

If ${loc} has no notable fishing, return an empty array [].`;
  }

  if (type === 'sailing') {
    return `You are a sailing expert. List the top 5-7 sailing experiences, anchorages, or charter options near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Anchorage, Route, or Charter Name",
    "type": "Day Sail / Bareboat Charter / Crewed Charter / Anchorage / Regatta",
    "conditions": "Brief description of wind/water conditions and best season",
    "highlights": "One sentence about what makes this special.",
    "detail": "2-3 sentences covering the sailing experience, wind and weather conditions, and tips for chartering or visiting."
  }
]

If ${loc} has no notable sailing, return an empty array [].`;
  }

  if (type === 'kayaking') {
    return `You are a kayaking and paddling expert. List the top 5-7 kayaking spots or tours near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Location or Tour Name",
    "type": "Sea Kayaking / River / Lake / Whitewater / Tour",
    "difficulty": "Beginner / Intermediate / Advanced",
    "highlights": "One sentence about what makes this spot special.",
    "detail": "2-3 sentences covering the paddling experience, water conditions, wildlife or scenery, and practical tips."
  }
]

Difficulty must be one of: Beginner, Intermediate, Advanced.
If ${loc} has no notable kayaking, return an empty array [].`;
  }

  if (type === 'mountain-biking') {
    return `You are a mountain biking expert. List the top 5-7 mountain biking trails or areas near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Trail or Area Name",
    "difficulty": "Green / Blue / Black / Double Black",
    "terrain": "Brief description of terrain type",
    "highlights": "One sentence about what makes this trail special.",
    "detail": "2-3 sentences covering terrain features, trail flow, technical challenges, and best time to ride."
  }
]

Difficulty must be one of: Green, Blue, Black, Double Black.
If ${loc} has no notable mountain biking, return an empty array [].`;
  }

  if (type === 'wildlife') {
    return `You are a wildlife viewing expert. List the top 5-7 wildlife viewing spots or experiences near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Location or Tour Name",
    "species": "Key wildlife species that can be seen",
    "best_season": "Best time of year to visit",
    "highlights": "One sentence about what makes this spot special.",
    "detail": "2-3 sentences covering the wildlife experience, best viewing conditions, guided tour options, and practical tips."
  }
]

If ${loc} has no notable wildlife viewing, return an empty array [].`;
  }

  if (type === 'photography') {
    return `You are a travel photography expert. List the top 5-7 photography spots near ${loc} — landscapes, architecture, street scenes, or natural features.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Location Name",
    "type": "Landscape / Architecture / Street / Wildlife / Seascape / Aerial",
    "best_time": "Golden hour / Blue hour / Midday / Night / Sunrise / Seasonal",
    "highlights": "One sentence about what makes this a great photography spot.",
    "detail": "2-3 sentences covering the best angles, light conditions, equipment tips, and what subjects to look for."
  }
]

If ${loc} has no notable photography spots, return an empty array [].`;
  }

  if (type === 'mountaineering') {
    return `You are a mountaineering and rock climbing expert. List the top 5-7 climbing or mountaineering routes and areas near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Route or Area Name",
    "type": "Rock Climbing / Alpine / Summit / Via Ferrata / Bouldering",
    "difficulty": "Grade or general level (e.g. Beginner, Intermediate, Expert, 5.8, Grade II)",
    "highlights": "One sentence about what makes this route or area special.",
    "detail": "2-3 sentences covering the climbing experience, approach logistics, gear requirements, and best season."
  }
]

If ${loc} has no notable mountaineering or climbing, return an empty array [].`;
  }

  if (type === 'history-art') {
    return `You are a cultural travel expert. List the top 5-7 history and art sites, museums, or cultural experiences near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Site or Museum Name",
    "type": "Museum / Historic Site / Gallery / Monument / Cultural Quarter",
    "era": "Historical period or art movement associated with this place",
    "highlights": "One sentence about what makes this site significant.",
    "detail": "2-3 sentences covering the history or artwork, what visitors should not miss, and practical visiting tips."
  }
]

If ${loc} has no notable history or art sites, return an empty array [].`;
  }

  if (type === 'archaeology') {
    return `You are an archaeology and ancient history expert. List the top 5-7 archaeological sites or ancient ruins near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Site Name",
    "civilization": "Culture or civilization associated with this site",
    "era": "Approximate historical period",
    "highlights": "One sentence about what makes this site remarkable.",
    "detail": "2-3 sentences covering what has been excavated, the significance to its civilization, and visitor access or guided tour options."
  }
]

If ${loc} has no notable archaeological sites, return an empty array [].`;
  }

  if (type === 'coffee') {
    return `You are a specialty coffee travel expert. List the top 5-7 specialty coffee shops, roasters, or coffee experiences near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Cafe or Roaster Name",
    "type": "Specialty Cafe / Roastery / Coffee Bar / Traditional Coffeehouse",
    "specialty": "What they're known for — origin focus, brewing method, or signature drink",
    "highlights": "One sentence about what makes this a must-visit for coffee lovers.",
    "detail": "2-3 sentences covering the coffee sourcing, brewing philosophy, atmosphere, and what to order."
  }
]

If ${loc} has no notable specialty coffee, return an empty array [].`;
  }

  if (type === 'culinary') {
    return `You are a culinary travel expert. List the top 5-7 culinary experiences — food tours, cooking classes, markets, or iconic restaurants — near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Experience or Venue Name",
    "type": "Food Tour / Cooking Class / Market / Restaurant / Street Food",
    "specialty": "Signature dish, cuisine style, or culinary focus",
    "highlights": "One sentence about what makes this experience special.",
    "detail": "2-3 sentences covering the flavours, the chef or guide, what participants take away, and booking tips."
  }
]

If ${loc} has no notable culinary experiences, return an empty array [].`;
  }

  if (type === 'wine') {
    return `You are a wine and viticulture travel expert. List the top 5-7 wine experiences — wineries, wine regions, tastings, or wine tours — near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Winery, Region, or Tour Name",
    "type": "Winery Visit / Wine Tour / Tasting Room / Wine Trail / Cellar Door",
    "varietals": "Key grape varieties or wine styles produced here",
    "highlights": "One sentence about what makes this experience special.",
    "detail": "2-3 sentences covering the grape varieties, tasting experience, cellar or vineyard setting, and visit logistics."
  }
]

If ${loc} has no notable wine experiences, return an empty array [].`;
  }

  if (type === 'pilgrimage') {
    return `You are a spiritual travel expert. List the top 5-7 pilgrimage sites, sacred sites, or spiritual journeys near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Site or Route Name",
    "tradition": "Religious or spiritual tradition associated with this site",
    "type": "Shrine / Temple / Cathedral / Sacred Mountain / Pilgrimage Route",
    "highlights": "One sentence about the spiritual or cultural significance.",
    "detail": "2-3 sentences covering the religious tradition, the journey or ritual involved, and practical tips for respectful visiting."
  }
]

If ${loc} has no notable pilgrimage or sacred sites, return an empty array [].`;
  }

  if (type === 'volunteerism') {
    return `You are a volunteer travel expert. List the top 5-7 volunteer travel opportunities or organizations working near ${loc}.

Return ONLY a JSON array. No explanation before or after. Example format:
[
  {
    "name": "Organization or Program Name",
    "focus": "Conservation / Education / Community Development / Wildlife / Disaster Relief",
    "duration": "Typical commitment (e.g. 1 week, 2 weeks, flexible)",
    "highlights": "One sentence about the impact and experience of volunteering here.",
    "detail": "2-3 sentences covering the volunteer work involved, who it's suited for, typical commitment, and how to apply or book."
  }
]

If ${loc} has no notable volunteer travel opportunities, return an empty array [].`;
  }

  // Generic fallback
  return `You are a local activities expert. List the top 5-7 ${type} spots or experiences near ${loc}.

Return ONLY a JSON array with objects containing: name, type, highlights (one sentence), detail (2-3 sentence paragraph with practical tips).
If none exist, return [].`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { place, country, type } = req.body || {};
    if (!place) return res.status(400).json({ error: 'place is required' });
    if (!type)  return res.status(400).json({ error: 'type is required' });

    const prompt = buildPrompt(type, place, country || '');
    const text   = await claudeActivities(prompt);

    let items;
    try {
      items = JSON.parse(text);
    } catch(_) {
      items = salvageJson(text);
    }

    return res.status(200).json({ items: Array.isArray(items) ? items : [] });
  } catch(e) {
    console.error('activities error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
