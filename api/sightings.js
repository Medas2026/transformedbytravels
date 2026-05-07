const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Sightings';

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
    const { park, month, speciesId } = req.query;
    const filters = [];
    if (speciesId) filters.push(`{Species ID}="${speciesId}"`);
    if (park)      filters.push(`SEARCH(LOWER("${park}"),LOWER({Location}))`);
    if (month)     filters.push(`SEARCH("${month}",{Month})`);
    const formula = filters.length > 1 ? `AND(${filters.join(',')})` : (filters[0] || '');
    const qs = (formula ? `?filterByFormula=${encodeURIComponent(formula)}&` : '?') +
               'sort[0][field]=Date&sort[0][direction]=desc';
    try {
      const data = await at(qs);
      return res.status(200).json({ records: data.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — log a sighting ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { speciesId, name, sciName, count, location, notes, date, travelerEmail, lat, lon, gpsAccuracy } = req.body || {};
    if (!speciesId || !name) return res.status(400).json({ error: 'speciesId and name are required' });

    const d     = date ? new Date(date) : new Date();
    const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];

    const fields = {
      'Species ID':      speciesId,
      'Species Name':    name,
      'Scientific Name': sciName || '',
      'Count':           count || 1,
      'Location':        location || '',
      'Notes':           notes || '',
      'Date':            d.toISOString().slice(0, 10),
      'Month':           month,
    };
    if (travelerEmail) fields['Traveler Email'] = travelerEmail;
    if (lat != null)   fields['Latitude']       = lat;
    if (lon != null)   fields['Longitude']       = lon;
    if (gpsAccuracy)   fields['GPS Accuracy (m)'] = gpsAccuracy;

    try {
      const rec = await at('', 'POST', { fields });
      if (rec.error) return res.status(500).json({ error: rec.error.message || JSON.stringify(rec.error) });
      return res.status(200).json({ ok: true, id: rec.id });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
