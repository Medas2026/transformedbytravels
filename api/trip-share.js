const BASE_ID = 'appdlxcWb45dIqNK2';
const headers = () => ({ 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY });

async function atGet(table, qs) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${qs}`;
  const r   = await fetch(url, { headers: headers() });
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { tripId, token } = req.query;
  if (!tripId || !token) return res.status(400).json({ error: 'tripId and token required' });

  try {
    // Load trip and verify token
    const tripData = await atGet('Trips', `?filterByFormula=${encodeURIComponent(`{Trip ID}="${tripId}"`)}`);
    const trip = (tripData.records || [])[0];
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    const stored = (trip.fields['Share Token'] || '').trim();
    if (!stored || stored !== token.trim()) {
      return res.status(403).json({ error: 'Invalid share code' });
    }

    // Load trip days
    const daysData = await atGet('Trip Days',
      `?filterByFormula=${encodeURIComponent(`{Trip ID}="${tripId}"`)}&sort[0][field]=Day%20Number&sort[0][direction]=asc`);
    const days = daysData.records || [];

    // Load lodging for this trip and build name map
    const lodgingData = await atGet('Lodging',
      `?filterByFormula=${encodeURIComponent(`{Trip ID}="${tripId}"`)}`);
    const lodgingMap = {};
    (lodgingData.records || []).forEach(r => {
      lodgingMap[r.id] = {
        name:    r.fields['Name']    || 'Lodging',
        type:    r.fields['Type']    || '',
        city:    r.fields['City']    || '',
        website: r.fields['Website'] || '',
      };
    });

    const f = trip.fields;
    return res.status(200).json({
      trip: {
        id:          trip.id,
        name:        f['Trip Name']     || f['Destination'] || 'Your Trip',
        destination: f['Destination']   || '',
        country:     f['Country']       || '',
        startDate:   f['Start Date']    || '',
        endDate:     f['End Date']      || '',
        photoUrl:    f['Trip Photo URL']|| '',
        status:      f['Status of Trip']|| '',
      },
      days,
      lodgingMap,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
