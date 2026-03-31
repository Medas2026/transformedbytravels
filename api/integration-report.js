const BASE_ID = 'appdlxcWb45dIqNK2';

async function airtableFetch(table, params) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${params || ''}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey } });
  return resp.json();
}

async function airtablePatch(table, id, fields) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${id}`;
  const resp = await fetch(url, {
    method:  'PATCH',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields })
  });
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
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }]
    })
  });
  const data = await resp.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  if (!data.content) throw new Error('No content in response');
  return data.content[0]?.text || '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const email  = ((req.query?.email  || req.body?.email  || '') + '').toLowerCase().trim();
  const tripId = ((req.query?.tripId || req.body?.tripId || '') + '').trim();

  if (!email || !tripId) return res.status(400).json({ error: 'email and tripId required' });

  // GET — return existing saved report
  if (req.method === 'GET') {
    const data   = await airtableFetch('Trips', `/${tripId}`);
    const report = data.fields?.['Integration Report'] || '';
    return res.status(200).json({ report });
  }

  // POST — generate a new report
  if (req.method === 'POST') {
    // Fetch all data sources in parallel
    const [tripData, travelerData, workshopData, journalData] = await Promise.all([
      airtableFetch('Trips', `/${tripId}`),
      airtableFetch('Traveler',
        `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`),
      airtableFetch('Workshop Response',
        `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}` +
        `&sort[0][field]=Page&sort[0][direction]=asc`),
      airtableFetch('Journal Entries',
        `?filterByFormula=${encodeURIComponent(`AND({Traveler Email}="${email}",{Trip ID}="${tripId}")`)}` +
        `&sort[0][field]=Day%20Number&sort[0][direction]=asc`)
    ]);

    const trip      = tripData.fields || {};
    const traveler  = (travelerData.records || [])[0]?.fields || {};
    const workshops = workshopData.records  || [];
    const journals  = journalData.records   || [];

    // Build trip header
    const tripName = trip['Trip Name'] || trip['Destination'] || 'this trip';
    const dest     = [trip['Destination'], trip['Country']].filter(Boolean).join(', ');
    const dates    = [trip['Start Date'], trip['End Date']].filter(Boolean).join(' to ');

    // Traveler profile — include all readable fields
    const omit = new Set(['Traveler Email', 'Create Date', 'Last Modified', 'Phone Number',
                          'Subscription Active', 'Auth0 ID']);
    const profileLines = Object.entries(traveler)
      .filter(([k, v]) => !omit.has(k) && v !== undefined && v !== '' && v !== null && typeof v !== 'object')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') || '(no profile data)';

    // Workshop responses — all pages, up to 3 Q&A per page
    const workshopLines = workshops.map(r => {
      const f     = r.fields;
      const pairs = [];
      for (let i = 1; i <= 3; i++) {
        const q = (f[`Question ${i}`] || '').trim();
        const a = (f[`Answer ${i}`]   || '').trim();
        if (q && a) pairs.push(`Q: ${q}\nA: ${a}`);
      }
      if (!pairs.length) return null;
      return `[Page ${f['Page'] || '?'}]\n${pairs.join('\n')}`;
    }).filter(Boolean).join('\n\n') || '(no workshop responses)';

    // Journal entries
    const journalLines = journals.map(r => {
      const f     = r.fields;
      const label = f['Day Number'] ? `Day ${f['Day Number']}` : (f['Entry Date'] || 'Entry');
      const parts = [];
      if (f['Reflection']) parts.push(`Reflection: ${f['Reflection']}`);
      if (f['Barriers'])   parts.push(`Barriers: ${f['Barriers']}`);
      return parts.length ? `${label}:\n${parts.join('\n')}` : null;
    }).filter(Boolean).join('\n\n') || '(no journal entries)';

    const prompt = `You are an expert integration coach for Transformed by Travels. Your role is to help travelers synthesize their journey and prepare for their Integration Workshop — a structured process for turning travel experience into lasting personal growth.

== TRIP ==
Name: ${tripName}
Destination: ${dest}
Dates: ${dates}

== TRAVELER PROFILE ==
${profileLines}

== PRE-TRIP WORKSHOP RESPONSES ==
${workshopLines}

== DAILY JOURNAL ENTRIES (${journals.length} entries) ==
${journalLines}

Write a comprehensive Integration Report using markdown with these exact section headers:

## Journey Overview
A narrative arc of this trip — what happened, what shifted, how the journey unfolded.

## Key Themes
3–5 recurring themes or patterns drawn directly from the journal entries. Be specific.

## Connections to Pre-Trip Intentions
How the actual experience connected to or diverged from the pre-trip workshop hopes and goals.

## Growth Moments
Specific moments of insight, challenge overcome, or personal growth — reference actual journal entries where possible.

## Integration Workshop Recommendations
5–7 specific, actionable recommendations for the Integration Workshop. Ground each one in something this traveler actually experienced — not generic advice.

## Closing Reflection
A warm, personal paragraph that honors this traveler's unique journey.

Write in second person ("you"). Draw directly from the data — be specific, not generic.`;

    try {
      const report = await callClaude(prompt);
      await airtablePatch('Trips', tripId, { 'Integration Report': report });
      return res.status(200).json({ success: true, report });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
