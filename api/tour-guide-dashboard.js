// Tour Guide Dashboard API
// GET /api/tour-guide-dashboard?email=guide@example.com
// Returns all trips where the guide is a Trip Member with role=Tour Guide.
// Each trip includes: id, name, dates, destination, traveler name/email,
// assigned places (multi-link IDs), and coguides (other Tour Guide members).

const https = require('https');

const BASE_ID        = 'appdlxcWb45dIqNK2';
const MEMBERS_TABLE  = 'Trip Members';
const TRIPS_TABLE    = 'Trips';
const TRAVELER_TABLE = 'Traveler';

function airtable(table, method, path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path || ''}`,
      method,
      headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }); }
        catch(e) { reject(new Error('parse: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAll(table, params) {
  const records = [];
  let offset = '';
  do {
    const q = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(x => q.append(k, x));
      else if (v !== undefined && v !== null) q.append(k, v);
    });
    if (offset) q.set('offset', offset);
    const resp = await airtable(table, 'GET', '?' + q.toString());
    if (resp.body.error) throw new Error(resp.body.error.message || JSON.stringify(resp.body.error));
    records.push(...(resp.body.records || []));
    offset = resp.body.offset || '';
  } while (offset);
  return records;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    // 1. All Trip Members rows for this guide (any trip, role=Tour Guide, accepted)
    const memberFilter = `AND(LOWER({Email})="${email}",{Role}="Tour Guide",{Status}="Accepted")`;
    const memberRecs = await fetchAll(MEMBERS_TABLE, { filterByFormula: memberFilter });

    if (!memberRecs.length) return res.status(200).json({ trips: [] });

    // 2. Fetch all Trips these members are on. Airtable record IDs are stored
    //    in Trip Members as text field 'Trip ID'.
    const tripIds = [...new Set(memberRecs.map(r => r.fields['Trip ID']).filter(Boolean))];
    const tripLookups = await Promise.all(tripIds.map(id =>
      airtable(TRIPS_TABLE, 'GET', '/' + id).catch(e => ({ body: { error: e.message } }))
    ));

    // Map trip records + also all Trip Members for each trip (for co-guide info)
    const tripsById = {};
    tripLookups.forEach((resp, idx) => {
      if (resp.body && resp.body.id) tripsById[resp.body.id] = resp.body;
    });

    // 3. Bulk fetch all Trip Members for these trips (to identify co-guides)
    const tripIdList = Object.keys(tripsById);
    let allMembers = [];
    if (tripIdList.length) {
      const orTerms = tripIdList.map(id => `{Trip ID}="${id}"`).join(',');
      const membersFilter = tripIdList.length > 1 ? `OR(${orTerms})` : orTerms;
      allMembers = await fetchAll(MEMBERS_TABLE, { filterByFormula: membersFilter });
    }
    const membersByTrip = {};
    allMembers.forEach(m => {
      const tid = m.fields['Trip ID'];
      if (!membersByTrip[tid]) membersByTrip[tid] = [];
      membersByTrip[tid].push(m);
    });

    // 4. Bulk fetch traveler names for trip owners (dedupe by email)
    const travelerEmails = [...new Set(
      Object.values(tripsById)
        .map(t => (t.fields['Traveler Email'] || '').toLowerCase())
        .filter(Boolean)
    )];
    const travelerNames = {};
    if (travelerEmails.length) {
      const orTerms = travelerEmails.map(e => `LOWER({Traveler Email})="${e}"`).join(',');
      const filter  = travelerEmails.length > 1 ? `OR(${orTerms})` : orTerms;
      const recs = await fetchAll(TRAVELER_TABLE, {
        filterByFormula: filter,
        'fields[]':      ['Traveler Email', 'Traveler Name'],
      });
      recs.forEach(r => {
        const em = (r.fields['Traveler Email'] || '').toLowerCase();
        if (em) travelerNames[em] = r.fields['Traveler Name'] || em;
      });
    }

    // 5. Shape output
    const trips = memberRecs.map(m => {
      const tripId = m.fields['Trip ID'];
      const trip   = tripsById[tripId];
      if (!trip) return null;
      const tf     = trip.fields;
      const travelerEmail = (tf['Traveler Email'] || '').toLowerCase();
      // Co-guides: other Tour Guide members on same trip, excluding this guide
      const coGuides = (membersByTrip[tripId] || [])
        .filter(mm => mm.fields['Role'] === 'Tour Guide' && (mm.fields['Email'] || '').toLowerCase() !== email)
        .map(mm => ({
          email: (mm.fields['Email'] || '').toLowerCase(),
          assignedPlaceIds: mm.fields['Assigned Places'] || [],
        }));
      return {
        tripId,
        tripName:            tf['Trip Name'] || tf['Destination'] || 'Untitled trip',
        destination:         tf['Destination'] || '',
        country:             tf['Country']     || '',
        startDate:           tf['Start Date']  || '',
        endDate:             tf['End Date']    || '',
        status:              tf['Status of Trip'] || '',
        heroPhoto:           tf['Trip Photo URL'] || tf['Hero Photo'] || '',
        travelerEmail,
        travelerName:        travelerNames[travelerEmail] || travelerEmail,
        assignedPlaceIds:    m.fields['Assigned Places'] || [],
        memberRecordId:      m.id,
        coGuides,
      };
    }).filter(Boolean);

    // Sort by upcoming (start date ascending), missing dates last
    trips.sort((a, b) => {
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return a.startDate.localeCompare(b.startDate);
    });

    return res.status(200).json({ trips });
  } catch(e) {
    console.error('[tour-guide-dashboard]', e);
    return res.status(500).json({ error: e.message });
  }
};
