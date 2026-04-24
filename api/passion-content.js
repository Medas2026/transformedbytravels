const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Passion Content';

function airtableGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.airtable.com',
      path,
      method:  'GET',
      headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const qs      = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const p       = new URLSearchParams(qs);
    const passion  = (p.get('passion') || '').trim();
    const archetype = (p.get('archetype') || '').trim();

    if (!passion) return res.status(400).json({ error: 'passion required' });

    // Fetch all rows for this passion
    const filter  = encodeURIComponent(`{Passion} = "${passion}"`);
    const encoded = encodeURIComponent(TABLE_NAME);
    const result  = await airtableGet(`/v0/${BASE_ID}/${encoded}?filterByFormula=${filter}&maxRecords=10`);
    const records = result.records || [];

    if (!records.length) return res.status(200).json(null);

    // Find archetype-specific row, fall back to base row
    let row = records.find(r => (r.fields['Archetype'] || '').trim() === archetype);
    if (!row) row = records.find(r => !(r.fields['Archetype'] || '').trim());
    if (!row) row = records[0];

    const f = row.fields;
    return res.status(200).json({
      passion:            passion,
      archetype:          f['Archetype']         || '',
      articleTitle:       f['Article Title']       || '',
      introArticle:       f['Intro Article']      || '',
      featuredDestination:f['Featured Destination']|| '',
      destinationTitle:   f['Destination Title']  || '',
      featuredArticle:    f['Featured Article']   || '',
      heroImageUrl:       f['Hero Image URL']     || '',
      featuredImageUrl:   f['Featured Image URL'] || '',
    });

  } catch(e) {
    console.error('passion-content error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
