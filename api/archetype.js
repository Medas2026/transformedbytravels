// Given a set of 5 dimension scores (0-5 each), return the matching archetype
// with all content (description, icon, photos, destinations) from the Airtable
// "Archetype Table".
//
// Usage:
//   GET /api/archetype?curiosity=4&adventure=5&reflection=3&connection=4&travelPurpose=4
//
// Response:
//   {
//     name, description, icon, iconName, photo1, photo2,
//     tripsYouWillLove, destinationsToConsider, usDestinationsToConsider,
//     scores: { Curiosity, Adventure, Reflection, Connection, TravelPurpose },
//     growthSignal
//   }

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Archetype Table';

async function airtableGet(path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

function parseScore(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > 5) return null;
  return n;
}

function matchArchetype({ Curiosity, Adventure, Reflection, Connection, TravelPurpose }) {
  const dims = [Curiosity, Adventure, Reflection, Connection, TravelPurpose];
  const GS   = (Reflection + TravelPurpose) / 2;

  // Priority-ordered rules — first match wins.
  // Each later archetype's stated exclusions are already handled implicitly
  // by the fall-through order.

  // 1. The Growth Seeker — 4 of 5 dimensions ≥ 4 AND none < 3
  if (dims.filter(d => d >= 4).length >= 4 && dims.every(d => d >= 3))
    return { name: 'The Growth Seeker', growthSignal: GS };

  // 2. The Adventure Traveler — Adventure = 5
  if (Adventure === 5)
    return { name: 'The Adventure Traveler', growthSignal: GS };

  // 3. The Cultural Explorer — Curiosity ≥ 4 AND (Connection ≥ 3 OR Travel Purpose ≥ 3)
  //    Runs before Purpose-Driven so curious-and-connected profiles lean CE.
  if (Curiosity >= 4 && (Connection >= 3 || TravelPurpose >= 3))
    return { name: 'The Cultural Explorer', growthSignal: GS };

  // 4. The Purpose-Driven Traveler — GS ≥ 3 AND Adventure ≤ 4
  if (GS >= 3 && Adventure <= 4)
    return { name: 'The Purpose-Driven Traveler', growthSignal: GS };

  // 5. The Experience Seeker — everyone else
  return { name: 'The Experience Seeker', growthSignal: GS };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Accept either camelCase or friendly names
  const q = req.query || {};
  const Curiosity     = parseScore(q.curiosity     ?? q.Curiosity);
  const Adventure     = parseScore(q.adventure     ?? q.Adventure);
  const Reflection    = parseScore(q.reflection    ?? q.Reflection);
  const Connection    = parseScore(q.connection    ?? q.Connection);
  const TravelPurpose = parseScore(q.travelPurpose ?? q['travel-purpose'] ?? q['Travel Purpose']);

  if ([Curiosity, Adventure, Reflection, Connection, TravelPurpose].some(v => v == null)) {
    return res.status(400).json({
      error: 'All five dimension scores required (0-5): curiosity, adventure, reflection, connection, travelPurpose'
    });
  }

  const scores = { Curiosity, Adventure, Reflection, Connection, TravelPurpose };
  const match  = matchArchetype(scores);

  try {
    const filter = `?filterByFormula=${encodeURIComponent(`{Archetype Name}="${match.name}"`)}&maxRecords=1`;
    const data   = await airtableGet(filter);
    const rec    = (data.records || [])[0];
    if (!rec) {
      return res.status(500).json({ error: `No Airtable row found for archetype "${match.name}"` });
    }
    const f = rec.fields || {};
    return res.status(200).json({
      name:                       f['Archetype Name']              || match.name,
      abbreviation:               f['Abbreviation']                || '',
      tag:                        f['Notes']                       || '',
      description:                f['Description']                 || '',
      icon:                       f['Icon']                        || '',
      iconName:                   f['Icon Name']                   || '',
      photo1:                     f['Photo 1 Name']                || '',
      photo2:                     f['Photo 2 Name']                || '',
      tripsYouWillLove:           f['Trips You Will Love']         || '',
      destinationsToConsider:     f['Destinations to Consider']    || '',
      usDestinationsToConsider:   f['U.S. Destinations to Consider'] || '',
      // Traveler-facing guidance shown on the assessment report
      travelerGuidance:           f['Traveler Guidance']           || '',
      // Personal Priorities: source content for internal use (staff briefings, coach reference)
      personalPriorities:         f['Personal Priorities']         || '',
      // Staff-facing briefing content (used by the lodge Guest Brief page)
      staffSummary:               f['Staff Summary']               || '',
      staffTalkingPoints:         f['Staff Talking Points']        || '',
      staffDos:                   f['Staff Dos']                   || '',
      staffDonts:                 f['Staff Donts']                 || '',
      scores,
      growthSignal:               match.growthSignal,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
