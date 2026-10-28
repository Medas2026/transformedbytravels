// Itinerary Builder API
// - GET  ?action=places-list        → all Places for the type-ahead picker
// - POST                            → create Itinerary + new Places + junctions
// - PATCH ?id=recXXXX               → update in place: patch metadata,
//                                     reconcile junctions (add/update/delete),
//                                     create new Places as needed
//
// Body for POST / PATCH:
// {
//   itinerary: {
//     name, continent, countryOfOrigin, countryOfDeparture, description,
//     minimumDays, budgetPrice, luxuryPrice, heroPhoto,
//     bestMonths[], peakMonths[], avoidMonths[], seasonalityNotes
//   },
//   stops: [
//     { placeId?, newPlace? {stopName, country, continent, region, heroPhoto},
//       stopOrder, nights, notes, junctionId? }
//   ]
// }

const https = require('https');

const BASE_ID           = 'appdlxcWb45dIqNK2';
const TABLE_ITINS       = 'Itineraries';
const TABLE_PLACES      = 'Places';
const TABLE_JUNCTION    = 'Itinerary Places';

function airtable(table, method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path || ''}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + process.env.AIRTABLE_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }); }
        catch(e) { reject(new Error('parse: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function fetchAllPages(table, extraParams) {
  const records = [];
  let offset = '';
  do {
    const params = new URLSearchParams(extraParams || {});
    if (offset) params.set('offset', offset);
    const qs   = params.toString() ? '?' + params.toString() : '';
    const resp = await airtable(table, 'GET', qs);
    if (resp.body.error) throw new Error(resp.body.error.message || JSON.stringify(resp.body.error));
    records.push(...(resp.body.records || []));
    offset = resp.body.offset || '';
  } while (offset);
  return records;
}

// Build the Airtable fields object for an Itinerary from the client payload.
function buildItineraryFields(it) {
  const f = {};
  if (it.name              != null) f['Itineraries']          = it.name;
  if (it.continent         != null) f['Continent']            = it.continent;
  if (it.countryOfOrigin   != null) f['Country of Origin']    = it.countryOfOrigin;
  if (it.countryOfDeparture!= null) f['Country of Departure'] = it.countryOfDeparture;
  if (it.description       != null) f['Description']          = it.description;
  if (it.minimumDays       != null && it.minimumDays !== '') f['Minimum Days']  = Number(it.minimumDays);
  if (it.budgetPrice       != null && it.budgetPrice !== '') f['Budget Price']  = Number(it.budgetPrice);
  if (it.luxuryPrice       != null && it.luxuryPrice !== '') f['Luxury Price']  = Number(it.luxuryPrice);
  if (it.heroPhoto         != null) f['Hero Photo']           = it.heroPhoto;
  if (Array.isArray(it.bestMonths))  f['Best Months']  = it.bestMonths;
  if (Array.isArray(it.peakMonths))  f['Peak Months']  = it.peakMonths;
  if (Array.isArray(it.avoidMonths)) f['Avoid Months'] = it.avoidMonths;
  if (it.seasonalityNotes  != null) f['Seasonality Notes']    = it.seasonalityNotes;
  return f;
}

function buildPlaceFields(p) {
  const f = {};
  if (p.stopName  != null) f['Stop Name'] = p.stopName;
  // 'Place Name' is the Places table's PRIMARY field — it's what shows in the
  // Place link on Itinerary Places, so it must be set or the link looks empty.
  if (p.stopName  != null) f['Place Name'] = p.stopName;
  if (p.continent != null) f['Continent'] = p.continent;
  if (p.country   != null) f['Country']   = p.country;
  if (p.region    != null) f['Region']    = p.region;
  if (p.heroPhoto != null) f['Hero Photo']= p.heroPhoto;
  return f;
}

function buildJunctionFields({ itineraryId, placeId, stopOrder, nights, notes }) {
  const f = {
    'Itinerary': [itineraryId],
    'Place':     [placeId],
  };
  if (stopOrder != null && stopOrder !== '') f['Stop Order'] = Number(stopOrder);
  if (nights    != null && nights    !== '') f['Nights']     = Number(nights);
  if (notes     != null)                     f['Notes']      = notes;
  return f;
}

async function createPlace(place) {
  const resp = await airtable(TABLE_PLACES, 'POST', '', {
    fields:   buildPlaceFields(place),
    typecast: true,
  });
  if (resp.body.error) throw new Error('Create Place: ' + (resp.body.error.message || JSON.stringify(resp.body.error)));
  return resp.body.id;
}

async function createItinerary(itinerary) {
  const resp = await airtable(TABLE_ITINS, 'POST', '', {
    fields:   buildItineraryFields(itinerary),
    typecast: true,
  });
  if (resp.body.error) throw new Error('Create Itinerary: ' + (resp.body.error.message || JSON.stringify(resp.body.error)));
  return resp.body.id;
}

async function patchItinerary(id, itinerary) {
  const resp = await airtable(TABLE_ITINS, 'PATCH', '/' + id, {
    fields:   buildItineraryFields(itinerary),
    typecast: true,
  });
  if (resp.body.error) throw new Error('Patch Itinerary: ' + (resp.body.error.message || JSON.stringify(resp.body.error)));
  return resp.body;
}

async function createJunction(fields) {
  const resp = await airtable(TABLE_JUNCTION, 'POST', '', { fields, typecast: true });
  if (resp.body.error) throw new Error('Create Junction: ' + (resp.body.error.message || JSON.stringify(resp.body.error)));
  return resp.body.id;
}

async function patchJunction(id, fields) {
  const resp = await airtable(TABLE_JUNCTION, 'PATCH', '/' + id, { fields, typecast: true });
  if (resp.body.error) throw new Error('Patch Junction: ' + (resp.body.error.message || JSON.stringify(resp.body.error)));
  return resp.body;
}

async function deleteJunction(id) {
  const resp = await airtable(TABLE_JUNCTION, 'DELETE', '/' + id);
  if (resp.body.error) throw new Error('Delete Junction: ' + (resp.body.error.message || JSON.stringify(resp.body.error)));
  return true;
}

// Ensure each stop has a placeId — creating any newPlace records first.
async function patchPlaceRegion(placeId, region) {
  const resp = await airtable(TABLE_PLACES, 'PATCH', '/' + placeId, {
    fields:   { 'Region': region },
    typecast: true,
  });
  if (resp.body.error) throw new Error('Patch Place region: ' + (resp.body.error.message || JSON.stringify(resp.body.error)));
}

// Normalize a name/country for duplicate matching: trim, lowercase, collapse spaces.
function normPlaceKey(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Dedup-on-save: find an existing Place with the same name (+ country when the new
// stop specifies one) so the builder reuses it instead of creating a duplicate.
// Matches on Stop Name or Place Name. Returns the record, or null.
function findExistingPlace(newPlace, recs) {
  const name = normPlaceKey(newPlace.stopName);
  if (!name) return null;
  const country = normPlaceKey(newPlace.country);
  for (const r of recs) {
    const f  = r.fields || {};
    const rn = normPlaceKey(f['Stop Name']) || normPlaceKey(f['Place Name']);
    if (rn !== name) continue;
    // If the new stop names a country, require it to match; otherwise match on name alone.
    const rc = normPlaceKey(f['Country']);
    if (country && rc && country !== rc) continue;
    return r;
  }
  return null;
}

async function resolveStopPlaces(stops) {
  let placesCache = null;   // fetched lazily, only when a stop needs a new place
  for (const s of stops) {
    if (s.placeId) {
      // Existing place — keep its Region in sync with the builder's dropdown,
      // so the "Wildlife you might see" section shows on the public page.
      if (s.region != null && s.region !== '') {
        await patchPlaceRegion(s.placeId, s.region);
      }
      continue;
    }
    if (s.newPlace && s.newPlace.stopName) {
      if (!placesCache) placesCache = await fetchAllPages(TABLE_PLACES, {});
      // Reuse an existing Place with the same name (+country) rather than duplicating it.
      const existing = findExistingPlace(s.newPlace, placesCache);
      if (existing) {
        s.placeId = existing.id;
        // Backfill Region only if the reused place has none — don't clobber curated data.
        const curRegion = existing.fields && existing.fields['Region'];
        if (s.newPlace.region && !curRegion) await patchPlaceRegion(existing.id, s.newPlace.region);
      } else {
        s.placeId = await createPlace(s.newPlace);
        // Add to the cache so two identical new stops in the same save don't both create.
        placesCache.push({ id: s.placeId, fields: {
          'Stop Name':  s.newPlace.stopName,
          'Place Name': s.newPlace.stopName,
          'Country':    s.newPlace.country || '',
          'Region':     s.newPlace.region  || '',
        }});
      }
    } else {
      throw new Error('Stop is missing placeId and newPlace');
    }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: places-list for type-ahead ──
    if (req.method === 'GET' && req.query.action === 'places-list') {
      const recs = await fetchAllPages(TABLE_PLACES, {
        'fields[]':          ['Stop Name', 'Country', 'Continent', 'Region'],
        'sort[0][field]':     'Stop Name',
        'sort[0][direction]': 'asc',
      });
      const places = recs.map(r => ({
        id:        r.id,
        stopName:  r.fields['Stop Name'] || '',
        country:   r.fields['Country']   || '',
        continent: r.fields['Continent'] || '',
        region:    r.fields['Region']    || '',
      })).filter(p => p.stopName);
      return res.status(200).json({ places });
    }

    // ── POST: create a new Itinerary + stops ──
    if (req.method === 'POST') {
      const { itinerary, stops = [] } = req.body || {};
      if (!itinerary || !itinerary.name) return res.status(400).json({ error: 'itinerary.name required' });

      await resolveStopPlaces(stops);
      const itinId = await createItinerary(itinerary);

      const created = [];
      for (const s of stops) {
        const jid = await createJunction(buildJunctionFields({
          itineraryId: itinId,
          placeId:     s.placeId,
          stopOrder:   s.stopOrder,
          nights:      s.nights,
          notes:       s.notes,
        }));
        created.push({ junctionId: jid, placeId: s.placeId });
      }

      return res.status(200).json({ ok: true, itineraryId: itinId, stops: created });
    }

    // ── PATCH: update in place ──
    if (req.method === 'PATCH') {
      const itinId = (req.query.id || '').trim();
      if (!itinId) return res.status(400).json({ error: 'query id required' });
      const { itinerary, stops = [] } = req.body || {};
      if (!itinerary) return res.status(400).json({ error: 'itinerary required' });

      // 1. Patch itinerary metadata
      await patchItinerary(itinId, itinerary);

      // 2. Load existing junctions for this itinerary
      const allJunctions = await fetchAllPages(TABLE_JUNCTION, {});
      const existingForThis = allJunctions.filter(r =>
        Array.isArray(r.fields['Itinerary']) && r.fields['Itinerary'].includes(itinId)
      );
      const existingById = new Map(existingForThis.map(r => [r.id, r]));

      // 3. Ensure all stops have a placeId (create newPlace if needed)
      await resolveStopPlaces(stops);

      // 4. Diff & apply
      const submittedIds = new Set(stops.filter(s => s.junctionId).map(s => s.junctionId));

      // Delete junctions that were removed
      const toDelete = existingForThis.filter(r => !submittedIds.has(r.id));
      for (const r of toDelete) await deleteJunction(r.id);

      // Update or create each stop
      const results = [];
      for (const s of stops) {
        const fields = buildJunctionFields({
          itineraryId: itinId,
          placeId:     s.placeId,
          stopOrder:   s.stopOrder,
          nights:      s.nights,
          notes:       s.notes,
        });
        if (s.junctionId && existingById.has(s.junctionId)) {
          await patchJunction(s.junctionId, fields);
          results.push({ junctionId: s.junctionId, placeId: s.placeId, action: 'updated' });
        } else {
          const jid = await createJunction(fields);
          results.push({ junctionId: jid, placeId: s.placeId, action: 'created' });
        }
      }

      return res.status(200).json({ ok: true, itineraryId: itinId, deleted: toDelete.length, stops: results });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch(e) {
    console.error('[itinerary-builder]', e);
    return res.status(500).json({ error: e.message });
  }
};
