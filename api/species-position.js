const BASE_ID = 'appdlxcWb45dIqNK2';
const VALID_POSITIONS = new Set(['left center','center top','center center','center bottom','right center']);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, position } = req.body || {};
  if (!id || !position) return res.status(400).json({ error: 'Missing id or position' });
  if (!VALID_POSITIONS.has(position)) return res.status(400).json({ error: 'Invalid position' });

  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('TBT Wildlife')}`, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ id, fields: { 'Photo Position': position } }] }),
  });
  const data = await resp.json();
  if (data.error) return res.status(500).json({ error: data.error.message });
  return res.status(200).json({ ok: true });
};
