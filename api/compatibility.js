const BASE_ID = 'appdlxcWb45dIqNK2';

const QUESTIONS = [
  { id: 'q01', text: 'When do you prefer to start travel days?', options: ['Early bird (before 8am)', 'Morning (8–10am)', 'Relaxed (10am or later)'] },
  { id: 'q02', text: 'How do you feel about spontaneous itinerary changes?', options: ['Love it — keep it flexible', 'Some structure, some flex', 'Prefer a solid plan'] },
  { id: 'q03', text: 'What\'s your ideal travel pace?', options: ['Slow & deep (fewer places)', 'Balanced mix', 'Fast & full (see everything)'] },
  { id: 'q04', text: 'How important is alone/downtime during the trip?', options: ['Very important — I need it', 'Nice to have occasionally', 'I prefer to be together always'] },
  { id: 'q05', text: 'How do you handle unexpected problems (delays, weather, etc.)?', options: ['Roll with it easily', 'Mild stress but I manage', 'It stresses me a lot'] },
  { id: 'q06', text: 'What\'s your budget comfort level?', options: ['Splurge freely on experiences', 'Balanced — sometimes splurge, sometimes save', 'Budget-conscious throughout'] },
  { id: 'q07', text: 'How do you prefer to eat while traveling?', options: ['Local street food & markets', 'Mix of casual and upscale', 'Fine dining experiences'] },
  { id: 'q08', text: 'How much physical activity do you want?', options: ['Very active (hikes, adventure)', 'Moderate activity', 'Leisurely (walks, sightseeing)'] },
  { id: 'q09', text: 'Do you prefer shared or independent experiences during the trip?', options: ['Together for everything', 'Mostly together, some solo time', 'Independent most of the time'] },
  { id: 'q10', text: 'How do you feel about nightlife?', options: ['Love it — late nights out', 'Occasional evenings out', 'Early nights, rested mornings'] },
  { id: 'q11', text: 'How important is staying connected (work/phone) while traveling?', options: ['I need to stay connected', 'I check in occasionally', 'Full digital detox'] },
  { id: 'q12', text: 'What matters most when choosing accommodation?', options: ['Location above all', 'Comfort & amenities', 'Unique & experiential'] },
];

async function airtableFetch(table, path, apiKey) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey } });
  return resp.json();
}

async function airtablePatch(table, id, fields, apiKey) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${id}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return resp.json();
}

async function airtableCreate(table, fields, apiKey) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.AIRTABLE_API_KEY;

  // GET — return questions + survey state for a trip
  if (req.method === 'GET') {
    const tripId = (req.query.tripId || '').trim();
    const email  = (req.query.email  || '').toLowerCase().trim();
    if (!tripId) return res.status(400).json({ error: 'tripId required' });

    const [tripData, membersData] = await Promise.all([
      airtableFetch('Trips', `/${tripId}`, apiKey),
      airtableFetch('Trip Members',
        `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Accepted")`)}`,
        apiKey)
    ]);

    const tripFields = tripData.fields || {};
    let selectedIds = [];
    try { selectedIds = JSON.parse(tripFields['Survey Question IDs'] || '[]'); } catch(e) {}

    const members = (membersData.records || []).map(r => ({
      id: r.id,
      email: (r.fields['Email'] || '').toLowerCase(),
      role:  r.fields['Role'] || '',
      answers: (() => { try { return JSON.parse(r.fields['Survey Answers'] || '{}'); } catch(e) { return {}; } })()
    }));

    const myMember = email ? members.find(m => m.email === email) || null : null;

    return res.status(200).json({
      questions:        QUESTIONS,
      selectedIds,
      members,
      myMemberRecordId: myMember ? myMember.id : null,
      myAnswers:        myMember ? myMember.answers : {}
    });
  }

  // POST ?action=save-questions — owner saves selected question IDs
  if (req.method === 'POST' && req.query.action === 'save-questions') {
    const { tripId, questionIds } = req.body || {};
    if (!tripId) return res.status(400).json({ error: 'tripId required' });
    const result = await airtablePatch('Trips', tripId, {
      'Survey Question IDs': JSON.stringify(questionIds || [])
    }, apiKey);
    if (result.error) {
      console.error('[compatibility] save-questions error:', JSON.stringify(result.error));
      return res.status(500).json({ error: result.error.message || JSON.stringify(result.error) });
    }
    return res.status(200).json({ success: true });
  }

  // POST ?action=save-answers — member (or owner) saves survey answers
  if (req.method === 'POST' && req.query.action === 'save-answers') {
    const { tripId, email, answers } = req.body || {};
    if (!tripId || !email) return res.status(400).json({ error: 'tripId and email required' });

    const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Email}="${email}")`)}`;
    const existing = await airtableFetch('Trip Members', filter, apiKey);
    const rec = (existing.records || [])[0];

    let result;
    if (rec) {
      result = await airtablePatch('Trip Members', rec.id, {
        'Survey Answers': JSON.stringify(answers || {})
      }, apiKey);
    } else {
      // Owner has no member record — create one using an existing role value
      result = await airtableCreate('Trip Members', {
        'Trip ID':  tripId,
        'Email':    email,
        'Role':     'Owner',
        'Status':   'Accepted',
        'Survey Answers': JSON.stringify(answers || {})
      }, apiKey);
    }
    if (result.error) return res.status(500).json({ error: result.error.message || JSON.stringify(result.error) });
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
};
