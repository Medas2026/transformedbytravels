const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Trip Reports';

async function airtableGet(path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

const SECTION_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K'];

function buildSections(f) {
  return SECTION_LETTERS
    .map(L => {
      const subtitle = (f[`Subtitle ${L}`] || '').trim();
      if (!subtitle) return null;
      const summary  = f[`Summary ${L}`] || '';
      const photos   = [1,2,3,4]
        .map(n => (f[`Photo ${L}${n}`] || '').trim())
        .filter(Boolean);
      return { letter: L, subtitle, summary, photos };
    })
    .filter(Boolean);
}

function shapeReport(r) {
  const f = r.fields || {};
  return {
    id:               r.id,
    destination:      f['Destination'] || '',
    title:            f['Title']       || '',
    tripSummary:      f['Trip Summary'] || '',
    heroPhoto:        f['Hero Photo']   || '',
    sections:         buildSections(f),
    closingHeadline:  f['Closing Headline'] || '',
    closingPhoto:     f['Closing Photo']    || '',
    closingSummary:   f['Closing Summary']  || '',
  };
}

function shapeListItem(r) {
  const f = r.fields || {};
  return {
    id:          r.id,
    destination: f['Destination'] || '',
    title:       f['Title']       || '',
    heroPhoto:   f['Hero Photo']   || '',
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { destination } = req.query;

  try {
    const records = [];
    let offset = '';
    do {
      const params = new URLSearchParams();
      if (offset) params.set('offset', offset);
      if (destination) {
        params.set('filterByFormula',
          `LOWER({Destination}) = LOWER("${destination.replace(/"/g, '\\"')}")`);
      }
      params.set('sort[0][field]', 'Destination');
      params.set('sort[0][direction]', 'asc');

      const qs   = params.toString() ? '?' + params.toString() : '';
      const data = await airtableGet(qs);
      if (data.error) return res.status(500).json({ error: data.error.message });
      records.push(...(data.records || []));
      offset = data.offset || '';
    } while (offset);

    res.setHeader('Cache-Control', 'public, max-age=300');

    if (destination) {
      const report = records.length ? shapeReport(records[0]) : null;
      return res.status(200).json({ report });
    }
    // List view: drop draft/empty records (no Destination)
    const reports = records.map(shapeListItem).filter(r => r.destination);
    return res.status(200).json({ reports });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
