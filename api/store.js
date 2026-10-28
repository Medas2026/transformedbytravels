// api/store.js
// Three Realms Store back-end. Sells photography calendars; customers mix
// versions in one cart and pay by TOTAL quantity (volume pricing).
//   GET  /api/store                        → { calendars, pricing(1..20), maxTotal }
//   POST /api/store { items:[{slug,qty}] } → Stripe Checkout session
//
// Pricing is a single global schedule in the "Store Settings" table (a calendar
// costs the same regardless of version). Prices are set at breakpoints
// 1,2,3,4,5,10,15,20; in-between totals use the nearest lower tier's per-unit
// rate. Over 20 → customer is invited to contact for a bulk order.
const Stripe = require('stripe');
const https  = require('https');

const BASE           = 'appdlxcWb45dIqNK2';
const CAL_TABLE      = 'Calendars';
const SETTINGS_TABLE = 'Store Settings';
const PRICE_BREAKS   = [1, 2, 3, 4, 5, 10, 15, 20];
const MAX_TOTAL      = 20;
const SHIP_COUNTRIES = ['US', 'CA'];
const STORE_URL      = 'https://threerealmstravel.com/threerealms/store.html';

function airtableGet(table, path = '') {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.airtable.com',
      path: `/v0/${BASE}/${encodeURIComponent(table)}${path}`,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY },
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.end();
  });
}

function lines(field) {
  if (Array.isArray(field)) return field.map(a => (a && a.url) || a).filter(Boolean);
  // Split on line breaks ONLY — captions legitimately contain commas
  // (e.g. "Lake Louise, Banff NP"), so we must not split on commas.
  if (typeof field === 'string') return field.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return [];
}
function preview(url) {
  if (typeof url !== 'string' || !/res\.cloudinary\.com\/.+\/image\/upload\//.test(url)) return url;
  if (/\/image\/upload\/l_text/.test(url)) return url;
  const t = 'w_900,c_limit,q_auto,f_auto,l_text:Arial_38_bold:%C2%A9%20Three%20Realms%20Travel,co_white,o_55,g_south_east,x_24,y_18';
  return url.replace('/image/upload/', `/image/upload/${t}/`);
}
function mapCalendar(r) {
  const f = r.fields || {};
  const photos = lines(f['Photos']);
  return {
    slug:        f['Slug'] || '',
    title:       f['Title'] || '',
    description: f['Description'] || '',
    cover:       preview(lines(f['Cover Photo'])[0] || photos[0] || ''),
    photos:      photos.map(preview),
    captions:    lines(f['Photo Titles']),   // parallel to photos, line-by-line
    status:      f['Status'] || '',
  };
}
async function getSchedule() {
  const data = await airtableGet(SETTINGS_TABLE, '?maxRecords=1');
  const f = ((data.records || [])[0] || {}).fields || {};
  const sched = {};
  PRICE_BREAKS.forEach(q => { const v = f[`Price ${q}`]; if (v !== undefined && v !== null && v !== '') sched[q] = Number(v); });
  return sched;
}
// Price for any total 1..MAX_TOTAL: exact at a breakpoint, else the nearest
// lower breakpoint's per-unit rate × total.
function priceForTotal(n, sched) {
  if (sched[n] != null) return sched[n];
  const lower = PRICE_BREAKS.filter(b => b <= n && sched[b] != null);
  if (!lower.length) return null;
  const b = Math.max(...lower);
  let price = Math.round((sched[b] / b) * n * 100) / 100;
  // Never charge more than the next breakpoint up — so buying more is never cheaper.
  const upper = PRICE_BREAKS.filter(u => u >= n && sched[u] != null);
  if (upper.length) price = Math.min(price, sched[Math.min(...upper)]);
  return price;
}
// Full 1..MAX_TOTAL lookup for the client to display.
function fullPriceMap(sched) {
  const map = {};
  for (let n = 1; n <= MAX_TOTAL; n++) { const p = priceForTotal(n, sched); if (p != null) map[n] = p; }
  return map;
}
async function getCalendars() {
  const records = [];
  let offset = '';
  do {
    const data = await airtableGet(CAL_TABLE, `?pageSize=100${offset ? '&offset=' + encodeURIComponent(offset) : ''}`);
    if (data.error) throw new Error(data.error.message || 'airtable error');
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records.map(mapCalendar).filter(c => c.slug && c.title && c.status === 'Available');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const [calendars, sched] = await Promise.all([getCalendars(), getSchedule()]);
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
      return res.status(200).json({ calendars, pricing: fullPriceMap(sched), maxTotal: MAX_TOTAL });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
    const clean = items.map(i => ({ slug: String(i.slug || '').trim(), qty: parseInt(i.qty, 10) })).filter(i => i.slug && i.qty > 0);
    if (!clean.length) return res.status(400).json({ error: 'cart is empty' });
    const total = clean.reduce((n, i) => n + i.qty, 0);
    if (total > MAX_TOTAL) return res.status(400).json({ error: `For more than ${MAX_TOTAL} calendars, please contact us for a bulk order.` });

    try {
      const [calendars, sched] = await Promise.all([getCalendars(), getSchedule()]);
      const bySlug = Object.fromEntries(calendars.map(c => [c.slug, c]));
      for (const i of clean) if (!bySlug[i.slug]) return res.status(400).json({ error: `not available: ${i.slug}` });

      const price = priceForTotal(total, sched);
      if (price == null) return res.status(400).json({ error: `no price configured for ${total} calendars` });

      const summary = clean.map(i => `${bySlug[i.slug].title} × ${i.qty}`).join(', ');
      const cover   = bySlug[clean[0].slug].cover;

      const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(price * 100),
            product_data: {
              name: `${total} Three Realms ${total === 1 ? 'Calendar' : 'Calendars'}`,
              description: summary,
              images: cover ? [cover] : undefined,
            },
          },
        }],
        shipping_address_collection: { allowed_countries: SHIP_COUNTRIES },
        phone_number_collection: { enabled: true },
        success_url: `${STORE_URL}?ordered=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url:  `${STORE_URL}?canceled=1`,
        metadata: { type: 'calendar', summary, total: String(total) },
      });
      return res.status(200).json({ url: session.url });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
