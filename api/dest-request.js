const https = require('https');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Destination Requests';

function airtableRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + process.env.AIRTABLE_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const destination = (req.body?.destination || '').trim();
  const country     = (req.body?.country     || '').trim();
  const continent   = (req.body?.continent   || '').trim();

  if (!destination) return res.status(400).json({ error: 'destination required' });

  const today = new Date().toISOString().split('T')[0];

  try {
    // Check if this destination+country combo already exists
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Destination}="${destination}",{Country}="${country}")`)}`;
    const existing = await airtableRequest('GET', filter, null);
    const rec = (existing.records || [])[0];

    if (rec) {
      // Increment count and update Last Requested
      await airtableRequest('PATCH', `/${rec.id}`, {
        fields: {
          'Count':          (rec.fields['Count'] || 0) + 1,
          'Last Requested': today
        }
      });
    } else {
      // Create new record
      await airtableRequest('POST', '', {
        fields: {
          'Destination':    destination,
          'Country':        country,
          'Continent':      continent,
          'Count':          1,
          'First Requested': today,
          'Last Requested':  today
        }
      });
    }

    return res.status(200).json({ success: true });
  } catch(e) {
    console.error('[dest-request]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
