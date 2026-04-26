const BASE_ID = 'appdlxcWb45dIqNK2';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tripId = (req.query.tripId || '').trim();
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  const apiKey = process.env.AIRTABLE_API_KEY;
  const filter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}` +
    `&sort[0][field]=Key%20Date&sort[0][direction]=asc`;
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Reservations')}${filter}`;

  try {
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey } });
    const data = await resp.json();
    return res.status(200).json({ records: data.records || [] });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
