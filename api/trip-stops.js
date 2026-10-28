// Returns the ordered list of stops for a specific trip, each merged with the
// rich Places table record (hero photo, description, insider tip, etc.).
//
// Usage:  GET /api/trip-stops?tripId=recXXXXXX
//
// Response:
//   {
//     stops: [
//       {
//         placeName, country, dayNumber,
//         // ...merged from Places table:
//         id, description, whyStopHere, insiderTip, suggestedTimeHere,
//         heroPhoto, latitude, longitude, coachVisited, coachVisitNote,
//         region,
//       },
//       ...
//     ]
//   }

const BASE_ID              = 'appdlxcWb45dIqNK2';
const TABLE_TRIPS          = 'Trips';
const TABLE_TRIP_PLACES    = 'Trip Places';
const TABLE_TRIP_DAYS      = 'Trip Days';
const TABLE_PLACES         = 'Places';
const TABLE_ITIN_JUNCTIONS = 'Itinerary Places';

async function airtable(table, path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

async function fetchAll(table, params) {
  const records = [];
  let offset = '';
  do {
    const p = new URLSearchParams(params || {});
    if (offset) p.set('offset', offset);
    const qs   = p.toString() ? '?' + p.toString() : '';
    const data = await airtable(table, qs);
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+(national\s+park|nat[\.\s]*park|n\.?\s*p\.?|game\s+reserve|reserve|conservation\s+area|conservancy|sanctuary|park|forest)$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
}

function shapePlace(r) {
  const f = r.fields || {};
  return {
    id:                r.id,
    stopName:          f['Stop Name']           || '',
    country:           f['Country']             || '',
    region:            f['Region']              || '',
    description:       f['Description']         || '',
    whyStopHere:       f['Why Stop Here']       || '',
    insiderTip:        f['Insider Tip']         || '',
    wildlifeNotes:     f['Wildlife Notes']      || '',
    suggestedTimeHere: f['Suggested Time Here'] || '',
    heroPhoto:         f['Hero Photo']          || '',
    latitude:          f['Latitude']            ?? null,
    longitude:         f['Longitude']           ?? null,
    coachVisited:      f['Coach Visited'] === true,
    coachVisitNote:    f['Coach Visit Note']    || '',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const tripId = (req.query && req.query.tripId) || '';
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  try {
    // Look up the trip by Airtable record ID (fallback to Trip ID formula field)
    let tripRec = null;
    if (/^rec[A-Za-z0-9]+$/.test(tripId)) {
      try {
        const direct = await airtable(TABLE_TRIPS, '/' + tripId);
        if (direct && direct.id && !direct.error) tripRec = direct;
      } catch(_) {}
    }
    if (!tripRec) {
      const filter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}&maxRecords=1`;
      const data   = await airtable(TABLE_TRIPS, filter);
      tripRec = (data.records || [])[0];
    }
    if (!tripRec) return res.status(404).json({ error: 'trip not found' });
    const tripRecordId = tripRec.id;

    // Walk Trip Days (schedule from template) and Trip Places (manual entries)
    // to get all unique stop names + their day number.
    const basedOn     = tripRec.fields['Based on Itinerary'];
    const itineraryId = Array.isArray(basedOn) ? basedOn[0] : (basedOn || '');

    const [placesRecs, daysRecs, allPlaces, junctionRecs] = await Promise.all([
      fetchAll(TABLE_TRIP_PLACES, {
        filterByFormula: `({Trip ID}="${tripRecordId}")`,
        'sort[0][field]': 'Day',
        'sort[0][direction]': 'asc',
      }).catch(() => []),
      fetchAll(TABLE_TRIP_DAYS, {
        filterByFormula: `({Trip ID}="${tripRecordId}")`,
        'sort[0][field]': 'Day Number',
        'sort[0][direction]': 'asc',
      }).catch(() => []),
      fetchAll(TABLE_PLACES, {}).catch(() => []),
      itineraryId ? fetchAll(TABLE_ITIN_JUNCTIONS, {}).catch(() => []) : Promise.resolve([]),
    ]);

    // Build a preferred-Places set for this itinerary (rec IDs of Places linked
    // via junction). We check this set FIRST during fuzzy matching so a trip
    // built from an itinerary picks up the exact Places records that itinerary
    // was authored with — not a duplicate-named record.
    const preferredPlaceIds = new Set();
    if (itineraryId) {
      junctionRecs.forEach(r => {
        const f = r.fields || {};
        const itIds = Array.isArray(f['Itinerary']) ? f['Itinerary'] : [];
        const plIds = Array.isArray(f['Place'])     ? f['Place']     : [];
        if (itIds.includes(itineraryId)) plIds.forEach(id => preferredPlaceIds.add(id));
      });
    }

    // Build ordered {name, dayNumber} pairs, deduplicated by name (first day wins).
    const seen = new Map(); // normalized-name -> {name, day, country}
    placesRecs.forEach(r => {
      const name = (r.fields.Place || '').trim();
      if (!name) return;
      const key = normalize(name);
      if (!seen.has(key)) {
        seen.set(key, {
          placeName: name,
          country:   (r.fields.Country || '').trim(),
          dayNumber: r.fields.Day || null,
        });
      }
    });
    daysRecs.forEach(r => {
      ['Starting Location', 'Ending Location'].forEach(field => {
        const name = (r.fields[field] || '').trim();
        if (!name) return;
        const key = normalize(name);
        if (!seen.has(key)) {
          seen.set(key, {
            placeName: name,
            country:   '', // may be filled in from Places match below
            dayNumber: r.fields['Day Number'] || null,
          });
        }
      });
    });

    if (!seen.size) {
      return res.status(200).json({ stops: [] });
    }

    // Match each trip stop to a rich Places record by normalized-name substring.
    // Prefer records linked to this trip's itinerary template (deterministic)
    // over duplicate-named records elsewhere in the Places table.
    const shaped = allPlaces.map(shapePlace).filter(p => p.stopName);
    const stops = Array.from(seen.values()).map(entry => {
      const key = normalize(entry.placeName);
      const nameMatches = shaped.filter(p => {
        const pn = normalize(p.stopName);
        return pn === key || pn.includes(key) || key.includes(pn);
      });
      // Prefer preferred (itinerary-linked) if there's overlap, else first name match
      const preferredMatch = nameMatches.find(p => preferredPlaceIds.has(p.id));
      const match = preferredMatch || nameMatches[0];
      if (!match) {
        return {
          placeName: entry.placeName,
          country:   entry.country,
          dayNumber: entry.dayNumber,
          matched:   false,
        };
      }
      return {
        placeName: entry.placeName,
        country:   entry.country || match.country,
        dayNumber: entry.dayNumber,
        matched:   true,
        // Rich data
        placeId:           match.id,
        region:            match.region,
        description:       match.description,
        whyStopHere:       match.whyStopHere,
        insiderTip:        match.insiderTip,
        wildlifeNotes:     match.wildlifeNotes,
        suggestedTimeHere: match.suggestedTimeHere,
        heroPhoto:         match.heroPhoto,
        latitude:          match.latitude,
        longitude:         match.longitude,
        coachVisited:      match.coachVisited,
        coachVisitNote:    match.coachVisitNote,
      };
    }).sort((a, b) => {
      const an = a.dayNumber == null ? Infinity : Number(a.dayNumber);
      const bn = b.dayNumber == null ? Infinity : Number(b.dayNumber);
      return an - bn;
    });

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ stops });
  } catch(e) {
    console.error('[trip-stops] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
