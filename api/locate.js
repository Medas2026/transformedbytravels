// Given a GPS coordinate, find the smallest matching Wildlife Location whose
// bounding box contains the point.
// Usage:
//   GET /api/locate?lat=<num>&lng=<num>
//
// Returns:
//   { location: { id, name, region, country, parkType, land, ocean, sky, area } } or
//   { location: null } if no match.
//
// If multiple boxes contain the point (overlapping regions, e.g. a specific park
// inside a broader region), we return the smallest area — the most specific match.

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Wildlife Locations';

async function airtableGet(path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

function parseNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const lat = parseNum(req.query.lat);
  const lng = parseNum(req.query.lng);
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat and lng required (numbers)' });
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
    return res.status(400).json({ error: 'lat/lng out of range' });

  try {
    const records = [];
    let offset = '';
    do {
      const qs = offset ? `?offset=${offset}` : '';
      const data = await airtableGet(qs);
      if (data.error) return res.status(500).json({ error: data.error.message });
      records.push(...(data.records || []));
      offset = data.offset || '';
    } while (offset);

    // Consider only records with a full bounding box
    const boxed = [];
    for (const r of records) {
      const f = r.fields || {};
      const north = parseNum(f['North Lat']);
      const south = parseNum(f['South Lat']);
      const east  = parseNum(f['East Long']);
      const west  = parseNum(f['West Long']);
      if (north == null || south == null || east == null || west == null) continue;
      // Normalize: ensure north > south, east > west (users may swap by accident)
      const n = Math.max(north, south);
      const s = Math.min(north, south);
      const e = Math.max(east,  west);
      const w = Math.min(east,  west);
      if (lat > n || lat < s || lng > e || lng < w) continue;
      const area = (n - s) * (e - w); // rough — good enough for smallest-first sort
      boxed.push({
        id:        r.id,
        name:      f['Location Name']  || '',
        region:    f['Region']         || '',
        country:   f['Country']        || '',
        continent: f['Continent']      || '',
        parkType:  f['Park Type']      || '',
        land:      !!f['Land'],
        ocean:     !!f['Ocean'],
        sky:       !!f['Sky'],
        centerLat: parseNum(f['Latitude']),
        centerLng: parseNum(f['Longitude']),
        area,
      });
    }

    // Smallest area wins — most specific match
    boxed.sort((a, b) => a.area - b.area);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      location: boxed[0] || null,
      alternatives: boxed.slice(1, 3),
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
