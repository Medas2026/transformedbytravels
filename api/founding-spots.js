// api/founding-spots.js
// Returns how many Founding Member consult spots remain, based on real
// Cal.com bookings for the founding-consult event type (a normal recurring
// event type / "Link" owned by the account, at cal.com/<user>/founding-consult).
//
// Uses Cal.com API v2 (v1 is retired → HTTP 410). We resolve the event type's
// numeric id from its slug, then count non-cancelled bookings for that id. This
// deliberately excludes the old one-time "Event" (a different object/id) that
// held the Aug-18 test booking, so a fresh launch reads a clean 30/30.
//
// Env:
//   CAL_API_KEY     (required) — Cal.com API key (Settings → Developer → API Keys)
//   FOUNDING_TOTAL  (optional) — total spots offered; defaults to 30
//   FOUNDING_SLUG   (optional) — event-type slug; defaults to 'founding-consult'
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
          catch (e) { resolve({ status: res.statusCode, json: {} }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Cal.com request timed out')));
    req.end();
  });
}

// v2 event-type payloads can be a flat array or grouped; collect {id, slug}.
function flattenEventTypes(data) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      if (node.slug && node.id !== undefined) out.push({ id: node.id, slug: node.slug });
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
    // Resolve the event-type numeric id from its slug (owner-scoped).
    const me = await getJson('/v2/me', '2024-06-14');
    const username = me.json && me.json.data && me.json.data.username;
    const u = encodeURIComponent(username || '');
    let types = flattenEventTypes(
      (await getJson(`/v2/event-types?username=${u}&eventSlug=${encodeURIComponent(SLUG)}`, '2024-06-14')).json?.data
    );
    if (!types.length) {
      types = flattenEventTypes((await getJson(`/v2/event-types?username=${u}`, '2024-06-14')).json?.data);
    }
    const match = types.find((t) => t.slug === SLUG);
    const eventTypeId = match ? match.id : null;

    // Page through bookings, counting non-cancelled ones for our event.
    // Prefer matching the resolved numeric id (excludes the retired one-time
    // event's bookings); fall back to slug if the id couldn't be resolved.
    let booked = 0;
    let skip = 0;
    const take = 100;
    for (let i = 0; i < 20; i++) { // hard cap: 2000 bookings
      const bk = await getJson(`/v2/bookings?take=${take}&skip=${skip}`, '2024-08-13');
      const rows = (bk.json && bk.json.data) || [];
      booked += rows.filter((b) => {
        const status = String(b.status || '').toLowerCase();
        if (DEAD.has(status)) return false;
        return eventTypeId ? b.eventTypeId === eventTypeId : (b.eventType && b.eventType.slug === SLUG);
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
