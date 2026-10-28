// Trip-by-PIN lookup
// GET /api/trip-by-pin?pin=123456
// Returns { tripId, tripName, destination, startDate, endDate, travelerEmail, shareToken }
// Rate-limited: 10 attempts per IP per minute (in-memory, per-serverless-instance).

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Trips';

// Simple in-memory rate limiter — good enough at current scale.
// Note: Vercel serverless instances are short-lived, so this is best-effort.
const attemptsByIp = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const maxAttempts = 10;
  const existing = attemptsByIp.get(ip) || [];
  const recent = existing.filter(t => now - t < windowMs);
  if (recent.length >= maxAttempts) return false;
  recent.push(now);
  attemptsByIp.set(ip, recent);
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'GET only' });

  const pin = (req.query.pin || '').trim();
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'invalid pin format' });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  if (!rateLimit(ip)) return res.status(429).json({ error: 'too many attempts, wait a minute' });

  try {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const filter = encodeURIComponent(`({PIN}="${pin}")`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}?filterByFormula=${filter}&maxRecords=1`;
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey } });
    const d = await r.json();
    if (d.error) return res.status(500).json({ error: d.error.message || JSON.stringify(d.error) });
    const rec = (d.records || [])[0];
    if (!rec) return res.status(404).json({ error: 'PIN not recognized' });
    const f = rec.fields;
    return res.status(200).json({
      tripId:        rec.id,
      tripName:      f['Trip Name']    || f['Destination'] || 'Trip',
      destination:   f['Destination']  || '',
      country:       f['Country']      || '',
      startDate:     f['Start Date']   || '',
      endDate:       f['End Date']     || '',
      status:        f['Status of Trip'] || '',
      travelerEmail: (f['Traveler Email'] || '').toLowerCase(),
      shareToken:    f['Share Token']  || '',
    });
  } catch(e) {
    console.error('[trip-by-pin]', e);
    return res.status(500).json({ error: e.message });
  }
};
