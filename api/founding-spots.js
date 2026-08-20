// api/founding-spots.js
// Returns how many Founding Member consult spots remain, based on real
// Cal.com bookings for the founding-consult event type. Uses Cal.com API v2
// (v1 was retired — it now returns HTTP 410 Gone).
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
          catch (e) { resolve({ status: res.statusCode, json: {}, raw: d }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Cal.com request timed out')));
    req.end();
  });
}

// v2 event-type payloads can be a flat array or grouped ({ eventTypes: [...] }).
// Flatten defensively to a list of { id, slug, title }.
function flattenEventTypes(data) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      if (node.slug && (node.id !== undefined)) {
        out.push({ id: node.id, slug: node.slug, title: node.title });
      }
      if (Array.isArray(node.eventTypes)) node.eventTypes.forEach(walk);
    }
  };
  walk(data);
  return out;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cache at the edge so we don't hit Cal.com on every page view.
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');

  if (!process.env.CAL_API_KEY) {
    return res.status(200).json({ ok: false, total: TOTAL, reason: 'no-key' });
  }

  try {
    // 1) Resolve the event-type id from its slug.
    const et = await getJson('/v2/event-types', '2024-06-14');
    const types = flattenEventTypes(et.json && et.json.data);

    // 2) Count non-cancelled bookings for that event type (v2, paginated).
    const match = types.find((t) => t.slug === SLUG);
    let booked = null;
    let pages = [];
    if (match) {
      booked = 0;
      let skip = 0;
      const take = 100;
      for (let i = 0; i < 20; i++) { // hard cap: 2000 bookings
        const bk = await getJson(
          `/v2/bookings?eventTypeId=${match.id}&take=${take}&skip=${skip}`,
          '2024-08-13'
        );
        const rows = (bk.json && bk.json.data) || [];
        pages.push({ status: bk.status, count: rows.length });
        booked += rows.filter(
          (b) => !DEAD.has(String(b.status || '').toLowerCase())
        ).length;
        if (rows.length < take) break;
        skip += take;
      }
    }

    // Temporary diagnostic: /api/founding-spots?debug=1
    if (req.query && req.query.debug) {
      return res.status(200).json({
        debug: true,
        eventTypesStatus: et.status,
        eventTypeTopKeys: et.json ? Object.keys(et.json) : [],
        slugs: types.map((t) => ({ id: t.id, slug: t.slug, title: t.title })),
        matchedId: match ? match.id : null,
        bookingPages: pages,
        booked,
      });
    }

    if (!match) {
      return res.status(200).json({ ok: false, total: TOTAL, reason: 'slug-not-found' });
    }

    const remaining = Math.max(0, TOTAL - booked);
    return res.status(200).json({ ok: true, total: TOTAL, booked, remaining });
  } catch (err) {
    return res.status(200).json({ ok: false, total: TOTAL, reason: 'error' });
  }
};
