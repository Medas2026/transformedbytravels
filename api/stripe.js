const Stripe = require('stripe');

const AIRTABLE_BASE  = 'appdlxcWb45dIqNK2';
const AIRTABLE_TABLE = 'Traveler';
const SUCCESS_URL    = 'https://app.transformedbytravels.com/portal.html?subscribed=1&session_id={CHECKOUT_SESSION_ID}';
const CANCEL_URL     = 'https://app.transformedbytravels.com/portal.html';

// Plan config — single source of truth
const PLANS = {
  annual:   { label: 'Annual',   dna: 10, trips: 1, status: 'Annual',  mode: 'subscription' },
  premium:  { label: 'Premium',  dna: 25, trips: 5, status: 'Premium', mode: 'subscription' },
  couples:  { label: 'Couples',  dna: 50, trips: 5, status: 'Couples', mode: 'subscription' },
  monthly:  { label: 'Monthly',  dna:  5, trips: 1, status: 'Monthly', mode: 'subscription' },
  dna_topup:{ label: 'DNA Top-up', dna: 25, trips: 0, status: null,   mode: 'payment' }
};

function priceIdForPlan(plan) {
  const map = {
    annual:    process.env.STRIPE_PRICE_ID_ANNUAL,
    premium:   process.env.STRIPE_PRICE_ID_PREMIUM,
    couples:   process.env.STRIPE_PRICE_ID_COUPLES,
    monthly:   process.env.STRIPE_PRICE_ID_MONTHLY,
    dna_topup: process.env.STRIPE_PRICE_DNATOPUP || 'price_1TJfFbB0u7QeMpM7nlhCU5wK'
  };
  return map[plan] || null;
}

function airtablePatch(recordId, fields, callback) {
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
  const req = require('https').request(options, (res) => {
    let d = '';
    res.on('data', c => { d += c; });
    res.on('end', () => { try { callback(null, JSON.parse(d)); } catch(e) { callback(e); } });
  });
  req.on('error', callback);
  req.write(bodyStr);
  req.end();
}

function airtableFind(email, callback) {
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
        callback(null, (parsed.records || [])[0] || null);
      } catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let stripe;
  try {
    stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  } catch(e) {
    return res.status(500).json({ error: 'Stripe init failed: ' + e.message });
  }

  // ── POST: create checkout session ────────────────────────────────────────────
  if (req.method === 'POST') {
    const b     = req.body || {};
    const plan  = (b.plan  || '').toLowerCase();
    const email = (b.email || '').toLowerCase().trim();
    if (!plan || !email) return res.status(400).json({ error: 'plan and email required' });

    const planConfig = PLANS[plan];
    if (!planConfig) return res.status(400).json({ error: 'Unknown plan: ' + plan });

    const priceId = priceIdForPlan(plan);
    console.log('stripe checkout v3: plan=', plan, 'priceId=', priceId);
    if (!priceId) return res.status(500).json({ error: 'Price ID not configured for plan: ' + plan, v: 3, env_check: { dna_topup: !!process.env.STRIPE_PRICE_DNATOPUP, annual: !!process.env.STRIPE_PRICE_ID_ANNUAL }, dna_topup_val: (process.env.STRIPE_PRICE_DNATOPUP || '').slice(0,12) });

    try {
      const session = await stripe.checkout.sessions.create({
        mode:                 planConfig.mode,
        payment_method_types: ['card'],
        customer_email:       email,
        line_items:           [{ price: priceId, quantity: 1 }],
        success_url:          SUCCESS_URL,
        cancel_url:           CANCEL_URL,
        metadata:             { email, plan }
      });
      return res.status(200).json({ url: session.url });
    } catch(e) {
      return res.status(500).json({ error: e.message, type: e.type, code: e.code });
    }
  }

  // ── GET: verify session after successful payment ─────────────────────────────
  if (req.method === 'GET' && req.query.action === 'verify') {
    const sessionId = (req.query.session_id || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['subscription']
      });

      if (session.payment_status !== 'paid') {
        return res.status(200).json({ success: false, reason: 'not paid' });
      }

      const email      = session.metadata.email || (session.customer_details && session.customer_details.email) || '';
      const plan       = (session.metadata.plan || 'annual').toLowerCase();
      const planConfig = PLANS[plan] || PLANS.annual;
      const customerId = session.customer;

      // Subscription end date (recurring) or null (one-time)
      const sub     = session.subscription;
      const endDate = sub && sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString().split('T')[0]
        : null;

      airtableFind(email, (err, record) => {
        if (err || !record) return res.status(200).json({ success: false, reason: 'traveler not found' });

        const f = record.fields;

        if (plan === 'dna_topup') {
          // Top-up: add 25 guides to existing balance, don't touch subscription fields
          const currentRemaining = Number(f['DNA Guides Remaining'] || 0);
          const fields = {
            'DNA Guides Remaining': currentRemaining + planConfig.dna,
            'Stripe Customer ID':   customerId
          };
          airtablePatch(record.id, fields, (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.status(200).json({ success: true, plan, added: planConfig.dna });
          });
        } else {
          // Subscription plan — activate / update
          const fields = {
            'Subscription Active':   true,
            'Subscription End Date': endDate,
            'Package Status':        planConfig.status,
            'Stripe Customer ID':    customerId,
            'DNA Guides Remaining':  planConfig.dna,
            'Trips Remaining':       planConfig.trips
          };
          airtablePatch(record.id, fields, (err2) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.status(200).json({ success: true, plan, endDate });
          });
        }
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
