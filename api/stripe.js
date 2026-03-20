const Stripe = require('stripe');

const AIRTABLE_BASE    = 'appdlxcWb45dIqNK2';
const AIRTABLE_TABLE   = 'Traveler';
const SUCCESS_URL      = 'https://transformedbytravels.vercel.app/portal.html?subscribed=1&session_id={CHECKOUT_SESSION_ID}';
const CANCEL_URL       = 'https://transformedbytravels.vercel.app/portal.html';

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

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  // POST — create checkout session
  if (req.method === 'POST') {
    const b     = req.body || {};
    const plan  = (b.plan  || '').toLowerCase();  // 'annual' or 'premium'
    const email = (b.email || '').toLowerCase().trim();
    if (!plan || !email) return res.status(400).json({ error: 'plan and email required' });

    const priceId = plan === 'premium'
      ? process.env.STRIPE_PRICE_ID_PREMIUM
      : process.env.STRIPE_PRICE_ID_ANNUAL;

    if (!priceId) return res.status(500).json({ error: 'Price ID not configured', plan, annual: !!process.env.STRIPE_PRICE_ID_ANNUAL, premium: !!process.env.STRIPE_PRICE_ID_PREMIUM });

    try {
      const session = await stripe.checkout.sessions.create({
        mode:                'subscription',
        payment_method_types: ['card'],
        customer_email:      email,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: SUCCESS_URL,
        cancel_url:  CANCEL_URL,
        metadata:    { email, plan }
      });
      return res.status(200).json({ url: session.url });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — verify session after successful payment and activate subscription
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
      const plan       = session.metadata.plan  || 'annual';
      const customerId = session.customer;
      const sub        = session.subscription;
      const endDate    = sub && sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString().split('T')[0]
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const dnaQueries = plan === 'premium' ? 25 : 10;

      airtableFind(email, (err, record) => {
        if (err || !record) return res.status(200).json({ success: false, reason: 'traveler not found' });

        const fields = {
          'Subscription Active':   true,
          'Subscription End Date': endDate,
          'Subscription Plan':     plan === 'premium' ? 'Premium' : 'Annual',
          'Stripe Customer ID':    customerId,
          'DNA Queries Remaining': dnaQueries
        };

        airtablePatch(record.id, fields, (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.status(200).json({ success: true, plan, endDate });
        });
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
