// Wildlife Map — public "recently seen" map for Travelers' Corner.
//   GET /api/wildlife-map → { markers: [...], count }
//
// PRIVACY (non-negotiable): exact coordinates for protected species are NEVER
// sent to the client. A sighting is "protected" when the species is
//   • Endangered / Critically Endangered (Conservation Status), OR
//   • flagged Threatened (checkbox on TBT Wildlife — supported if present), OR
//   • on a built-in poaching-target safety list (rhino, pangolin) regardless of status.
// Protected sightings SNAP to the park's center coordinate (Wildlife Locations)
// and stack with a count ("🦏 Black rhino · 4 sightings in Akagera"). This
// transform runs server-side, so the browser never receives a precise protected
// location. A protected sighting whose park can't be resolved is omitted entirely.
const BASE_ID = 'appdlxcWb45dIqNK2';

async function fetchAll(table, params = {}) {
  let recs = [], offset = '';
  do {
    const qs = new URLSearchParams({ pageSize: '100', ...params });
    if (offset) qs.set('offset', offset);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?${qs.toString()}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY } });
    const j = await r.json();
    if (j.error) throw new Error(table + ': ' + (j.error.message || JSON.stringify(j.error)));
    recs = recs.concat(j.records || []);
    offset = j.offset || '';
  } while (offset);
  return recs;
}

const PROTECTED_STATUS = new Set(['Endangered', 'Critically Endangered']);
const SAFETY_LIST      = ['rhino', 'pangolin'];   // poaching targets kept park-level regardless of status

// A 'Threatened' checkbox is honored without requiring it to exist yet.
const isThreatened = (f) => f['Threatened'] === true || f['Threatened'] === 'true' || f['Threatened'] === 1;

// Normalize a location name for matching ("Akagera NP" / "Volcanoes National Park" → "akagera" / "volcanoes").
function normLoc(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/national park/g, ' ')
    .replace(/\bn\.?\s*p\.?\b/g, ' ')
    .replace(/\b(national )?(park|reserve|conservancy|wetland|forest)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [sightings, species, locations] = await Promise.all([
      fetchAll('Sightings'),
      fetchAll('TBT Wildlife'),
      fetchAll('Wildlife Locations'),
    ]);

    // species record id → { status, sensitive, realm }
    const spById = new Map();
    species.forEach(r => {
      const f = r.fields || {};
      spById.set(r.id, {
        status:     f['Conservation Status'] || '',
        threatened: isThreatened(f),
        realm:      f['Realm'] || '',
      });
    });

    // normalized park name → { lat, lng, name }  (park center for snapping)
    const parkByName = new Map();
    locations.forEach(r => {
      const f   = r.fields || {};
      const lat = f['Latitude'], lng = f['Longitude'], nm = f['Location Name'] || '';
      if (lat == null || lng == null || !nm) return;
      const key = normLoc(nm);
      if (key && !parkByName.has(key)) parkByName.set(key, { lat: Number(lat), lng: Number(lng), name: nm });
    });

    const exactMarkers = [];
    const protectedAgg = new Map();   // speciesId|park → aggregated marker

    sightings.forEach(r => {
      const f   = r.fields || {};
      const lat = f['Latitude'], lng = f['Longitude'];
      if (lat == null || lng == null) return;

      const sp     = spById.get((f['Species ID'] || '').trim()) || {};
      const name   = f['Species Name'] || 'Wildlife';
      const status = sp.status || '';
      const lname  = String(name).toLowerCase();
      const protectedByList = SAFETY_LIST.some(k => lname.includes(k));
      const protectedSp     = sp.threatened || PROTECTED_STATUS.has(status) || protectedByList;
      const date   = f['Date'] || '';

      if (protectedSp) {
        const park = parkByName.get(normLoc(f['Location'] || ''));
        if (!park) return;   // no safe park to snap to → omit, never leak the exact spot
        const key = (f['Species ID'] || name) + '|' + park.name;
        const cur = protectedAgg.get(key);
        if (cur) {
          cur.count++;
          if (date > cur.date) cur.date = date;
        } else {
          protectedAgg.set(key, {
            species: name, lat: park.lat, lng: park.lng,
            precision: 'park', location: park.name, date,
            count: 1, conservationStatus: status, realm: sp.realm || '',
          });
        }
      } else {
        exactMarkers.push({
          species: name, lat: Number(lat), lng: Number(lng),
          precision: 'exact', location: f['Location'] || '', date,
          count: 1, conservationStatus: status, realm: sp.realm || '',
        });
      }
    });

    const markers = exactMarkers.concat([...protectedAgg.values()])
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.status(200).json({ markers, count: markers.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
