// Returns the currently-active promotional offer for a given site.
// Reads from the Airtable "Offer Presentation" table.
//
// Usage:  GET /api/offer-presentation?site=threerealms
//         GET /api/offer-presentation?site=tbt

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Offer Presentation';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const site = String(req.query.site || 'threerealms').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Active + site match + optional date range (using Airtable's TODAY() for
  // reliable date-object comparison instead of string comparison)
  const formula = `AND(
    {Active}=TRUE(),
    FIND("${site}", ARRAYJOIN({Show On}, ","))>0,
    OR({Start Date}="", NOT(IS_AFTER({Start Date}, TODAY()))),
    OR({End Date}="", NOT(IS_BEFORE({End Date}, TODAY())))
  )`.replace(/\s+/g, ' ');

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=${encodeURIComponent('Rotation Priority')}&sort[0][direction]=asc&maxRecords=5`;
    const resp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY }
    });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });

    const records = data.records || [];
    if (!records.length) return res.status(200).json({ offers: [] });

    const offers = records.map(rec => {
      const f = rec.fields || {};
      return {
        id:              rec.id,
        name:            f['Name']             || '',
        imageUrl:        f['Image URL']        || '',
        altText:         f['Alt Text']         || '',
        linkUrl:         f['Link URL']         || '',
        dismissForDays:  f['Dismiss For Days'] || 7,
        rotationSeconds: f['Rotation Seconds'] || 5,
      };
    });

    return res.status(200).json({ offers });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
