const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'tblWOeO374dxfCgdC';

async function at(path, method = 'GET', body = null) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — list sightings with optional filters ────────────────────────────
  if (req.method === 'GET') {
    const { park, month, speciesId, travelerEmail, tripId } = req.query;
    const filters = [];
    if (speciesId)     filters.push(`{Species ID}="${speciesId}"`);
    if (travelerEmail) filters.push(`{Traveler Email}="${travelerEmail.toLowerCase().trim()}"`);
    if (tripId)        filters.push(`{Trip ID}="${tripId}"`);
    if (park)          filters.push(`SEARCH(LOWER("${park}"),LOWER({Location}))`);
    if (month)         filters.push(`SEARCH("${month}",{Month})`);
    const formula = filters.length > 1 ? `AND(${filters.join(',')})` : (filters[0] || '');
    const baseQs = (formula ? `?filterByFormula=${encodeURIComponent(formula)}&` : '?') +
               'sort[0][field]=Date&sort[0][direction]=desc';
    try {
      const records = [];
      let offset = '';
      do {
        const qs   = baseQs + (offset ? '&offset=' + encodeURIComponent(offset) : '');
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

  // ── POST — log a sighting ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { speciesId, name, sciName, count, groupSize, location, notes, behavior, date, travelerEmail, tripId, lat, lon, gpsAccuracy, loggedByEmail, loggedByRole } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    const d = date ? new Date(date) : new Date();

    // Group Size is a single-select field (Single/Pair/Family/Small Group/Large Group).
    // Accept `groupSize` directly, or map legacy numeric `count` to a category.
    const numToGroup = n => {
      const v = Number(n);
      if (!v || v <= 1) return 'Single';
      if (v <= 2)       return 'Pair';
      if (v <= 6)       return 'Family';
      if (v <= 20)      return 'Small Group';
      return 'Large Group';
    };
    const effectiveGroupSize = groupSize || (count != null ? numToGroup(count) : 'Single');

    const fields = {
      ...(speciesId && speciesId !== 'custom' ? { 'Species ID': speciesId } : {}),
      'Species Name':    name,
      'Scientific Name': sciName || '',
      'Group Size':      effectiveGroupSize,
      'Location':        location || '',
      'Notes':           notes || '',
      'Date':            d.toISOString().slice(0, 19),
    };
    if (travelerEmail) fields['Traveler Email'] = travelerEmail;
    if (tripId)        fields['Trip ID']        = tripId;
    if (behavior)      fields['Behavior']       = behavior;
    if (lat != null)   fields['Latitude']     = lat;
    if (lon != null)   fields['Longitude']    = lon;
    if (gpsAccuracy)   fields['GPS Accuracy'] = gpsAccuracy;
    // Attribution: fall back to travelerEmail + "Traveler" if not provided
    fields['Logged by Email'] = (loggedByEmail || travelerEmail || '').toLowerCase().trim();
    fields['Logged by Role']  = loggedByRole || 'Traveler';

    try {
      const rec = await at('', 'POST', { fields, typecast: true });
      if (rec.error) return res.status(500).json({ error: rec.error.message || JSON.stringify(rec.error) });
      return res.status(200).json({ ok: true, id: rec.id });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
