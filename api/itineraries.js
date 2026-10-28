const BASE_ID           = 'appdlxcWb45dIqNK2';
const TABLE_ITINS       = 'Itineraries';
const TABLE_PLACES      = 'Places';
const TABLE_JUNCTION    = 'Itinerary Places';
const TABLE_ACTIVITIES  = 'Activities';

async function airtableGet(table, path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

async function fetchAll(table, extraParams) {
  const records = [];
  let offset = '';
  do {
    const params = new URLSearchParams(extraParams || {});
    if (offset) params.set('offset', offset);
    const qs   = params.toString() ? '?' + params.toString() : '';
    const data = await airtableGet(table, qs);
    if (data.error) throw new Error(data.error.message || data.error);
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

// Draft / Published, mirroring the Status field the Blog Posts table already uses.
// A blank Status counts as published, so existing itineraries need no editing.
const isDraft = f => String(f['Status'] || '').trim().toLowerCase() === 'draft';

function shapeItinerary(r) {
  const f = r.fields || {};
  return {
    id:                 r.id,
    draft:              isDraft(f),
    name:               f['Itineraries']         || '',
    continent:          f['Continent']           || '',
    countryOfOrigin:    f['Country of Origin']   || '',
    countryOfDeparture: f['Country of Departure']|| '',
    description:        f['Description']         || '',
    minimumDays:        f['Minimum Days']        || null,
    budgetPrice:        f['Budget Price']        || null,
    luxuryPrice:        f['Luxury Price']        || null,
    heroPhoto:          f['Hero Photo']          || '',
    bestMonths:         Array.isArray(f['Best Months'])  ? f['Best Months']  : [],
    peakMonths:         Array.isArray(f['Peak Months'])  ? f['Peak Months']  : [],
    avoidMonths:        Array.isArray(f['Avoid Months']) ? f['Avoid Months'] : [],
    seasonalityNotes:   f['Seasonality Notes']   || '',
  };
}

function shapePlace(r) {
  const f = r.fields || {};
  return {
    id:                r.id,
    stopName:          f['Stop Name']           || '',
    continent:         f['Continent']           || '',
    country:           f['Country']             || '',
    region:            f['Region']              || '',
    description:       f['Description']         || '',
    whyStopHere:       f['Why Stop Here']       || '',
    suggestedTimeHere: f['Suggested Time Here'] || '',
    insiderTip:        f['Insider Tip']         || '',
    wildlifeNotes:     f['Wildlife Notes']      || '',
    totalPriorityTime: f['Total Priority Time'] ?? null,
    heroPhoto:         f['Hero Photo']          || '',
    luxuryLodge:       f['Luxury Lodge']        || '',
    luxuryDescription: f['Luxury Description']  || '',
    valueLodge:        f['Value Lodge']         || '',
    valueDescription:  f['Value Description']   || '',
    latitude:          f['Latitude']            ?? null,
    longitude:         f['Longitude']           ?? null,
    hideAnimals:       f['Hide Animals'] === true,
    coachVisited:      f['Coach Visited'] === true,
    coachVisitNote:    f['Coach Visit Note']    || '',
  };
}

function shapeJunction(r) {
  const f = r.fields || {};
  return {
    id:            r.id,
    itineraryIds:  Array.isArray(f['Itinerary']) ? f['Itinerary'] : [],
    placeIds:      Array.isArray(f['Place'])     ? f['Place']     : [],
    stopOrder:     f['Stop Order'] ?? null,
    nights:        f['Nights']     ?? null,
    notes:         f['Notes']      || '',
  };
}

function shapeActivity(r) {
  const f = r.fields || {};
  return {
    id:            r.id,
    name:          f['Activity Name']  || '',
    priority:      f['Priority']       ?? null,
    durationHours: f['Duration Hours'] ?? null,
    description:   f['Description']    || '',
    bestTime:      f['Best Time']      || '',
    category:      f['Category']       || '',
    photoUrl:      f['Photo URL']      || '',
    placeIds:      Array.isArray(f['Place']) ? f['Place'] : [],
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { name } = req.query;
  // ?preview=1 reveals drafts — used by the author to review before publishing.
  const preview = ['1', 'true', 'yes'].includes(String(req.query.preview || '').toLowerCase());

  try {
    // ── Detail view ──
    if (name) {
      const escName  = String(name).replace(/"/g, '\\"');
      const itinRecs = await fetchAll(TABLE_ITINS, {
        filterByFormula: `LOWER({Itineraries}) = LOWER("${escName}")`,
        maxRecords:      '1',
      });
      if (!itinRecs.length) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).json({ itinerary: null });
      }
      const itinRec     = itinRecs[0];
      // A draft is invisible without ?preview=1 — same answer as one that isn't there.
      if (isDraft(itinRec.fields || {}) && !preview) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).json({ itinerary: null });
      }
      const itinerary   = shapeItinerary(itinRec);
      const itineraryId = itinRec.id;

      // Fetch junction rows for this itinerary, resolve to Places
      const [junctionRecs, placeRecs] = await Promise.all([
        fetchAll(TABLE_JUNCTION, {}),
        fetchAll(TABLE_PLACES,   {}),
      ]);

      const placeById = new Map();
      placeRecs.forEach(r => placeById.set(r.id, shapePlace(r)));

      const junctions = junctionRecs.map(shapeJunction)
        .filter(j => j.itineraryIds.includes(itineraryId));

      const stops = junctions
        .map(j => {
          const placeId = j.placeIds[0];
          if (!placeId) return null;
          const place = placeById.get(placeId);
          if (!place) return null;
          return {
            ...place,
            stopNumber: j.stopOrder,
            nights:     j.nights,
            notes:      j.notes,
            junctionId: j.id,
            activities: [],
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const an = a.stopNumber == null ? Infinity : Number(a.stopNumber);
          const bn = b.stopNumber == null ? Infinity : Number(b.stopNumber);
          if (an !== bn) return an - bn;
          return a.stopName.localeCompare(b.stopName);
        });

      // Fetch activities linked to any of these places
      const placeIdSet = new Set(stops.map(s => s.id));
      if (placeIdSet.size) {
        try {
          const actRecs = await fetchAll(TABLE_ACTIVITIES, {});
          const activities = actRecs.map(shapeActivity);
          const activitiesByPlace = new Map();
          activities.forEach(a => {
            a.placeIds.forEach(pid => {
              if (!placeIdSet.has(pid)) return;
              if (!activitiesByPlace.has(pid)) activitiesByPlace.set(pid, []);
              activitiesByPlace.get(pid).push(a);
            });
          });
          stops.forEach(s => {
            const list = (activitiesByPlace.get(s.id) || []).slice()
              .sort((a, b) => {
                const ap = a.priority == null ? Infinity : Number(a.priority);
                const bp = b.priority == null ? Infinity : Number(b.priority);
                return ap - bp;
              });
            s.activities = list;
          });
        } catch(e) {
          console.log('activities fetch error:', e.message);
        }
      }

      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json({ itinerary: { ...itinerary, stops } });
    }

    // ── List view ──
    const recs = await fetchAll(TABLE_ITINS, {
      'sort[0][field]':     'Continent',
      'sort[0][direction]': 'asc',
      'sort[1][field]':     'Itineraries',
      'sort[1][direction]': 'asc',
    });
    const itineraries = recs.map(shapeItinerary)
      .filter(i => i.name)
      .filter(i => preview || !i.draft);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ itineraries });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
