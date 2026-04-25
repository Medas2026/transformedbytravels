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

function slotLabel(slot) {
  if (!slot || !slot.type || slot.type === '— Empty —') return null;
  const t   = slot.time ? slot.time + ': ' : '';
  const loc = slot.location ? ' at ' + slot.location : '';
  switch (slot.type) {
    case 'activity':   return t + (slot.name || 'Activity') + (slot.passion ? ' (' + slot.passion + ')' : '') + loc;
    case 'restaurant': return t + 'Dining at ' + (slot.restaurant || slot.name || 'Restaurant') + (slot.cuisine ? ' — ' + slot.cuisine : '') + loc;
    case 'transfer':   return 'Transfer: ' + (slot.from || '') + ' → ' + (slot.to || '') + (slot.mode ? ' by ' + slot.mode : '');
    case 'event':      return t + 'Event: ' + (slot.eventName || slot.name || 'Event') + (slot.venue ? ' at ' + slot.venue : '') + loc;
    case 'gyg':        return t + 'Experience: ' + (slot.name || 'GetYourGuide booking') + loc;
    case 'freeform':   return t + (slot.description || slot.name || 'Note') + loc;
    default:           return t + (slot.name || slot.type) + loc;
  }
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

  const [tripData, daysData, lodgingData, travelerData] = await Promise.all([
    airtableFetch('Trips', `/${tripId}`),
    airtableFetch('Trip Days',
      '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`) +
      '&sort[0][field]=Day%20Number&sort[0][direction]=asc'),
    airtableFetch('Lodging',
      '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`)),
    email
      ? airtableFetch('Traveler', `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`)
      : Promise.resolve({ records: [] })
  ]);

  const trip     = tripData.fields || {};
  const days     = (daysData.records || []).map(r => ({ _id: r.id, ...r.fields }));
  const lodgingById = {};
  (lodgingData.records || []).forEach(r => { lodgingById[r.id] = r.fields; });
  const traveler = (travelerData.records || [])[0]?.fields || {};

  const tripName  = trip['Trip Name'] || trip['Destination'] || 'this trip';
  const dest      = [trip['Destination'], trip['Country']].filter(Boolean).join(', ');
  const startDate = trip['Start Date'] || '';
  const endDate   = trip['End Date']   || '';
  const archetype = traveler['Archetype'] || '';
  const passions  = trip['Trip Passions'] || '';

  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build structured day objects
  const structuredDays = days.map(d => {
    const dateRaw = d['Date'] || '';
    let dateLabel = '';
    if (dateRaw) {
      const dt = new Date(dateRaw + 'T00:00:00Z');
      dateLabel = WEEKDAYS[dt.getUTCDay()] + ', ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
    }
    const lodgingId   = d['Lodging ID'] || '';
    const lodgingRec  = lodgingId && lodgingById[lodgingId] ? lodgingById[lodgingId] : null;
    const slots = [1, 2, 3, 4].map(n => {
      const raw = d['Slot ' + n];
      if (!raw) return null;
      try { return JSON.parse(raw); } catch(e) { return null; }
    }).filter(Boolean);

    return {
      dayNum:    d['Day Number'] || 0,
      date:      dateRaw,
      dateLabel,
      startLoc:  d['Starting Location'] || '',
      endLoc:    d['Ending Location']   || '',
      lodging:   lodgingRec ? (lodgingRec['Name'] || '') : '',
      slotLabels: slots.map(slotLabel).filter(Boolean)
    };
  });

  // Format days for the prompt
  const dayScheduleText = structuredDays.map(d => {
    const loc = d.startLoc && d.endLoc && d.startLoc !== d.endLoc
      ? `${d.startLoc} → ${d.endLoc}`
      : (d.startLoc || d.endLoc || '');
    const lines = [`Day ${d.dayNum}${d.dateLabel ? ' — ' + d.dateLabel : ''}${loc ? ' (' + loc + ')' : ''}`];
    if (d.lodging) lines.push(`  Staying at: ${d.lodging}`);
    if (d.slotLabels.length) {
      d.slotLabels.forEach(s => lines.push(`  • ${s}`));
    } else {
      lines.push(`  (free day / no activities planned)`);
    }
    return lines.join('\n');
  }).join('\n\n');

  const prompt = `You are a transformational travel expert for Transformed by Travels.

TRIP: ${tripName}
DESTINATION: ${dest}
DATES: ${startDate ? startDate + ' to ' + endDate : 'not set'}
TRAVELER ARCHETYPE: ${archetype || 'not specified'}
TRIP PASSIONS: ${passions || 'not specified'}

DAILY SCHEDULE:
${dayScheduleText || '(no schedule planned yet)'}

Please write the following:

## TRIP SUMMARY
Write 2–3 paragraphs giving an overview of this trip from a transformational travel perspective. Cover the destination, the overall journey arc, and what makes this trip meaningful. Tailor the tone to a ${archetype || 'growth-minded'} traveler. Write in second person ("you").

## DAY SUMMARIES
For each day in the schedule above, write 1–2 vivid sentences that capture the spirit and experience of that day — what it will feel like, not just what will happen. Format exactly like this (use the exact Day numbers from the schedule):

### Day 1
[1–2 sentence narrative]

### Day 2
[1–2 sentence narrative]

Continue for all ${structuredDays.length} days. Be specific and evocative.`;

  try {
    const raw = await callClaude(prompt);

    // Parse trip summary
    const summaryMatch = raw.match(/##\s*TRIP SUMMARY\s*([\s\S]*?)(?=##\s*DAY SUMMARIES|$)/i);
    const tripSummary  = summaryMatch ? summaryMatch[1].trim() : '';

    // Parse day summaries
    const daySummaries = {};
    const daySectionMatch = raw.match(/##\s*DAY SUMMARIES\s*([\s\S]*?)$/i);
    if (daySectionMatch) {
      for (const m of daySectionMatch[1].matchAll(/###\s*Day\s*(\d+)\s*\n([\s\S]*?)(?=###\s*Day\s*\d|$)/gi)) {
        daySummaries[parseInt(m[1])] = m[2].trim();
      }
    }

    return res.status(200).json({
      tripName,
      destination: dest,
      startDate,
      endDate,
      archetype,
      passions,
      tripSummary,
      days: structuredDays,
      daySummaries
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
