const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Animal Regions';

async function airtableGet(path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const records = [];
    let offset = '';
    do {
      const qs = offset ? `?offset=${offset}` : '';
      const data = await airtableGet(qs);
      if (data.error) return res.status(500).json({ error: data.error.message });
      records.push(...(data.records || []));
      offset = data.offset || '';
    } while (offset);

    const regions = records
      .filter(r => r.fields['Lattitude'] != null && r.fields['Longitude'] != null)
      .map(r => ({
        name:       r.fields['Region'],
        lat:        r.fields['Lattitude'],
        lng:        r.fields['Longitude'],
        land:       r.fields['Land']  || 0,
        ocean:      r.fields['Ocean'] || 0,
        sky:        r.fields['Sky']   || 0,
        landDesc:   r.fields['Land Description']  || '',
        oceanDesc:  r.fields['Ocean Description'] || '',
        skyDesc:    r.fields['Sky Description']   || '',
        heroPhoto:  r.fields['Hero Photo']        || '',
        bestMonths:       Array.isArray(r.fields['Best Months'])   ? r.fields['Best Months']   : [],
        avoidMonths:      Array.isArray(r.fields['Avoid Months'])  ? r.fields['Avoid Months']  : [],
        seasonalityNotes: r.fields['Seasonality Notes']            || '',
        coachVisited: r.fields['Coach Visited'] === true,
      }));

    return res.status(200).json({ regions });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
