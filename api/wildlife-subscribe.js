// Save a Wildlife 100 series subscriber to Airtable.
//
// Usage:  POST /api/wildlife-subscribe
//   body: { email, realmPreference, ref }

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Wildlife 100 Subscribers';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')     return res.status(405).json({ error: 'Method not allowed' });

  const b     = req.body || {};
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const realm = String(b.realmPreference || 'All').trim().slice(0, 20);
  const ref   = String(b.ref || '').trim().slice(0, 100);

  if (!email || !/@/.test(email)) {
    return res.status(400).json({ error: 'valid email required' });
  }
  const validRealms = ['All', 'Land', 'Ocean', 'Sky'];
  const realmValue  = validRealms.includes(realm) ? realm : 'All';

  try {
    // Check for duplicate — if same email exists, update realm preference and reactivate
    const filter = `?filterByFormula=${encodeURIComponent(`LOWER({Email})="${email}"`)}&maxRecords=1`;
    const dupResp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${filter}`, {
      headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY }
    });
    const dupData = await dupResp.json();
    if (dupData.error) return res.status(500).json({ error: dupData.error.message || JSON.stringify(dupData.error) });

    const existing = (dupData.records || [])[0];
    if (existing) {
      // Update realm preference + reactivate if previously unsubscribed
      const patchResp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${existing.id}`, {
        method:  'PATCH',
        headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            'Realm Preference': realmValue,
            'Status':           'Active',
          }
        }),
      });
      const patchData = await patchResp.json();
      if (patchData.error) return res.status(500).json({ error: patchData.error.message || JSON.stringify(patchData.error) });
      return res.status(200).json({ success: true, updated: true, id: existing.id });
    }

    // New subscriber
    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`, {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          'Email':            email,
          'Realm Preference': realmValue,
          'Source Ref':       ref,
          'Status':           'Active',
          'Subscribed At':    new Date().toISOString(),
        }
      }),
    });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
    return res.status(200).json({ success: true, id: data.id });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
