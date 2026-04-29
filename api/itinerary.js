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
  await fetch(url, {
    method:  'PATCH',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ fields })
  });
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

  const [tripData, daysData, lodgingData, travelerData, reservationsData] = await Promise.all([
    airtableFetch('Trips', `/${tripId}`),
    airtableFetch('Trip Days',
      '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`) +
      '&sort[0][field]=Day%20Number&sort[0][direction]=asc'),
    airtableFetch('Lodging',
      '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`)),
    email
      ? airtableFetch('Traveler', `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`)
      : Promise.resolve({ records: [] }),
    airtableFetch('Reservations',
      '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`) +
      '&sort[0][field]=Key%20Date&sort[0][direction]=asc'
    ).catch(() => ({ records: [] }))
  ]);

  const tripRecordId = tripData.id;
  const trip     = tripData.fields || {};
  const days     = (daysData.records || []).map(r => ({ _id: r.id, ...r.fields }));
  const lodgingById = {};
  (lodgingData.records || []).forEach(r => { lodgingById[r.id] = r.fields; });
  const traveler = (travelerData.records || [])[0]?.fields || {};

  // Build reservations keyed by date (YYYY-MM-DD) and as a flat list
  const reservationsByDate = {};
  const allReservations = [];
  (reservationsData.records || []).forEach(r => {
    const f       = r.fields;
    const rawDate = f['Key Date'] || '';
    // Normalize to YYYY-MM-DD regardless of Airtable format
    let date = '';
    if (rawDate) {
      const parsed = new Date(rawDate);
      if (!isNaN(parsed)) date = parsed.toISOString().split('T')[0];
      else date = rawDate.split('T')[0];
    }
    if (!date) return;
    let parsed = {};
    try { parsed = JSON.parse(f['Parsed Data'] || '{}'); } catch(e) {}
    const entry = { type: f['Type'] || 'other', parsed, date };
    if (!reservationsByDate[date]) reservationsByDate[date] = [];
    reservationsByDate[date].push(entry);
    allReservations.push(entry);
  });

  const tripName  = trip['Trip Name'] || trip['Destination'] || 'this trip';
  const dest      = [trip['Destination'], trip['Country']].filter(Boolean).join(', ');
  const startDate = trip['Start Date'] || '';
  const endDate   = trip['End Date']   || '';
  const archetype = traveler['Archetype'] || '';
  const passions  = trip['Trip Passions'] || '';

  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build structured day objects — lodging shown as paragraph on check-in day only
  const seenLodgingIds = new Set();
  const structuredDays = days.map(d => {
    // Use stored Date field; fall back to computing from trip start + day number
    let dateRaw = d['Date'] || '';
    if (!dateRaw && startDate) {
      const base = new Date(startDate + 'T00:00:00Z');
      base.setUTCDate(base.getUTCDate() + ((d['Day Number'] || 1) - 1));
      dateRaw = base.toISOString().split('T')[0];
    }
    let dateLabel = '';
    if (dateRaw) {
      const dt = new Date(dateRaw + 'T00:00:00Z');
      dateLabel = WEEKDAYS[dt.getUTCDay()] + ', ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
    }
    const lodgingId  = d['Lodging ID'] || '';
    const lodgingRec = lodgingId && lodgingById[lodgingId] ? lodgingById[lodgingId] : null;
    const slots = [1, 2, 3, 4].map(n => {
      const raw = d['Slot ' + n];
      if (!raw) return null;
      try { return JSON.parse(raw); } catch(e) { return null; }
    }).filter(Boolean);

    let lodgingParagraph = '';
    let lodgingName = '';
    if (lodgingRec) {
      const lf = lodgingRec;
      lodgingName = lf['Name'] || '';
      if (!seenLodgingIds.has(lodgingId)) {
        seenLodgingIds.add(lodgingId);
        const nameType = [lf['Name'], lf['Type']].filter(Boolean).join(' — ');
        const location = lf['Location'] || '';
        const checkIn  = lf['Check-in Date']  || '';
        const checkOut = lf['Check-out Date'] || '';
        const parts = [`Check in to ${nameType}${location ? ' in ' + location : ''}${checkIn && checkOut ? ' (' + checkIn + ' to ' + checkOut + ')' : ''}.`];
        if (lf['Description']) parts.push(lf['Description']);
        if (lf['Amenities'])   parts.push('Amenities include: ' + lf['Amenities'] + '.');
        lodgingParagraph = parts.join(' ');
      }
    }

    return {
      dayNum:       d['Day Number'] || 0,
      date:         dateRaw,
      dateLabel,
      startLoc:     d['Starting Location'] || '',
      endLoc:       d['Ending Location']   || '',
      lodging:      lodgingParagraph,
      lodgingName,
      slotLabels:   slots.map(slotLabel).filter(Boolean),
      reservations: reservationsByDate[dateRaw] || []
    };
  });

  // If no scheduled days, generate synthetic days from date range so reservations can be shown
  if (structuredDays.length === 0 && startDate && endDate) {
    const base  = new Date(startDate + 'T00:00:00Z');
    const last  = new Date(endDate   + 'T00:00:00Z');
    const total = Math.round((last - base) / 86400000) + 1;
    for (let i = 0; i < total; i++) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i);
      const dateRaw  = d.toISOString().split('T')[0];
      const dateLabel = WEEKDAYS[d.getUTCDay()] + ', ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate();
      structuredDays.push({
        dayNum: i + 1, date: dateRaw, dateLabel,
        startLoc: '', endLoc: '', lodging: '', lodgingName: '',
        slotLabels: [], reservations: reservationsByDate[dateRaw] || []
      });
    }
  }

  // Format days for the prompt
  const dayScheduleText = structuredDays.map(d => {
    const loc = d.startLoc && d.endLoc && d.startLoc !== d.endLoc
      ? `${d.startLoc} → ${d.endLoc}`
      : (d.startLoc || d.endLoc || '');
    const lines = [`Day ${d.dayNum}${d.dateLabel ? ' — ' + d.dateLabel : ''}${loc ? ' (' + loc + ')' : ''}`];
    if (d.lodging) lines.push(`  Lodging: ${d.lodging}`);
    d.reservations.forEach(res => {
      const p = res.parsed;
      if (res.type === 'flight') {
        const route = [p.from_airport, p.to_airport].filter(Boolean).join(' → ');
        const time  = p.departure_time ? ' at ' + p.departure_time : '';
        lines.push(`  ✈ Flight: ${p.airline || ''} ${p.flight_number || ''} ${route}${time}`.trim());
      } else if (res.type === 'hotel') {
        lines.push(`  🏨 Hotel check-in: ${p.hotel_name || ''}${p.hotel_location ? ' in ' + p.hotel_location : ''}`);
      } else if (res.type === 'car_rental') {
        lines.push(`  🚗 Car rental pickup: ${p.rental_company || ''} ${p.car_type || ''} at ${p.pickup_location || ''}`.trim());
      }
    });
    if (d.slotLabels.length) {
      d.slotLabels.forEach(s => lines.push(`  • ${s}`));
    } else if (!d.reservations.length) {
      lines.push(`  (free day / no activities planned)`);
    }
    return lines.join('\n');
  }).join('\n\n');

  // Collect unique lodging properties for description generation
  const uniqueLodging = [];
  const seenLodgingNames = new Set();
  structuredDays.forEach(d => {
    if (d.lodgingName && !seenLodgingNames.has(d.lodgingName)) {
      seenLodgingNames.add(d.lodgingName);
      uniqueLodging.push(d);
    }
  });
  const lodgingPromptSection = uniqueLodging.length
    ? `\n\n## LODGING DESCRIPTIONS\nFor each property below, write 2–3 sentences evoking the atmosphere, setting, and experience of staying there. Write in second person. Format exactly like this:\n\n### ${uniqueLodging.map(d => d.lodgingName).join('\n[2–3 sentences]\n\n### ')}\n[2–3 sentences]`
    : '';

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

Continue for all ${structuredDays.length} days. Be specific and evocative.${lodgingPromptSection}`;

  const force = req.body?.force === true;

  // Serve from cache if available and not forcing regeneration
  if (!force && trip['Itinerary Cache']) {
    try {
      const cached = JSON.parse(trip['Itinerary Cache']);
      return res.status(200).json({
        tripName, destination: dest, startDate, endDate, archetype, passions,
        tripSummary:         cached.tripSummary        || '',
        days:                structuredDays,
        daySummaries:        cached.daySummaries       || {},
        lodgingDescriptions: cached.lodgingDescriptions || {},
        allReservations,
        fromCache:           true
      });
    } catch(e) {
      // Cache corrupt — fall through to regenerate
    }
  }

  try {
    const raw = await callClaude(prompt);

    // Parse trip summary
    const summaryMatch = raw.match(/##\s*TRIP SUMMARY\s*([\s\S]*?)(?=##\s*DAY SUMMARIES|$)/i);
    const tripSummary  = summaryMatch ? summaryMatch[1].trim() : '';

    // Parse day summaries
    const daySummaries = {};
    const daySectionMatch = raw.match(/##\s*DAY SUMMARIES\s*([\s\S]*?)(?=##\s*LODGING|$)/i);
    if (daySectionMatch) {
      for (const m of daySectionMatch[1].matchAll(/###\s*Day\s*(\d+)\s*\n([\s\S]*?)(?=###\s*Day\s*\d|$)/gi)) {
        daySummaries[parseInt(m[1])] = m[2].trim();
      }
    }

    // Parse lodging descriptions
    const lodgingDescriptions = {};
    const lodgingSectionMatch = raw.match(/##\s*LODGING DESCRIPTIONS\s*([\s\S]*?)$/i);
    if (lodgingSectionMatch) {
      for (const m of lodgingSectionMatch[1].matchAll(/###\s*(.+?)\s*\n([\s\S]*?)(?=###|$)/gi)) {
        lodgingDescriptions[m[1].trim()] = m[2].trim();
      }
    }

    // Save to cache (fire and forget — don't block the response)
    if (tripRecordId) {
      airtablePatch('Trips', tripRecordId, {
        'Itinerary Cache': JSON.stringify({ tripSummary, daySummaries, lodgingDescriptions })
      }).catch(e => console.error('[itinerary] cache save error:', e.message));
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
      daySummaries,
      lodgingDescriptions,
      allReservations
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
