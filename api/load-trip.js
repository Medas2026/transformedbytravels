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
    const builtDays = days.map((rec, i) => {
      const df       = rec.fields;
      const startLoc = (df['Starting Location'] || '').trim();
      const endLoc   = (df['Ending Location']   || '').trim();
      const location = (startLoc && endLoc && startLoc !== endLoc)
        ? startLoc + ' → ' + endLoc
        : (endLoc || startLoc || ('Day ' + (df['Day Number'] || i + 1)));
      return {
        num:      df['Day Number'] || (i + 1),
        date:     formatDate(df['Date']),
        location: location,
        park:     endLoc || location,
        lodge:    getLodgeForDate(df['Date'], lodging),
        lon:      null,
        lat:      null,
        zoom:     9,
      };
    });

    // 4. Geocode unique parks via Mapbox
    const uniqueParks = [...new Set(builtDays.map(d => d.park).filter(Boolean))];
    if (process.env.MAPBOX_TOKEN && uniqueParks.length) {
      const country = tf['Country'] || tf['Destination'] || '';
      await Promise.all(uniqueParks.map(async park => {
        try {
          const q   = encodeURIComponent(park + (country ? ', ' + country : ''));
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?types=poi,park,place,region&limit=1&access_token=${process.env.MAPBOX_TOKEN}`;
          const r   = await fetch(url);
          const d   = await r.json();
          const ft  = d.features?.[0];
          if (ft) {
            const [lon, lat] = ft.center;
            builtDays.forEach(day => {
              if (day.park === park) { day.lon = lon; day.lat = lat; }
            });
          }
        } catch(e) {}
      }));
    }

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
