const https = require('https');

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;

function geocode(placeName) {
  return new Promise((resolve, reject) => {
    const query = encodeURIComponent(placeName);
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&limit=1`;
    const req = https.get(url, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const feat = (json.features || [])[0];
          if (!feat) return reject(new Error('Place not found'));
          resolve({ lng: feat.center[0], lat: feat.center[1] });
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

function overpassQuery(lat, lng, radiusKm) {
  // Radius in meters
  const r = radiusKm * 1000;
  // Query hiking routes (relations) and named hiking paths (ways)
  const query = `
[out:json][timeout:25];
(
  relation["route"="hiking"](around:${r},${lat},${lng});
  way["highway"~"path|track"]["sac_scale"](around:${r},${lat},${lng});
  way["highway"="footway"]["trail_visibility"](around:${r},${lat},${lng});
);
out tags;
`.trim();
  return new Promise((resolve, reject) => {
    const body = 'data=' + encodeURIComponent(query);
    const options = {
      hostname: 'overpass-api.de',
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatDistance(distanceMeters) {
  if (!distanceMeters) return null;
  const km = distanceMeters / 1000;
  if (km < 1) return Math.round(distanceMeters) + ' m';
  return km.toFixed(1) + ' km';
}

const SAC_LABELS = {
  'hiking':                'Easy hiking',
  'mountain_hiking':       'Mountain hiking',
  'demanding_mountain_hiking': 'Demanding mountain',
  'alpine_hiking':         'Alpine hiking',
  'demanding_alpine_hiking': 'Demanding alpine',
  'difficult_alpine_hiking': 'Difficult alpine'
};

function parseTrails(data) {
  const seen = new Set();
  const trails = [];

  for (const el of (data.elements || [])) {
    const t = el.tags || {};
    const name = t.name || t['name:en'] || null;
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const sac = t.sac_scale || null;
    const difficulty = SAC_LABELS[sac] || (t.difficulty ? t.difficulty : null);
    const distRaw = t.distance || t['osm:length'] || null;
    const distMeters = distRaw ? parseFloat(distRaw) * (distRaw < 100 ? 1000 : 1) : null;
    const distance = distMeters ? formatDistance(distMeters) : null;
    const network = t.network || null;
    const operator = t.operator || null;
    const website = t.website || t.url || null;
    const ref = t.ref || null;

    trails.push({ name, difficulty, distance, network, operator, website, ref });
  }

  // Sort: named + difficulty first
  trails.sort((a, b) => {
    const aScore = (a.difficulty ? 1 : 0) + (a.distance ? 1 : 0);
    const bScore = (b.difficulty ? 1 : 0) + (b.distance ? 1 : 0);
    return bScore - aScore;
  });

  return trails.slice(0, 20);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { destination, radiusKm = 15 } = req.body || {};
  if (!destination) return res.status(400).json({ error: 'destination required' });

  try {
    const coords = await geocode(destination);
    const data = await overpassQuery(coords.lat, coords.lng, radiusKm);
    const trails = parseTrails(data);
    res.status(200).json({ trails, coords, count: trails.length });
  } catch(e) {
    console.error('trails error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
