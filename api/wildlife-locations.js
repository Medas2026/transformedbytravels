const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Wildlife Locations';

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

  const { region } = req.query;

  try {
    const records = [];
    let offset = '';
    do {
      const params = new URLSearchParams();
      if (offset) params.set('offset', offset);
      if (region) params.set('filterByFormula', `{Region} = "${region.replace(/"/g, '\\"')}"`);
      params.set('sort[0][field]', 'Location Name');
      params.set('sort[0][direction]', 'asc');

      const qs = params.toString() ? '?' + params.toString() : '';
      const data = await airtableGet(qs);
      if (data.error) return res.status(500).json({ error: data.error.message });
      records.push(...(data.records || []));
      offset = data.offset || '';
    } while (offset);

    const locations = records.map(r => ({
      id:          r.id,
      name:        r.fields['Location Name']  || '',
      region:      r.fields['Region']         || '',
      continent:   r.fields['Continent']      || '',
      country:     r.fields['Country']        || '',
      land:        !!r.fields['Land'],
      ocean:       !!r.fields['Ocean'],
      sky:         !!r.fields['Sky'],
      lat:         r.fields['Latitude']       || null,
      lng:         r.fields['Longitude']      || null,
      description: r.fields['Description']   || '',
      parkType:    r.fields['Park Type']      || '',
    }));

    return res.status(200).json({ locations });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
