// api/founding-spots.js
// Returns how many Founding Member consult spots remain, based on real
// Cal.com bookings for the founding-consult event type.
//
// Env:
//   CAL_API_KEY     (required) — Cal.com API key (Settings → Developer → API Keys)
//   FOUNDING_TOTAL  (optional) — total spots offered; defaults to 30
//   FOUNDING_SLUG   (optional) — Cal.com event-type slug; defaults to 'founding-consult'
//
// Never throws to the client: on any failure it returns { ok:false, total }
// so the page falls back to its static copy instead of breaking.

const https = require('https');

const TOTAL = parseInt(process.env.FOUNDING_TOTAL || '30', 10);
const SLUG  = process.env.FOUNDING_SLUG || 'founding-consult';

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: 'api.cal.com', path, method: 'GET', headers: { Accept: 'application/json' } },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Cal.com request timed out')));
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cache at the edge so we don't hit Cal.com on every page view.
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');

  const key = process.env.CAL_API_KEY;
  if (!key) {
    return res.status(200).json({ ok: false, total: TOTAL, reason: 'no-key' });
  }

  try {
    // 1) Resolve the event-type id from its slug.
    const et = await getJson(`/v1/event-types?apiKey=${encodeURIComponent(key)}`);
    const types = (et.json && et.json.event_types) || [];
    const match = types.find((t) => t.slug === SLUG);
    if (!match) {
      return res.status(200).json({ ok: false, total: TOTAL, reason: 'slug-not-found' });
    }

    // 2) Count non-cancelled bookings for that event type.
    const bk = await getJson(`/v1/bookings?apiKey=${encodeURIComponent(key)}`);
    const bookings = (bk.json && bk.json.bookings) || [];
    const dead = new Set(['cancelled', 'canceled', 'rejected']);
    const booked = bookings.filter(
      (b) => b.eventTypeId === match.id && !dead.has(String(b.status || '').toLowerCase())
    ).length;

    const remaining = Math.max(0, TOTAL - booked);
    return res.status(200).json({ ok: true, total: TOTAL, booked, remaining });
  } catch (err) {
    return res.status(200).json({ ok: false, total: TOTAL, reason: 'error' });
  }
};
