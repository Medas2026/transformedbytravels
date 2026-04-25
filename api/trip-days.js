const https = require('https');

const BASE_ID     = 'appdlxcWb45dIqNK2';
const TABLE_NAME  = 'Trip Days';

function airtableRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${path}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Batch-create up to 10 records at a time (Airtable limit)
async function batchCreate(records) {
  const results = [];
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const r = await airtableRequest('POST', '', { records: chunk.map(f => ({ fields: f })) });
    if (r.body.error) throw new Error(r.body.error.message || JSON.stringify(r.body.error));
    results.push(...(r.body.records || []));
  }
  return results;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — fetch all days for a trip
  if (req.method === 'GET') {
    const tripId = (req.query.tripId || '').trim();
    if (!tripId) return res.status(400).json({ error: 'tripId required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}` +
                   `&sort[0][field]=Day%20Number&sort[0][direction]=asc`;
    try {
      const r = await airtableRequest('GET', filter, null);
      return res.status(200).json({ records: r.body.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — generate day records for a trip
  if (req.method === 'POST') {
    const { tripId, startDate, endDate } = req.body || {};
    if (!tripId || !startDate || !endDate) {
      return res.status(400).json({ error: 'tripId, startDate, and endDate required' });
    }

    const start = new Date(startDate + 'T00:00:00Z');
    const end   = new Date(endDate   + 'T00:00:00Z');
    const days  = Math.round((end - start) / 86400000) + 1;

    if (days <= 0 || days > 60) {
      return res.status(400).json({ error: 'Invalid date range (max 60 days)' });
    }

    const records = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      records.push({
        'Trip ID':    tripId,
        'Day Number': i + 1,
        'Date':       d.toISOString().split('T')[0]
      });
    }

    try {
      const created = await batchCreate(records);
      return res.status(200).json({ success: true, count: created.length });
    } catch(e) {
      console.error('[trip-days] create error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // PATCH — update a single day record
  if (req.method === 'PATCH') {
    const { id, ...fields } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const r = await airtableRequest('PATCH', `/${id}`, { fields });
      if (r.body.error) return res.status(500).json({ error: r.body.error });
      return res.status(200).json({ success: true, record: r.body });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
