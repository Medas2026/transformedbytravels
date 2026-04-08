const https = require('https');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Traveler';

function airtableGet(filter) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const options = {
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${filter}`,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function airtablePatch(recordId, fields) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const body   = JSON.stringify({ fields });
    const options = {
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${recordId}`,
      method: 'PATCH',
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          if (res.statusCode >= 400) reject(new Error('Airtable error ' + res.statusCode + ': ' + JSON.stringify(parsed.error)));
          else resolve(parsed);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ error: 'email and code required' });

    // Validate code against environment variable (case-insensitive)
    const validCode = (process.env.PROMO_CODE || '').trim().toUpperCase();
    if (!validCode) return res.status(500).json({ error: 'No promo code configured' });
    if (code.trim().toUpperCase() !== validCode) {
      return res.status(400).json({ error: 'That code doesn\'t look right — please double-check and try again.' });
    }

    // Check code expiry (Aug 31, 2026)
    const EXPIRY = new Date('2026-09-01'); // exclusive upper bound
    if (new Date() >= EXPIRY) {
      return res.status(400).json({ error: 'Sorry, that promo code has expired.' });
    }

    // Look up traveler
    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email.toLowerCase()}")`)}`;
    const data   = await airtableGet(filter);
    const record = (data.records || [])[0];
    if (!record) return res.status(404).json({ error: 'We couldn\'t find your account. Please make sure you\'re signed in.' });

    // Check not already subscribed
    const f = record.fields;
    if (f['Subscription Active']) {
      return res.status(400).json({ error: 'You already have an active subscription — you\'re all set!' });
    }

    // Grant free Monthly subscription through Aug 31, 2026
    const endDateStr = '2026-08-31';

    await airtablePatch(record.id, {
      'Subscription Active':   true,
      'Subscription End Date': endDateStr,
      'Package Status':        'Monthly',
      'DNA Guides Remaining':  5,
      'Trips Remaining':       1,
      'Acquisition Promo':     code.trim().toUpperCase()
    });

    return res.status(200).json({ success: true, endDate: endDateStr });
  } catch(e) {
    console.error('promo error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
