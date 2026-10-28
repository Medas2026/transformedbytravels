// Place Visits — read/write. Mirrors /api/sightings for the parks-visited log.
//
// Usage:
//   GET  /api/place-visits?tripId=recXXX         — visits for one trip
//   GET  /api/place-visits?travelerEmail=x@y.com — all-time visits for one traveler
//   POST /api/place-visits { placeName, travelerEmail, tripId, ... }

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Place Visits';

async function at(path, method = 'GET', body = null) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — list visits with optional filters ─────────────────────────────
  if (req.method === 'GET') {
    const { travelerEmail, tripId, placeName } = req.query;
    const filters = [];
    if (travelerEmail) filters.push(`{Traveler Email}="${travelerEmail.toLowerCase().trim()}"`);
    if (tripId)        filters.push(`{Trip ID}="${tripId}"`);
    if (placeName)     filters.push(`{Place Name}="${placeName.replace(/"/g,'\\"')}"`);
    const formula = filters.length > 1 ? `AND(${filters.join(',')})` : (filters[0] || '');
    const baseQs = (formula ? `?filterByFormula=${encodeURIComponent(formula)}&` : '?') +
                   'sort[0][field]=Visited Date&sort[0][direction]=desc';
    try {
      const records = [];
      let offset = '';
      do {
        const qs = baseQs + (offset ? '&offset=' + encodeURIComponent(offset) : '');
        const data = await at(qs);
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        records.push(...(data.records || []));
        offset = data.offset || '';
      } while (offset);
      return res.status(200).json({ records });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — log a visit ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = req.body || {};
    const placeName     = String(b.placeName || '').trim();
    const travelerEmail = String(b.travelerEmail || '').toLowerCase().trim();
    if (!placeName)     return res.status(400).json({ error: 'placeName is required' });
    if (!travelerEmail) return res.status(400).json({ error: 'travelerEmail is required' });

    const visitedDate = b.visitedDate ? new Date(b.visitedDate) : new Date();

    const fields = {
      'Place Name':      placeName,
      'Traveler Email':  travelerEmail,
      'Visited Date':    visitedDate.toISOString().slice(0, 19),
    };
    if (b.tripId)          fields['Trip ID']         = b.tripId;
    if (b.country)         fields['Country']         = b.country;
    if (b.tripDayNumber != null) fields['Trip Day Number'] = Number(b.tripDayNumber);
    if (b.coachNotes)      fields['Coach Notes']     = b.coachNotes;
    if (b.photoUrl)        fields['Entry URL']       = b.photoUrl;
    if (b.lat != null)     fields['Latitude']        = Number(b.lat);
    if (b.lon != null)     fields['Longitude']       = Number(b.lon);
    if (b.gpsAccuracy)     fields['GPS Accuracy']    = Number(b.gpsAccuracy);

    try {
      const rec = await at('', 'POST', { fields });
      if (rec.error) return res.status(500).json({ error: rec.error.message || JSON.stringify(rec.error) });
      return res.status(200).json({ ok: true, id: rec.id, fields: rec.fields });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH — update a visit (used to add photo after the fact) ──────────
  if (req.method === 'PATCH') {
    const id = (req.query && req.query.id) || (req.body && req.body.id) || '';
    if (!id) return res.status(400).json({ error: 'id required' });
    const b = req.body || {};
    const fields = {};
    if (b.photoUrl !== undefined) fields['Entry URL']   = b.photoUrl;
    if (b.coachNotes !== undefined) fields['Coach Notes'] = b.coachNotes;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'no updatable fields provided' });
    try {
      const rec = await at('/' + id, 'PATCH', { fields });
      if (rec.error) return res.status(500).json({ error: rec.error.message || JSON.stringify(rec.error) });
      return res.status(200).json({ ok: true, id: rec.id, fields: rec.fields });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE — remove a visit (used for un-toggling) ──────────────────────
  if (req.method === 'DELETE') {
    const id = (req.query && req.query.id) || '';
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const del = await at('/' + id, 'DELETE');
      if (del.error) return res.status(500).json({ error: del.error.message || JSON.stringify(del.error) });
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
