const https = require('https');

const BASE_ID        = 'appdlxcWb45dIqNK2';
const SLIDES_TABLE   = 'Workshop Slides';
const REG_TABLE      = 'Workshop Registrations';

function airtableGet(table, filter, callback) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const path   = `/v0/${BASE_ID}/${encodeURIComponent(table)}?filterByFormula=${encodeURIComponent(filter)}`;
  const options = {
    hostname: 'api.airtable.com',
    path,
    method:  'GET',
    headers: { 'Authorization': 'Bearer ' + apiKey }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

function airtablePatch(table, recordId, fields, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = JSON.stringify({ fields });
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
    method:   'PATCH',
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
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(bodyStr);
  req.end();
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // PATCH — save Last Slide progress
  if (req.method === 'PATCH') {
    const b          = req.body || {};
    const regRecordId = (b.regRecordId || '').trim();
    const lastSlide   = Number(b.lastSlide) || 0;
    if (!regRecordId) return res.status(400).json({ error: 'regRecordId required' });
    airtablePatch(REG_TABLE, regRecordId, { 'Last Slide': lastSlide }, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ success: true });
    });
    return;
  }

  // GET — load slides
  const code  = (req.query.code  || '').trim();
  const email = (req.query.email || '').toLowerCase().trim();
  if (!code)  return res.status(400).json({ error: 'Workshop code required' });
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Step 1: look up version + last slide from Workshop Registrations
  const regFilter = `AND({Traveler Email}="${email}",{Workshop Code}="${code}")`;
  airtableGet(REG_TABLE, regFilter, (err, regData) => {
    if (err) return res.status(500).json({ error: err.message });

    const reg         = (regData.records || [])[0];
    const version     = reg ? (reg.fields['Version']    || '') : '';
    const lastSlide   = reg ? (reg.fields['Last Slide'] || 0)  : 0;
    const regRecordId = reg ? reg.id : '';

    // Step 2: fetch slides filtered by code + version (if version found)
    const slideFilter = version
      ? `AND({Workshop Code}="${code}",{Version}="${version}")`
      : `{Workshop Code}="${code}"`;

    const sort = '&sort%5B0%5D%5Bfield%5D=Slide%20Number&sort%5B0%5D%5Bdirection%5D=asc';
    const slidePath = `/v0/${BASE_ID}/${encodeURIComponent(SLIDES_TABLE)}?filterByFormula=${encodeURIComponent(slideFilter)}${sort}`;

    const apiKey = process.env.AIRTABLE_API_KEY;
    const options = {
      hostname: 'api.airtable.com',
      path: slidePath,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + apiKey }
    };

    const req2 = https.request(options, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const slides = (parsed.records || []).map(r => r.fields);
          res.status(200).json({ slides, version, lastSlide, regRecordId });
        } catch(e) {
          res.status(500).json({ error: 'Parse error' });
        }
      });
    });
    req2.on('error', err => res.status(500).json({ error: err.message }));
    req2.end();
  });
};
