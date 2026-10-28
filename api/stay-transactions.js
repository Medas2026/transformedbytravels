// api/stay-transactions.js — the reservation transaction log, scoped to one property.
//
// GET  ?email=<signed-in address>[&lodge=<recId>][&only=review]
// POST { email, id, action: 'reviewed' }   — clear a transaction off the review list
//
// Scoping follows the same rule as the dashboard: a property sees its own transactions,
// an address in ADMIN_EMAILS may name any property.
const BASE_ID  = 'appdlxcWb45dIqNK2';
const PROPERTY = 'Property';
const TRAVELER = 'Traveler';
const STAY_TX  = 'Stay Transactions';

async function at(table, path = '', method = 'GET', body = null) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const esc = s => String(s == null ? '' : s).replace(/"/g, '\\"');

// Resolve the caller to a property — contact address first, then the staff link.
async function propertyFor(email, asLodge, isAdmin) {
  if (isAdmin && asLodge) {
    if (/^rec[A-Za-z0-9]{14}$/.test(asLodge)) {
      const r = await at(PROPERTY, `/${asLodge}`);
      return r.error ? null : r;
    }
    return ((await at(PROPERTY,
      `?filterByFormula=${encodeURIComponent(`LOWER({Contact Email})="${esc(asLodge.toLowerCase())}"`)}&maxRecords=1`)).records || [])[0] || null;
  }
  const byContact = ((await at(PROPERTY,
    `?filterByFormula=${encodeURIComponent(`LOWER({Contact Email})="${esc(email)}"`)}&maxRecords=1`)).records || [])[0];
  if (byContact) return byContact;

  const me = ((await at(TRAVELER,
    `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${esc(email)}"`)}&maxRecords=1`)).records || [])[0];
  const link = me && (me.fields['Property'] || me.fields['Properties 2']);
  if (Array.isArray(link) && link[0]) {
    const r = await at(PROPERTY, `/${link[0]}`);
    if (!r.error) return r;
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const email = String(q.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email required' });

  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
  const isAdmin = admins.includes(email);
  const asLodge = String(q.lodge || '').trim();

  try {
    // An admin with no property named sees everything — unresolved transactions have no
    // property at all, and those are precisely the ones that need the operator.
    const seeAll = isAdmin && !asLodge;
    let prop = null;
    if (!seeAll) {
      prop = await propertyFor(email, asLodge, isAdmin);
      if (!prop) return res.status(403).json({ error: 'not-a-lodge' });
    }

    if (req.method === 'POST') {
      const id = String(q.id || '').trim();
      if (!id) return res.status(400).json({ error: 'id required' });
      const rec = await at(STAY_TX, `/${id}`);
      if (rec.error) return res.status(404).json({ error: 'not found' });
      const owner = Array.isArray(rec.fields['Property']) ? rec.fields['Property'][0] : null;
      if (!seeAll && owner !== prop.id) return res.status(403).json({ error: 'not yours' });
      const upd = await at(STAY_TX, `/${id}`, 'PATCH', { fields: { 'Status': 'Reviewed' } });
      if (upd.error) return res.status(500).json({ error: upd.error.message });
      return res.status(200).json({ ok: true });
    }

    const params = new URLSearchParams({
      'sort[0][field]': 'Received At', 'sort[0][direction]': 'desc', maxRecords: '200',
    });
    const all = ((await at(STAY_TX, '?' + params.toString())).records || [])
      // Airtable seeds a new table with blank rows, and a hand-edited one collects them.
      // A transaction with no arrival time and no action never came from an email.
      .filter(r => r.fields['Received At'] || r.fields['Message ID']);
    const mine = seeAll ? all : all.filter(r =>
      Array.isArray(r.fields['Property']) && r.fields['Property'].includes(prop.id));

    const rows = mine.map(r => {
      const f = r.fields;
      return {
        id: r.id,
        receivedAt: f['Received At'] || '',
        action: f['Action'] || 'Unknown',
        status: f['Status'] || '',
        guest: f['Guest Name'] || f['Guest Email'] || '',
        guestEmail: f['Guest Email'] || '',
        reservation: f['Reservation Number'] || '',
        arrival: f['Arrival'] || '',
        departure: f['Departure'] || '',
        nights: f['Nights'] || null,
        summary: f['Name'] || '',
        changes: f['Changes'] || '',
        issue: f['Issue'] || '',
        subject: f['Subject'] || '',
        fromEmail: f['From Email'] || '',
        tripId: Array.isArray(f['Trips']) ? f['Trips'][0] : null,
        propertyId: Array.isArray(f['Property']) ? f['Property'][0] : null,
      };
    });

    const needsReview = rows.filter(r => r.status === 'Needs Review' || r.status === 'Failed');
    return res.status(200).json({
      scope: seeAll ? 'all' : prop.fields['Name'],
      counts: {
        total: rows.length,
        needsReview: needsReview.length,
        applied: rows.filter(r => r.status === 'Applied').length,
        last7: rows.filter(r => r.receivedAt && (Date.now() - new Date(r.receivedAt)) < 7 * 86400000).length,
      },
      rows: String(q.only || '') === 'review' ? needsReview : rows,
    });
  } catch (e) {
    console.error('[stay-transactions]', e.message);
    return res.status(500).json({ error: e.message });
  }
};

module.exports.config = { maxDuration: 30 };
