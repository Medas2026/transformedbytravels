const Stripe = require('stripe');

const AIRTABLE_BASE  = 'appdlxcWb45dIqNK2';
const AIRTABLE_TABLE = 'Traveler';

const PLAN_BY_PRICE = {
  [process.env.STRIPE_PRICE_ID_ANNUAL]:   { label: 'Annual',  dna: 10, trips: 1, status: 'Annual'  },
  [process.env.STRIPE_PRICE_ID_PREMIUM]:  { label: 'Premium', dna: 25, trips: 5, status: 'Premium' },
  [process.env.STRIPE_PRICE_ID_COUPLES]:  { label: 'Couples', dna: 50, trips: 5, status: 'Couples' },
  [process.env.STRIPE_PRICE_ID_MONTHLY]:  { label: 'Monthly', dna:  5, trips: 1, status: 'Monthly' }
};

function airtableFind(email) {
  return new Promise((resolve, reject) => {
    const https  = require('https');
    const apiKey = process.env.AIRTABLE_API_KEY;
    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}${filter}`,
      method:   'GET',
      headers:  { 'Authorization': 'Bearer ' + apiKey }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          resolve((parsed.records || [])[0] || null);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function airtablePatch(recordId, fields) {
  return new Promise((resolve, reject) => {
    const https   = require('https');
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const bodyStr = JSON.stringify({ fields });
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}/${recordId}`,
      method:   'PATCH',
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

const ORDERS_TABLE = 'Calendar Orders';

function airtableCreate(table, fields) {
  return new Promise((resolve, reject) => {
    const https   = require('https');
    const bodyStr = JSON.stringify({ fields, typecast: true });
    const req = https.request({
      hostname: 'api.airtable.com',
      path:     `/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`,
      method:   'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.write(bodyStr); req.end();
  });
}

function airtableFindIn(table, formula) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request({
      hostname: 'api.airtable.com',
      path:     `/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}`,
      method:   'GET',
      headers:  { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY },
    }, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve((JSON.parse(d).records || [])[0] || null); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.end();
  });
}

function sendOrderEmail(order) {
  return new Promise((resolve) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return resolve();
    const html = `<h2>New calendar order</h2>
      <p><strong>${order.summary}</strong><br>${order.total} calendars &mdash; $${order.amount}</p>
      <p><strong>Customer:</strong> ${order.name} (${order.email})${order.phone ? ' &middot; ' + order.phone : ''}</p>
      <p><strong>Ship to:</strong><br>${String(order.shipping || '').replace(/\n/g, '<br>')}</p>
      <p style="color:#888">Stripe session ${order.session}</p>`;
    const bodyStr = JSON.stringify({
      from:    'Three Realms Store <orders@transformedbytravels.com>',
      to:      ['MichaelE@transformedbytravels.com'],
      subject: `Calendar order (${order.total}): ${order.name} — ${order.summary}`,
      html,
    });
    const https = require('https');
    const req = https.request({ hostname: 'api.resend.com', path: '/emails', method: 'POST', headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } },
      (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve()); });
    req.on('error', () => resolve()); req.write(bodyStr); req.end();
  });
}

// Vercel requires raw body for Stripe signature verification
export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const stripe  = Stripe(process.env.STRIPE_SECRET_KEY);
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch(e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: 'Webhook signature invalid: ' + e.message });
  }

  console.log('Stripe webhook event:', event.type);

  try {
    // ── Subscription renewed ────────────────────────────────────────────────
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;

      // Only process subscription renewals (not the initial payment — handled by verify)
      if (invoice.billing_reason !== 'subscription_cycle') {
        return res.status(200).json({ received: true, skipped: 'initial payment' });
      }

      const email      = invoice.customer_email || '';
      const priceId    = invoice.lines && invoice.lines.data[0] && invoice.lines.data[0].price && invoice.lines.data[0].price.id;
      const planConfig = PLAN_BY_PRICE[priceId];
      const endDate    = invoice.lines && invoice.lines.data[0] && invoice.lines.data[0].period
        ? new Date(invoice.lines.data[0].period.end * 1000).toISOString().split('T')[0]
        : null;

      if (!email) { console.error('No email on invoice'); return res.status(200).json({ received: true }); }
      if (!planConfig) { console.error('Unknown price ID:', priceId); return res.status(200).json({ received: true }); }

      const record = await airtableFind(email);
      if (!record) { console.error('Traveler not found:', email); return res.status(200).json({ received: true }); }

      await airtablePatch(record.id, {
        'Subscription Active':   true,
        'Subscription End Date': endDate,
        'Package Status':        planConfig.status,
        'DNA Guides Remaining':  planConfig.dna,
        'Trips Remaining':       planConfig.trips
      });

      console.log('Renewed:', email, planConfig.label, endDate);
    }

    // ── Subscription cancelled / payment failed ─────────────────────────────
    if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      const obj   = event.data.object;
      const email = obj.customer_email || (obj.customer_details && obj.customer_details.email) || '';

      if (email) {
        const record = await airtableFind(email);
        if (record) {
          await airtablePatch(record.id, {
            'Subscription Active': false,
            'Package Status':      'Free'
          });
          console.log('Deactivated:', email, event.type);
        }
      }
    }

    // ── Store: calendar order (one-time payment) ────────────────────────────
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      if (s.metadata && s.metadata.type === 'calendar') {
        // Idempotency — Stripe may retry; don't double-record.
        const existing = await airtableFindIn(ORDERS_TABLE, `{Stripe Session ID}="${s.id}"`);
        if (existing) { console.log('Calendar order already recorded:', s.id); return res.status(200).json({ received: true, dup: true }); }

        const cd = s.customer_details || {};
        const sd = s.shipping_details || s.shipping || {};
        const a  = sd.address || {};
        const shipping = [
          sd.name || cd.name || '',
          a.line1, a.line2,
          [a.city, a.state, a.postal_code].filter(Boolean).join(', '),
          a.country,
        ].filter(Boolean).join('\n');
        const amount = (s.amount_total != null) ? (s.amount_total / 100).toFixed(2) : '';

        await airtableCreate(ORDERS_TABLE, {
          'Order Date':         new Date().toISOString().split('T')[0],
          'Items':              s.metadata.summary || '',
          'Total Quantity':     Number(s.metadata.total || 0),
          'Amount':             Number(amount) || 0,
          'Customer Name':      cd.name || sd.name || '',
          'Customer Email':     cd.email || '',
          'Phone':              cd.phone || '',
          'Shipping Address':   shipping,
          'Stripe Session ID':  s.id,
          'Fulfillment Status': 'New',
        });
        await sendOrderEmail({ summary: s.metadata.summary || '', total: s.metadata.total || 0, amount, name: cd.name || sd.name || '', email: cd.email || '', phone: cd.phone || '', shipping, session: s.id });
        console.log('Calendar order recorded:', s.id, s.metadata.summary, s.metadata.total);
      }
    }

  } catch(e) {
    console.error('Webhook handler error:', e.message);
    // Still return 200 so Stripe doesn't retry endlessly
    return res.status(200).json({ received: true, error: e.message });
  }

  return res.status(200).json({ received: true });
};
