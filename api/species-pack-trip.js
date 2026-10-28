// Returns the deduplicated set of species a traveler will encounter across
// ALL places on a specific trip. Used by trip.html's "Prepare for Offline"
// download button so we cache exactly the pack the traveler needs — no more,
// no less.
//
// Usage:  GET /api/species-pack-trip?tripId=recXXXXXX
//
// Response:
//   {
//     species: [ { id, name, scientificName, photoUrl, category, status, bestParks, ... }, ... ],
//     meta:    { tripId, placeCount, speciesCount, places: [names] }
//   }

const BASE_ID           = 'appdlxcWb45dIqNK2';
const TABLE_TRIPS       = 'Trips';
const TABLE_TRIP_PLACES = 'Trip Places';
const TABLE_TRIP_DAYS   = 'Trip Days';
const TABLE_SPECIES     = 'tblYtFaj6UYMUEwFQ';

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
    const qs = p.toString() ? '?' + p.toString() : '';
    const data = await airtable(table, qs);
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

const STATUS_ABBR = {
  'least concern':          'LC',
  'near threatened':        'NT',
  'vulnerable':             'VU',
  'endangered':             'EN',
  'critically endangered':  'CR',
};

// Normalize a park/place name for matching. Strips common suffixes so that
// "Murchison Falls NP", "Murchison Falls National Park", and "Murchison Falls"
// all collapse to the same core string.
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    // Strip trailing suffixes
    .replace(/\s+(national\s+park|nat[\.\s]*park|n\.?\s*p\.?|game\s+reserve|reserve|conservation\s+area|conservancy|sanctuary|park|forest)$/i, '')
    // Collapse whitespace, strip trailing punctuation
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
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
    // 1. Look up the trip record by Airtable record ID (what trip.html sends as tripId).
    //    Fall back to a Trip ID-field lookup in case some callers use that instead.
    let tripRec = null;
    if (/^rec[A-Za-z0-9]+$/.test(tripId)) {
      try {
        const direct = await airtable(TABLE_TRIPS, '/' + tripId);
        if (direct && direct.id && !direct.error) tripRec = direct;
      } catch(_) {}
    }
    if (!tripRec) {
      const tripFilter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}&maxRecords=1`;
      const tripData   = await airtable(TABLE_TRIPS, tripFilter);
      if (tripData.error) throw new Error(tripData.error.message);
      tripRec = (tripData.records || [])[0];
    }
    if (!tripRec) return res.status(404).json({ error: 'trip not found' });
    const tripRecordId = tripRec.id;

    const country     = (tripRec.fields.Country     || '').trim();
    const destination = (tripRec.fields.Destination || '').trim();

    // 2. Fetch stops for the trip. Two paths are possible depending on how the
    //    trip was set up:
    //      (a) "Trip Places" table — used by manual trip builds
    //      (b) "Trip Days"   table — used when Setup-from-Template generated the
    //          schedule with Starting Location / Ending Location per day
    //    We collect from both and union the results.
    const [placesRecs, daysRecs] = await Promise.all([
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
    ]);
    const namesFromPlaces = placesRecs.map(r => (r.fields.Place || '').trim()).filter(Boolean);
    const namesFromDays   = daysRecs.flatMap(r => [
      (r.fields['Starting Location'] || '').trim(),
      (r.fields['Ending Location']   || '').trim(),
    ]).filter(Boolean);
    const placeNames = Array.from(new Set([...namesFromPlaces, ...namesFromDays]));
    const placeSet   = new Set(placeNames.map(normalize));

    if (!placeSet.size) {
      return res.status(200).json({
        species: [],
        meta: { tripId, placeCount: 0, speciesCount: 0, places: [] },
      });
    }

    // 3. Fetch all species and filter by Best Parks match. We deliberately
    //    skip the Animal Regions pre-filter — many records don't have that
    //    field populated, and the Best Parks name match is authoritative.
    const rawSpecies = await fetchAll(TABLE_SPECIES, {
      'sort[0][field]':     'Species Name',
      'sort[0][direction]': 'asc',
    });

    // 4. Filter to species where Best Parks overlaps this trip's places.
    //    Uses word-subset matching (not raw substring) so "Queen Elizabeth" trip
    //    place doesn't fuzzy-match "Queen Charlotte" species park, and a species
    //    park with generic words like "Nile Lake" doesn't match a trip place
    //    that happens to share one of those words.
    //
    //    Match rule: one park's significant words (len >= 4) must be a SUBSET
    //    of the other's. So "Kibale" matches "Kibale Forest" (kibale ⊂ kibale
    //    forest), but "Queen Elizabeth" doesn't match "Queen Charlotte" (neither
    //    is a subset of the other).
    const bestParksOf = f => Array.isArray(f['Best Parks'])
      ? f['Best Parks']
      : (f['Best Parks'] || '').split(',').map(s => s.trim()).filter(Boolean);

    const significantWords = s =>
      String(s || '').split(/\s+/).filter(w => w.length >= 4);

    const isWordSubset = (smaller, larger) => {
      if (!smaller.length || !larger.length) return false;
      const largerSet = new Set(larger);
      return smaller.every(w => largerSet.has(w));
    };

    const placeWordSets = Array.from(placeSet).map(tp => significantWords(tp));

    const matched = rawSpecies.filter(r => {
      const parkWordSets = bestParksOf(r.fields)
        .map(p => significantWords(normalize(p)));
      return parkWordSets.some(pws =>
        placeWordSets.some(tpws =>
          isWordSubset(pws, tpws) || isWordSubset(tpws, pws)
        )
      );
    });

    // 5. Dedup by record id (already unique since we came from one Species table query,
    //    but a species could match by BOTH region prefilter AND parks — the .filter above
    //    still returns each record once). This is a defensive dedup.
    const seen  = new Set();
    const finalList = [];
    for (const r of matched) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const f = r.fields || {};
      let thumbUrl = f['Photo URL'] || '';
      if (thumbUrl.includes('cloudinary.com')) {
        thumbUrl = thumbUrl.replace('/image/upload/', '/image/upload/w_400,h_300,c_fill,q_auto,f_jpg/');
      }
      const rawStatus = normalize(f['Conservation Status']);
      finalList.push({
        id:                 r.id,
        name:               f['Species Name']     || '',
        scientificName:     f['Scientific Name']  || '',
        type:               f.Type                || '',
        category:           f.Category            || '',
        status:             STATUS_ABBR[rawStatus] || f['Conservation Status'] || '',
        conservationStatus: f['Conservation Status'] || '',
        description:        f.Description         || '',
        habitat:            f.Habitat             || '',
        bestParks:          bestParksOf(f),
        bestMonths:         Array.isArray(f['Best Months']) ? f['Best Months'] : (f['Best Months'] || '').split(',').map(s => s.trim()).filter(Boolean),
        photoUrl:           thumbUrl,
        photoPosition:      f['Photo Position']   || 'center center',
        ebirdCode:          f['eBird Code']       || '',
        inaturalistId:      f['iNaturalist ID']   || '',
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({
      species: finalList,
      meta: {
        tripId,
        placeCount:   placeNames.length,
        speciesCount: finalList.length,
        places:       placeNames,
      },
    });
  } catch(e) {
    console.error('[species-pack-trip] error:', e);
    return res.status(500).json({ error: e.message });
  }
};
