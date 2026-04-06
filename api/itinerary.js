const BASE_ID = 'appdlxcWb45dIqNK2';

async function airtableFetch(table, params) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${params || ''}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey } });
  return resp.json();
}

async function callClaude(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  if (!data.content) throw new Error('No content in response');
  return data.content[0]?.text || '';
}

function dayToDate(startDate, day) {
  if (!startDate || !day) return null;
  const d = new Date(startDate + 'T12:00:00');
  d.setDate(d.getDate() + (day - 1));
  return d;
}

function formatDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tripId = ((req.body?.tripId) || '').trim();
  const email  = ((req.body?.email)  || '').toLowerCase().trim();
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  const [tripData, placesData, travelerData] = await Promise.all([
    airtableFetch('Trips', `/${tripId}`),
    airtableFetch('Trip Places',
      '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`) +
      '&sort[0][field]=Day&sort[0][direction]=asc'),
    email
      ? airtableFetch('Traveler', `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`)
      : Promise.resolve({ records: [] })
  ]);

  const trip     = tripData.fields || {};
  const places   = (placesData.records || []).map(r => r.fields);
  const traveler = (travelerData.records || [])[0]?.fields || {};

  const tripName  = trip['Trip Name']   || trip['Destination'] || 'this trip';
  const dest      = [trip['Destination'], trip['Country']].filter(Boolean).join(', ');
  const startDate = trip['Start Date']  || '';
  const endDate   = trip['End Date']    || '';
  const archetype = traveler['Archetype'] || '';

  // Build place date ranges
  const placeRows = places.map((p, i) => {
    const arrDay  = p['Day'] || null;
    const nextDay = (places[i + 1] && places[i + 1]['Day']) || null;
    const arrDate = dayToDate(startDate, arrDay);
    const depDate = nextDay
      ? dayToDate(startDate, nextDay - 1)
      : (endDate ? new Date(endDate + 'T12:00:00') : null);
    return {
      name:        p['Place']          || '(unnamed)',
      country:     p['Country']        || '',
      notes:       p['Notes']          || '',
      stayedAtUrl: p['Stayed at URL']  || '',
      arrDate:  formatDate(arrDate),
      depDate:  formatDate(depDate),
      dateRange: arrDate
        ? (depDate && formatDate(depDate) !== formatDate(arrDate)
          ? `${formatDate(arrDate)} – ${formatDate(depDate)}`
          : formatDate(arrDate))
        : ''
    };
  });

  const placeListForPrompt = placeRows.map((p, i) => {
    let line = `${i + 1}. ${p.name}${p.country ? ', ' + p.country : ''}${p.dateRange ? ' (' + p.dateRange + ')' : ''}`;
    if (p.notes) line += `\n   Notes: ${p.notes}`;
    if (p.stayedAtUrl) line += `\n   Accommodation URL: ${p.stayedAtUrl}`;
    return line;
  }).join('\n');

  const hotelPlaces = placeRows.filter(p => p.stayedAtUrl);
  const hotelSection = hotelPlaces.length ? `

## HOTEL SUMMARIES
For each place below that has an accommodation URL, write a short "Where You'll Stay" paragraph (2–3 sentences). You cannot visit the URL — instead write about what kind of stay experience suits this destination for a transformational traveler: the setting, what proximity to key experiences means, and what to savour about having a home base there.

${hotelPlaces.map(p => `### ${p.name}\n(URL: ${p.stayedAtUrl})`).join('\n\n')}` : '';

  const prompt = `You are a transformational travel expert for Transformed by Travels, helping travelers plan meaningful journeys.

TRIP: ${tripName}
DESTINATION: ${dest}
DATES: ${startDate ? startDate + ' to ' + endDate : 'dates not set'}
TRAVELER ARCHETYPE: ${archetype || 'not specified'}

PLACES TO VISIT:
${placeListForPrompt || '(no places added yet)'}

Write a travel itinerary overview with the following parts:

## DESTINATION OVERVIEW
Write 2–3 paragraphs about ${dest} from a transformational travel perspective. Cover what makes this destination uniquely powerful for personal growth, cultural depth, and meaningful experience. Tailor the tone to a ${archetype || 'growth-minded'} traveler.

## PLACE SUMMARIES
For each place listed above, write a short "Stay Summary" (2–4 sentences). Focus on what this specific place offers the traveler — the experiences, atmosphere, and transformation potential. Be vivid and specific, not generic.

Format each place summary exactly like this:
### [Place Name]
[2–4 sentence summary]
${hotelSection}

Write in second person ("you"). Be specific and evocative, not a Wikipedia summary.`;

  try {
    const raw = await callClaude(prompt);

    // Parse destination overview
    const destMatch = raw.match(/##\s*DESTINATION OVERVIEW\s*([\s\S]*?)(?=##\s*PLACE SUMMARIES|$)/i);
    const destOverview = destMatch ? destMatch[1].trim() : '';

    // Parse place summaries
    const placeSummaries = {};
    const placeSectionMatch = raw.match(/##\s*PLACE SUMMARIES\s*([\s\S]*?)(?=##\s*HOTEL SUMMARIES|$)/i);
    if (placeSectionMatch) {
      const placeBlocks = placeSectionMatch[1].matchAll(/###\s*(.+?)\n([\s\S]*?)(?=###|$)/g);
      for (const match of placeBlocks) {
        placeSummaries[match[1].trim()] = match[2].trim();
      }
    }

    // Parse hotel summaries
    const hotelSummaries = {};
    const hotelSectionMatch = raw.match(/##\s*HOTEL SUMMARIES\s*([\s\S]*?)$/i);
    if (hotelSectionMatch) {
      const hotelBlocks = hotelSectionMatch[1].matchAll(/###\s*(.+?)\n([\s\S]*?)(?=###|$)/g);
      for (const match of hotelBlocks) {
        hotelSummaries[match[1].trim()] = match[2].trim();
      }
    }

    return res.status(200).json({
      tripName,
      destination: dest,
      startDate,
      endDate,
      places:         placeRows,
      destOverview,
      placeSummaries,
      hotelSummaries
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
