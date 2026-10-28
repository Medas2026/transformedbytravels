// Returns the assessment questions from the Airtable "TFG Items" table.
// Sorted by Item Number.
//
// Usage:
//   GET /api/assessment-questions
//
// Response:
//   {
//     questions: [
//       {
//         id, dimension, itemNumber, optionA, optionB,
//         highlight, optionACoachingText, optionBCoachingText
//       },
//       ...
//     ]
//   }

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'TFG Items';

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
      const params = new URLSearchParams();
      if (offset) params.set('offset', offset);
      params.set('sort[0][field]',     'Item Number');
      params.set('sort[0][direction]', 'asc');
      params.set('pageSize',           '100');
      const data = await airtableGet('?' + params.toString());
      if (data.error) return res.status(500).json({ error: data.error.message });
      records.push(...(data.records || []));
      offset = data.offset || '';
    } while (offset);

    const questions = records.map(r => {
      const f = r.fields || {};
      return {
        id:                    r.id,
        dimension:             f['Dimension']              || '',
        itemNumber:            f['Item Number']            ?? null,
        optionA:               f['Option A']               || '',
        optionB:               f['Option B']               || '',
        highlight:             f['Highlight Item'] === true,
        optionACoachingText:   f['Option A Coaching Text'] || '',
        optionBCoachingText:   f['Option B Coaching Text'] || '',
      };
    }).filter(q => q.itemNumber != null && q.dimension && q.optionA && q.optionB);

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ questions });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
