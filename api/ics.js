const BASE_ID = 'appdlxcWb45dIqNK2';

async function airtableFetch(table, params) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${params || ''}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

function icsDate(dateStr) {
  return dateStr.replace(/-/g, '');
}

function icsDateTime(dateStr, timeStr) {
  const base = dateStr.replace(/-/g, '');
  if (!timeStr) return base;
  const t = timeStr.replace(':', '') + '00';
  return base + 'T' + t;
}

function icsEscape(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldLine(line) {
  const out = [];
  while (line.length > 75) {
    out.push(line.slice(0, 75));
    line = ' ' + line.slice(75);
  }
  out.push(line);
  return out.join('\r\n');
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tripId = (req.query.tripId || '').trim();
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  try {
    const [tripData, daysData, lodgingData, reservationsData] = await Promise.all([
      airtableFetch('Trips', `/${tripId}`),
      airtableFetch('Trip Days',
        '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`) +
        '&sort[0][field]=Day%20Number&sort[0][direction]=asc'),
      airtableFetch('Lodging',
        '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`) +
        '&sort[0][field]=Check-in%20Date&sort[0][direction]=asc'),
      airtableFetch('Reservations',
        '?filterByFormula=' + encodeURIComponent(`({Trip ID}="${tripId}")`) +
        '&sort[0][field]=Key%20Date&sort[0][direction]=asc').catch(() => ({ records: [] }))
    ]);

    const trip  = tripData.fields || {};
    const days  = (daysData.records || []).map(r => ({ _id: r.id, ...r.fields }));
    const lodging = lodgingData.records || [];
    const reservations = reservationsData.records || [];

    const tripName  = trip['Trip Name'] || trip['Destination'] || 'My Trip';
    const startDate = trip['Start Date'] || '';
    const endDate   = trip['End Date']   || '';

    const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const events = [];
    const uid    = () => `${Date.now()}-${Math.random().toString(36).slice(2)}@transformedbytravels.com`;

    // All-day trip span event
    if (startDate && endDate) {
      const endPlus1 = new Date(endDate + 'T00:00:00Z');
      endPlus1.setUTCDate(endPlus1.getUTCDate() + 1);
      const endPlus1Str = endPlus1.toISOString().split('T')[0];
      events.push([
        'BEGIN:VEVENT',
        `UID:trip-${tripId}@transformedbytravels.com`,
        `DTSTART;VALUE=DATE:${icsDate(startDate)}`,
        `DTEND;VALUE=DATE:${icsDate(endPlus1Str)}`,
        `SUMMARY:✈ ${icsEscape(tripName)}`,
        'END:VEVENT'
      ].join('\r\n'));
    }

    // One event per trip day
    days.forEach(d => {
      const dateRaw = d['Date'] || '';
      if (!dateRaw) return;
      const dt = new Date(dateRaw + 'T00:00:00Z');
      const dateLabel = WEEKDAYS[dt.getUTCDay()] + ', ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
      const slots = [1,2,3,4].map(n => {
        try { return d['Slot ' + n] ? JSON.parse(d['Slot ' + n]) : null; } catch(e) { return null; }
      }).filter(Boolean);
      const labels = slots.map(slotLabel).filter(Boolean);

      const datePlus1 = new Date(dateRaw + 'T00:00:00Z');
      datePlus1.setUTCDate(datePlus1.getUTCDate() + 1);
      const datePlus1Str = datePlus1.toISOString().split('T')[0];

      const loc = d['Starting Location'] && d['Ending Location'] && d['Starting Location'] !== d['Ending Location']
        ? `${d['Starting Location']} → ${d['Ending Location']}`
        : (d['Starting Location'] || d['Ending Location'] || '');

      const summary = `Day ${d['Day Number']}${loc ? ' — ' + loc : ''} (${dateLabel})`;
      const desc    = labels.length ? labels.join('\\n') : 'Free day';

      events.push([
        'BEGIN:VEVENT',
        `UID:day-${tripId}-${d['Day Number']}@transformedbytravels.com`,
        `DTSTART;VALUE=DATE:${icsDate(dateRaw)}`,
        `DTEND;VALUE=DATE:${icsDate(datePlus1Str)}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(desc)}`,
        'END:VEVENT'
      ].join('\r\n'));
    });

    // Lodging check-in events
    lodging.forEach(r => {
      const f = r.fields;
      if (!f['Check-in Date']) return;
      const checkIn  = f['Check-in Date'];
      const checkOut = f['Check-out Date'] || checkIn;
      const name     = f['Name'] || 'Hotel';
      const loc      = f['Location'] || '';
      events.push([
        'BEGIN:VEVENT',
        `UID:lodging-${r.id}@transformedbytravels.com`,
        `DTSTART;VALUE=DATE:${icsDate(checkIn)}`,
        `DTEND;VALUE=DATE:${icsDate(checkOut)}`,
        `SUMMARY:🏨 ${icsEscape(name)}${loc ? ' — ' + icsEscape(loc) : ''}`,
        `DESCRIPTION:Check in: ${icsEscape(checkIn)}\\nCheck out: ${icsEscape(checkOut)}`,
        'END:VEVENT'
      ].join('\r\n'));
    });

    // Flight events from reservations
    reservations.forEach(r => {
      const f = r.fields;
      if (f['Type'] !== 'flight') return;
      let parsed = {};
      try { parsed = JSON.parse(f['Parsed Data'] || '{}'); } catch(e) {}
      if (!parsed.departure_date) return;

      const summary = [
        '✈',
        parsed.airline || '',
        parsed.flight_number || '',
        parsed.from_airport && parsed.to_airport ? parsed.from_airport + ' → ' + parsed.to_airport : ''
      ].filter(Boolean).join(' ');

      const dtStart = icsDateTime(parsed.departure_date, parsed.departure_time);
      const dtEnd   = parsed.arrival_date
        ? icsDateTime(parsed.arrival_date, parsed.arrival_time)
        : dtStart;

      const isAllDay = !parsed.departure_time;
      const startProp = isAllDay ? `DTSTART;VALUE=DATE:${dtStart}` : `DTSTART:${dtStart}`;
      const endProp   = isAllDay
        ? `DTEND;VALUE=DATE:${icsDate(parsed.arrival_date || parsed.departure_date)}`
        : `DTEND:${dtEnd}`;

      const desc = [
        parsed.confirmation_number ? 'Confirmation: ' + parsed.confirmation_number : null,
        parsed.passenger_name ? 'Passenger: ' + parsed.passenger_name : null
      ].filter(Boolean).join('\\n');

      events.push([
        'BEGIN:VEVENT',
        `UID:res-${r.id}@transformedbytravels.com`,
        startProp,
        endProp,
        `SUMMARY:${icsEscape(summary)}`,
        desc ? `DESCRIPTION:${icsEscape(desc)}` : null,
        'END:VEVENT'
      ].filter(Boolean).join('\r\n'));
    });

    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Transformed by Travels//MyJourneys//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(tripName)}`,
      ...events,
      'END:VCALENDAR'
    ];

    const icsContent = icsLines.map(foldLine).join('\r\n');
    const filename   = (tripName.replace(/[^a-z0-9]/gi, '-').toLowerCase() || 'trip') + '.ics';

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(icsContent);

  } catch(e) {
    console.error('[ics]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
