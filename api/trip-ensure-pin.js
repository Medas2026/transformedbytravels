// Lazy PIN backfill for existing trips.
// POST /api/trip-ensure-pin { tripId }
// If the trip already has a PIN, returns it. Otherwise generates a unique
// 6-digit PIN, PATCHes the trip, returns it.

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Trips';

async function airtable(method, path, body) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path || ''}`;
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  return r.json();
}

async function generateUniquePin() {
  for (let i = 0; i < 5; i++) {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    const filter = encodeURIComponent(`({PIN}="${pin}")`);
    const d = await airtable('GET', `?filterByFormula=${filter}&maxRecords=1`);
    if (!(d.records || []).length) return pin;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const tripId = (req.body && req.body.tripId || '').trim();
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  try {
    // Fetch trip
    const trip = await airtable('GET', '/' + tripId);
    if (trip.error) return res.status(404).json({ error: trip.error.message || 'Trip not found' });
    const existing = ((trip.fields || {})['PIN'] || '').toString().trim();
    if (existing) return res.status(200).json({ pin: existing, existing: true });

    // Generate + PATCH
    const pin = await generateUniquePin();
    const patched = await airtable('PATCH', '/' + tripId, { fields: { 'PIN': pin } });
    if (patched.error) return res.status(500).json({ error: patched.error.message || JSON.stringify(patched.error) });
    return res.status(200).json({ pin, existing: false });
  } catch(e) {
    console.error('[trip-ensure-pin]', e);
    return res.status(500).json({ error: e.message });
  }
};
