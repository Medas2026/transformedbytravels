// Lodge staff cheat sheet for a guest arrival. Given a tripId, returns:
//   - Guest name + archetype
//   - Trip dates + name
//   - Property branding (from the Property record the trip links to)
//   - Archetype-specific briefing (from the Archetype Table's Staff fields)
//
// Usage:  GET /api/staff-brief?tripId=recXXX

const BASE_ID        = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE    = 'Trips';
const TRAVELER_TABLE = 'Traveler';
const PROPERTY_TABLE  = 'Property';
const ARCHETYPE_TABLE = 'Archetype Table';

async function airtableGet(table, path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tripId = String(req.query.tripId || '').trim();
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  try {
    // Fetch trip
    const trip = await airtableGet(TRIPS_TABLE, `/${tripId}`);
    if (trip.error) return res.status(404).json({ error: 'Trip not found' });
    const tf = trip.fields || {};

    const travelerEmail = (tf['Traveler Email'] || '').toLowerCase().trim();
    let coachEmail      = (tf['Coach Email']    || '').toLowerCase().trim();

    // Fetch guest Traveler record
    let guestName = '';
    // An archetype is a read on this trip, not a fixed trait — the Trip's own value
    // wins, and the Traveler record is the fallback.
    let guestArchetype = tf['Archetype'] || '';
    let guestPhotoUrl = '';
    if (travelerEmail) {
      const gFilter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${travelerEmail}"`)}&maxRecords=1`;
      const gData = await airtableGet(TRAVELER_TABLE, gFilter);
      const gRec  = (gData.records || [])[0];
      if (gRec) {
        guestName      = gRec.fields['Traveler Name']      || '';
        if (!guestArchetype) guestArchetype = gRec.fields['Archetype'] || '';
        guestPhotoUrl  = gRec.fields['Profile Photo URL']  || '';
        if (!coachEmail) coachEmail = (gRec.fields['Coach Email'] || '').toLowerCase().trim();
      }
    }

    // Property branding. The trip links to its property; Coach Email stays as a
    // fallback until every trip carries the link.
    let lodge = null;
    const shape = pf => ({
      name:       (pf['Name'] || '').trim(),
      tagline:    pf['Tagline']     || '',
      logoUrl:    pf['Logo URL']    || '',
      brandColor: pf['Brand Color'] || '#0a1628',
    });

    const linked = Array.isArray(tf['Property']) ? tf['Property'][0] : null;
    if (linked) {
      const prop = await airtableGet(PROPERTY_TABLE, `/${linked}`);
      if (!prop.error && (prop.fields['Name'] || '').trim()) lodge = shape(prop.fields);
    }
    if (!lodge && coachEmail) {
      const pFilter = `?filterByFormula=${encodeURIComponent(`LOWER({Contact Email})="${coachEmail}"`)}&maxRecords=1`;
      const pData = await airtableGet(PROPERTY_TABLE, pFilter);
      const pRec  = (pData.records || [])[0];
      if (pRec && (pRec.fields['Name'] || '').trim()) lodge = shape(pRec.fields);
    }

    // Fetch archetype briefing from Archetype Table
    let brief = null;
    if (guestArchetype) {
      const aFilter = `?filterByFormula=${encodeURIComponent(`{Archetype Name}="${guestArchetype}"`)}&maxRecords=1`;
      const aData = await airtableGet(ARCHETYPE_TABLE, aFilter);
      const aRec  = (aData.records || [])[0];
      if (aRec) {
        const af = aRec.fields || {};
        brief = {
          archetypeName: af['Archetype Name']       || guestArchetype,
          abbreviation:  af['Abbreviation']         || '',
          summary:       af['Staff Summary']        || '',
          talkingPoints: af['Staff Talking Points'] || '',
          dos:           af['Staff Dos']            || '',
          donts:         af['Staff Donts']          || '',
        };
      }
    }

    return res.status(200).json({
      trip: {
        id:          tripId,
        name:        tf['Trip Name']    || '',
        destination: tf['Destination']  || '',
        startDate:   tf['Start Date']   || '',
        endDate:     tf['End Date']     || '',
        pin:         tf['PIN']          || '',
      },
      guest: {
        name:      guestName,
        email:     travelerEmail,
        archetype: guestArchetype,
        photoUrl:  guestPhotoUrl,
      },
      lodge,
      brief,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
