const https = require('https');

function httpsGet(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: null, raw: d }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function geocode(place, country) {
  const mapboxToken = process.env.MAPBOX_TOKEN;
  if (!mapboxToken) return null;
  const query = [place, country].filter(Boolean).join(', ');
  const path = '/geocoding/v5/mapbox.places/' + encodeURIComponent(query) + '.json?access_token=' + mapboxToken + '&limit=1';
  const result = await httpsGet({ hostname: 'api.mapbox.com', path, method: 'GET', headers: { 'Accept': 'application/json' } });
  if (!result.body || !result.body.features || !result.body.features.length) return null;
  const [lng, lat] = result.body.features[0].center;
  return { lat, lng };
}

async function getHotspots(lat, lng, apiKey) {
  const path = '/v2/ref/hotspot/geo?lat=' + lat + '&lng=' + lng + '&dist=50&back=30&fmt=json';
  const result = await httpsGet({
    hostname: 'api.ebird.org',
    path,
    method: 'GET',
    headers: { 'X-eBirdApiToken': apiKey, 'Accept': 'application/json' }
  });
  return Array.isArray(result.body) ? result.body : [];
}

async function getNotableSightings(lat, lng, apiKey) {
  const path = '/v2/data/notable/geo/recent?lat=' + lat + '&lng=' + lng + '&dist=50&back=30&detail=simple&maxResults=30&fmt=json';
  const result = await httpsGet({
    hostname: 'api.ebird.org',
    path,
    method: 'GET',
    headers: { 'X-eBirdApiToken': apiKey, 'Accept': 'application/json' }
  });
  return Array.isArray(result.body) ? result.body : [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { place, country } = req.body || {};
  if (!place) return res.status(400).json({ error: 'place is required' });

  const apiKey = (process.env.EBIRD_API_KEY || '').trim();
  if (!apiKey) return res.status(500).json({ error: 'eBird API key not configured' });

  try {
    const coords = await geocode(place, country);
    if (!coords) return res.status(200).json({ hotspots: [], sightings: [], error: 'Could not locate ' + place });

    const [hotspots, sightings] = await Promise.all([
      getHotspots(coords.lat, coords.lng, apiKey),
      getNotableSightings(coords.lat, coords.lng, apiKey)
    ]);

    // Top 8 hotspots by numSpeciesAllTime desc
    const topHotspots = hotspots
      .sort((a, b) => (b.numSpeciesAllTime || 0) - (a.numSpeciesAllTime || 0))
      .slice(0, 8)
      .map(h => ({
        name:       h.locName,
        lat:        h.lat,
        lng:        h.lng,
        species:    h.numSpeciesAllTime || 0,
        locId:      h.locId
      }));

    // Deduplicate notable sightings by species
    const seen = new Set();
    const topSightings = sightings
      .filter(s => { if (seen.has(s.speciesCode)) return false; seen.add(s.speciesCode); return true; })
      .slice(0, 15)
      .map(s => ({
        comName:    s.comName,
        sciName:    s.sciName,
        locName:    s.locName,
        obsDt:      s.obsDt,
        howMany:    s.howMany || null
      }));

    return res.status(200).json({ hotspots: topHotspots, sightings: topSightings });
  } catch(e) {
    console.error('birding error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
