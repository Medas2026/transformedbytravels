// Coach Journal — a coach's running notes on a customer's trip.
//   GET  /api/coach-journal?tripId=REC            → list entries (newest first)
//   POST /api/coach-journal  { tripId, coachEmail, note, day? }  → create an entry
const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Coach Journal';
const T       = encodeURIComponent(TABLE);

async function at(path, method = 'GET', body = null) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method,
    headers: {
      'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

const first = v => Array.isArray(v) ? (v[0] || '') : (v || '');

function shape(r) {
  const f = r.fields || {};
  return {
    id:      r.id,
    note:    f['Note'] || '',
    day:     f['Trip Day'] ?? f['Day'] ?? null,
    date:    f['Entry Date'] || '',
    created: f['Created'] || r.createdTime || '',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── List a trip's journal entries ──
    if (req.method === 'GET') {
      const tripId = String((req.query && req.query.tripId) || '').trim();
      if (!tripId) return res.status(400).json({ error: 'tripId required' });
      // Filter in JS by the Trip link id (formulas expose the primary field, not the id).
      let recs = [], offset = '';
      try {
        do {
          const p = `${T}?pageSize=100` + (offset ? `&offset=${offset}` : '');
          const d = await at(p);
          if (d.error) throw new Error(d.error.message || 'list error');
          recs = recs.concat(d.records || []);
          offset = d.offset || '';
        } while (offset);
      } catch (e) {
        // Table may not exist yet — return empty so the UI stays functional.
        return res.status(200).json({ entries: [] });
      }
      const entries = recs
        .filter(r => (r.fields && Array.isArray(r.fields['Trip']) ? r.fields['Trip'] : []).includes(tripId))
        .sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')))  // newest first
        .map(shape);
      return res.status(200).json({ entries });
    }

    // ── Create an entry ──
    if (req.method === 'POST') {
      const b = req.body || {};
      const tripId     = String(b.tripId || '').trim();
      const coachEmail = String(b.coachEmail || '').trim().toLowerCase();
      const note       = String(b.note || '').trim();
      const day        = (b.day != null && b.day !== '') ? Number(b.day) : null;
      if (!tripId)     return res.status(400).json({ error: 'tripId required' });
      if (!coachEmail) return res.status(400).json({ error: 'coachEmail required' });
      if (!note)       return res.status(400).json({ error: 'Write a note first.' });

      const today = new Date().toISOString().slice(0, 10);   // date-only for date fields
      const core = { Note: note.slice(0, 4000), Trip: [tripId], 'Coach Email': coachEmail };
      const full = { ...core, 'Entry Date': today, Created: today };
      if (day != null && !Number.isNaN(day)) full['Trip Day'] = day;

      let created = await at(T, 'POST', { fields: full });
      // If any optional field mismatches (name or type), retry with just the essentials so the note always saves.
      if (created.error) created = await at(T, 'POST', { fields: core });
      if (created.error) return res.status(500).json({ error: created.error.message || JSON.stringify(created.error) });
      return res.status(200).json({ ok: true, entry: shape(created) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
