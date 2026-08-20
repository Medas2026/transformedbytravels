// api/founding-spots.js
// Returns how many Founding Member consult spots remain, based on real
// Cal.com bookings for the founding-consult event type.
//
// Uses Cal.com API v2 (v1 is retired → HTTP 410). The event is "hidden" on
// Cal, so it does NOT appear in the /v2/event-types listing. Instead we list
// bookings and count the ones whose eventType slug matches, which works
// regardless of the event being hidden.
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
// Booking statuses that do NOT consume a spot.
const DEAD  = new Set(['cancelled', 'canceled', 'rejected']);

function getJson(path, apiVersion) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.cal.com',
        path,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + process.env.CAL_API_KEY,
          'cal-api-version': apiVersion,
        },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); }
          catch (e) { resolve({ status: res.statusCode, json: {} }); }
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

  if (!process.env.CAL_API_KEY) {
    return res.status(200).json({ ok: false, total: TOTAL, reason: 'no-key' });
  }

  try {
    // Page through bookings, counting non-cancelled ones for our event slug.
    let booked = 0;
    let skip = 0;
    const take = 100;
    for (let i = 0; i < 20; i++) { // hard cap: 2000 bookings
      const bk = await getJson(`/v2/bookings?take=${take}&skip=${skip}`, '2024-08-13');
      const rows = (bk.json && bk.json.data) || [];
      booked += rows.filter((b) => {
        const slug = b.eventType && b.eventType.slug;
        const status = String(b.status || '').toLowerCase();
        return slug === SLUG && !DEAD.has(status);
      }).length;
      if (rows.length < take) break;
      skip += take;
    }

    const remaining = Math.max(0, TOTAL - booked);
    return res.status(200).json({ ok: true, total: TOTAL, booked, remaining });
  } catch (err) {
    return res.status(200).json({ ok: false, total: TOTAL, reason: 'error' });
  }
};
