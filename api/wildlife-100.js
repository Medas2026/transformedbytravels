// Returns published Wildlife 100 episodes from the Species table,
// sorted by Wildlife 100 Publish Date (newest first).
//
// Usage:  GET /api/wildlife-100
//         GET /api/wildlife-100?realm=Land  (filter by realm)

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'tblYtFaj6UYMUEwFQ';

async function at(path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY }
  });
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { realm } = req.query;
  const filters = [`NOT({Wildlife 100 Publish Date}="")`];
  if (realm) filters.push(`{Realm}="${realm.replace(/"/g,'')}"`);
  const formula = filters.length > 1 ? `AND(${filters.join(',')})` : filters[0];

  const qs = `?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=${encodeURIComponent('Wildlife 100 Publish Date')}&sort[0][direction]=desc`;

  try {
    let all = [], offset = '';
    do {
      const data = await at(qs + (offset ? `&offset=${offset}` : ''));
      if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
      all = all.concat(data.records || []);
      offset = data.offset || '';
    } while (offset);

    const episodes = all.map(r => {
      const f = r.fields || {};
      const rawParks = f['Best Parks'];
      const bestParks = Array.isArray(rawParks) ? rawParks
                      : (rawParks || '').split(',').map(s => s.trim()).filter(Boolean);
      return {
        id:              r.id,
        name:            f['Species Name'] || '',
        description:     f['Description']  || '',
        photoUrl:        f['Photo URL']    || '',
        realm:           f['Realm']        || '',
        top100Num:       f['Top 100 #']    || null,
        publishDate:     f['Wildlife 100 Publish Date'] || '',
        bestParks,
        wonderYouTube:     f['Wonder YouTube URL']     || '',
        experienceYouTube: f['Experience YouTube URL'] || '',
        actionYouTube:     f['Action YouTube URL']     || '',
      };
    });

    return res.status(200).json({ episodes });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
