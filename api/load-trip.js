const BASE_ID = 'appdlxcWb45dIqNK2';

async function at(table, path) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00Z')
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function getLodgeForDate(dateStr, lodging) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00Z');
  for (const l of lodging) {
    const f = l.fields;
    if (!f['Check-in Date'] || !f['Check-out Date']) continue;
    const cin  = new Date(f['Check-in Date']  + 'T00:00:00Z');
    const cout = new Date(f['Check-out Date'] + 'T00:00:00Z');
    if (d >= cin && d < cout) return f['Name'] || '';
  }
  return '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { tripId } = req.query;
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  try {
    // 1. Fetch trip first to get email
    const tripData = await at('Trips', `/${tripId}`);
    if (tripData.error) return res.status(404).json({ error: 'Trip not found' });
    const tf = tripData.fields;
    const email = tf['Traveler Email'] || '';

    // 2. Fetch days, lodging, traveler profile in parallel
    const [daysData, lodgingData, profileData] = await Promise.all([
      at('Trip Days',
        `?filterByFormula=${encodeURIComponent(`{Trip ID}="${tripId}"`)}&sort[0][field]=Day%20Number&sort[0][direction]=asc`),
      at('Lodging',
        `?filterByFormula=${encodeURIComponent(`{Trip ID}="${tripId}"`)}`),
      email
        ? at('Traveler', `?filterByFormula=${encodeURIComponent(`{Traveler Email}="${email}"`)}`)
        : Promise.resolve({ records: [] }),
    ]);

    const days    = daysData.records    || [];
    const lodging = lodgingData.records || [];
    const profile = (profileData.records || [])[0];
    const travelerName = profile?.fields?.['Traveler Name'] || email.split('@')[0] || 'Traveler';

    // 3. Build days array
    // Locations that are departure hubs, not safari destinations
    const GATEWAYS = ['entebbe', 'kampala', 'nairobi', 'dar es salaam', 'johannesburg',
                      'cape town', 'kigali', 'addis ababa', 'airport', 'international'];
    const isGateway = loc => GATEWAYS.some(g => loc.toLowerCase().includes(g));

    const builtDays = days.map((rec, i) => {
      const df       = rec.fields;
      const startLoc = (df['Starting Location'] || '').trim();
      const endLoc   = (df['Ending Location']   || '').trim();
      const location = (startLoc && endLoc && startLoc !== endLoc)
        ? startLoc + ' → ' + endLoc
        : (endLoc || startLoc || ('Day ' + (df['Day Number'] || i + 1)));
      // Use startLoc as the park on departure days so photos stay with the safari destination
      const park = (endLoc && !isGateway(endLoc)) ? endLoc : (startLoc || endLoc || location);
      return {
        num:      df['Day Number'] || (i + 1),
        date:     formatDate(df['Date']),
        location: location,
        park,
        lodge:    getLodgeForDate(df['Date'], lodging),
        lon:      null,
        lat:      null,
        zoom:     9,
      };
    });

    // 4. Geocode unique parks — known lookup first, Mapbox fallback
    const PARK_COORDS = {
      'ziwa': [32.87, 1.40], 'murchison': [31.69, 2.27], 'kibale': [30.40, 0.48],
      'queen elizabeth': [30.00, -0.12], 'bwindi': [29.68, -1.05],
      'mburo': [30.95, -0.62], 'entebbe': [32.47, 0.06], 'kidepo': [33.87, 3.82],
      'rwenzori': [29.97, 0.38], 'mgahinga': [29.63, -1.37],
      'serengeti': [34.83, -2.33], 'ngorongoro': [35.50, -3.20], 'masai mara': [35.17, -1.42],
      'amboseli': [37.25, -2.65], 'tsavo': [38.47, -2.98], 'samburu': [37.53, 0.62],
      'kruger': [31.50, -23.99], 'etosha': [16.32, -18.86], 'okavango': [22.83, -19.33],
      'chobe': [24.50, -17.80], 'hwange': [26.50, -18.90], 'victoria falls': [25.84, -17.92],
      'ruaha': [34.47, -7.78], 'selous': [38.00, -9.00], 'tarangire': [36.00, -3.83],
    };
    function lookupPark(name) {
      const l = name.toLowerCase();
      for (const [k, c] of Object.entries(PARK_COORDS)) { if (l.includes(k)) return c; }
      return null;
    }
    const uniqueParks = [...new Set(builtDays.map(d => d.park).filter(Boolean))];
    const country = tf['Country'] || tf['Destination'] || '';
    await Promise.all(uniqueParks.map(async park => {
      const known = lookupPark(park);
      if (known) {
        const [lon, lat] = known;
        builtDays.forEach(day => { if (day.park === park) { day.lon = lon; day.lat = lat; } });
        return;
      }
      if (!process.env.MAPBOX_TOKEN) return;
      try {
        const q   = encodeURIComponent(park + (country ? ', ' + country : ''));
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?types=place,region,locality&limit=1&access_token=${process.env.MAPBOX_TOKEN}`;
        const r   = await fetch(url);
        const d   = await r.json();
        const ft  = d.features?.[0];
        if (ft) {
          const [lon, lat] = ft.center;
          builtDays.forEach(day => { if (day.park === park) { day.lon = lon; day.lat = lat; } });
        }
      } catch(e) {}
    }));

    return res.status(200).json({
      trip: {
        title:       tf['Trip Name'] || tf['Destination'] || 'My Trip',
        traveler:    travelerName,
        year:        (tf['Start Date'] || '').slice(0, 4) || String(new Date().getFullYear()),
        destination: tf['Destination'] || '',
        country:     tf['Country']     || '',
        guide:       null,
        days:        builtDays,
      }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
