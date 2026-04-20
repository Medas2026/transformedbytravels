const https = require('https');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Traveler';

function airtableRequest(method, path, body, callback) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  console.log('API key present:', !!apiKey, 'starts with:', apiKey ? apiKey.substring(0, 6) : 'none');
  const bodyStr = body ? JSON.stringify(body) : '';
  const options = {
    hostname: 'api.airtable.com',
    path: `/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}${path}`,
    method: method,
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      console.log('Airtable status:', res.statusCode, 'body:', data.slice(0, 200));
      try {
        callback(null, JSON.parse(data), res.statusCode);
      } catch(e) {
        callback(e);
      }
    });
  });

  req.on('error', callback);
  if (bodyStr) req.write(bodyStr);
  req.end();
}

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — admin list of all travelers
  if (req.method === 'GET' && req.query.action === 'admin-list') {
    const email = ((req.query && req.query.email) || '').toLowerCase().trim();
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
    if (!email || !adminEmails.includes(email)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const sort = '&sort[0][field]=Assessment%20Date&sort[0][direction]=desc';
    airtableRequest('GET', '?' + sort, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ records: data.records || [] });
    });
    return;
  }

  // GET — planner's customer list
  if (req.method === 'GET' && req.query.action === 'planner-list') {
    const email = ((req.query && req.query.email) || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Travel Planner Email}="${email}")`)}`;
    airtableRequest('GET', filter, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ records: data.records || [] });
    });
    return;
  }

  // GET — travel-style lookup
  if (req.method === 'GET' && req.query.action === 'travel-style') {
    const name   = ((req.query && req.query.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const filter  = `?filterByFormula=${encodeURIComponent(`({Name}="${name}")`)}`;
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent('Travel Style Codes')}${filter}`,
      method:   'GET',
      headers:  { 'Authorization': 'Bearer ' + apiKey }
    };
    const r2 = https.request(options, (resp) => {
      let d = '';
      resp.on('data', c => { d += c; });
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          res.status(200).json({ record: (parsed.records || [])[0] || null });
        } catch(e) { res.status(500).json({ error: 'Parse error' }); }
      });
    });
    r2.on('error', e => res.status(500).json({ error: e.message }));
    r2.end();
    return;
  }

  // GET — age-band lookup
  if (req.method === 'GET' && req.query.action === 'age-band') {
    const name   = ((req.query && req.query.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const filter  = `?filterByFormula=${encodeURIComponent(`({Name}="${name}")`)}`;
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent('Life Stage')}${filter}`,
      method:   'GET',
      headers:  { 'Authorization': 'Bearer ' + apiKey }
    };
    const r2 = https.request(options, (resp) => {
      let d = '';
      resp.on('data', c => { d += c; });
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          res.status(200).json({ record: (parsed.records || [])[0] || null });
        } catch(e) { res.status(500).json({ error: 'Parse error' }); }
      });
    });
    r2.on('error', e => res.status(500).json({ error: e.message }));
    r2.end();
    return;
  }

  // GET — load profile by email
  if (req.method === 'GET') {
    const email = ((req.query && req.query.email) || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
    airtableRequest('GET', filter, null, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      if (data.records && data.records.length > 0) {
        res.status(200).json({ record: data.records[0] });
      } else {
        res.status(200).json({ record: null });
      }
    });
    return;
  }

  const b = req.body || {};
  const email = (b.email || '').toLowerCase().trim();
  console.log('[airtable-traveler] POST received, email:', email, 'body keys:', Object.keys(b).join(','));

  if (!email) return res.status(400).json({ error: 'Email required' });

  // First check if traveler already exists
  const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;

  airtableRequest('GET', filter, null, (err, data, status) => {
    if (err) return res.status(500).json({ error: err.message });

    if (data.records && data.records.length > 0) {
      // Traveler exists — update their record (do not touch query counts)
      const recordId = data.records[0].id;
      const fields = buildFields(b, false);

      airtableRequest('PATCH', `/${recordId}`, { fields }, async (err2, data2, status2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (data2.error) return res.status(500).json({ error: data2.error, detail: data2 });
        if (!b.dnaQueryUpdate && !b.profileEdit) await writeAssessmentHistory(b);
        res.status(200).json({ success: true, action: 'updated', record: data2 });
      });

    } else {
      // New traveler — create record, initialise query counts
      const fields = buildFields(b, true);
      console.log('[airtable-traveler] creating new record for:', b.email, 'fields:', JSON.stringify(fields).slice(0, 400));

      airtableRequest('POST', '', { fields }, async (err2, data2, status2) => {
        if (err2) { console.error('[airtable-traveler] create error:', err2.message); return res.status(500).json({ error: err2.message }); }
        if (data2.error) { console.error('[airtable-traveler] Airtable create rejected:', JSON.stringify(data2)); return res.status(500).json({ error: data2.error, detail: data2 }); }
        await writeAssessmentHistory(b);
        res.status(200).json({ success: true, action: 'created', record: data2 });
      });
    }
  });
};

function buildFields(b, isNew) {
  // DNA query counter update
  if (b.dnaQueryUpdate) {
    return {
      'DNA Guides To Date':   Number(b.dnaToDate   || 0),
      'DNA Guides Remaining': Number(b.dnaRemaining || 0)
    };
  }

  // Profile edit — only update contact fields
  if (b.profileEdit) {
    const fields = {};
    if (b.name              !== undefined) fields['Traveler Name']            = b.name;
    if (b.phone             !== undefined) fields['Phone Number']             = b.phone;
    if (b.address           !== undefined) fields['Address']                  = b.address;
    if (b.city              !== undefined) fields['City']                     = b.city;
    if (b.state             !== undefined) fields['State']                    = b.state;
    if (b.zip               !== undefined) fields['ZIP Code']                 = b.zip;
    if (b.homeAirport       !== undefined) fields['Home Airport']             = b.homeAirport;
    if (b.travelStyle       !== undefined) fields['Travel Style']             = b.travelStyle;
    if (b.homeTimezone      !== undefined) fields['Home Timezone']            = b.homeTimezone;
    if (b.distanceUnits     !== undefined) fields['Distance Units']           = b.distanceUnits;
    if (b.preTripWorkshopDate     !== undefined) fields['Pre-Trip Workshop Date']     = b.preTripWorkshopDate;
    if (b.integrationWorkshopDate !== undefined) fields['Integration Workshop Date'] = b.integrationWorkshopDate;
    return fields;
  }

  // Full assessment save
  const fields = {
    'Traveler Email':      (b.email || '').toLowerCase().trim(),
    'Traveler Name':       b.name || '',
    'Archetype':           b.archetype || '',
    'Passions':            b.passions || '',
    'Life Stage':          b.lifeStage || '',
    'Travel Style':        b.travelStyle || '',
    'Hopes to Experience': b.hopes || '',
    'Assessment Date':     new Date().toISOString().split('T')[0],
    'Scoring Version':     b.scoringVersion || ''
  };

  if (b.itemScores) {
    fields['Item Scores'] = typeof b.itemScores === 'string' ? b.itemScores : JSON.stringify(b.itemScores);
  }

  if (b.scores) {
    fields['DS-1 Curiosity']  = Number(b.scores.Curiosity  || 0);
    fields['DS-2 Adventure']  = Number(b.scores.Adventure  || 0);
    fields['DS-3 Reflection'] = Number(b.scores.Reflection || 0);
    fields['DS-4 Connection'] = Number(b.scores.Connection || 0);
    fields['DS-5 Intention']  = Number(b.scores['Travel Purpose'] || b.scores.Intention || 0);
  }

  if (b.tgi !== undefined) {
    fields['TGI'] = Number(b.tgi);
  }

  if (b.marketingConsent !== undefined) {
    fields['Marketing Consent'] = !!b.marketingConsent;
    if (b.marketingConsent) fields['Marketing Consent Date'] = new Date().toISOString().split('T')[0];
  }

  if (isNew) {
    fields['DNA Guides To Date']   = 0;
    fields['DNA Guides Remaining'] = 5;
    fields['Package Status']       = 'Free';
    fields['Created Date']         = new Date().toISOString().split('T')[0];
  }

  return fields;
}

function writeAssessmentHistory(b) {
  return new Promise((resolve) => {
    const fields = {
      'Traveler Email':      (b.email || '').toLowerCase().trim(),
      'Snapshot Date':       new Date().toISOString().split('T')[0],
      'Archetype':           b.archetype       || '',
      'Passions':            b.passions        || '',
      'Life Stage':          b.lifeStage       || '',
      'Travel Style':        b.travelStyle     || '',
      'Hopes to Experience': b.hopes           || '',
      'Scoring Version':     b.scoringVersion  || ''
    };
    if (b.scores) {
      fields['DS-1 Curiosity']  = Number(b.scores.Curiosity  || 0);
      fields['DS-2 Adventure']  = Number(b.scores.Adventure  || 0);
      fields['DS-3 Reflection'] = Number(b.scores.Reflection || 0);
      fields['DS-4 Connection'] = Number(b.scores.Connection || 0);
      fields['DS-5 Intention']  = Number(b.scores['Travel Purpose'] || b.scores.Intention || 0);
    }
    if (b.tgi !== undefined) fields['TGI'] = Number(b.tgi);
    if (b.itemScores) fields['Item Scores'] = typeof b.itemScores === 'string' ? b.itemScores : JSON.stringify(b.itemScores);

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const bodyStr = JSON.stringify({ fields });
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent('Assessment History')}`,
      method:   'POST',
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (r) => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        console.log('[assessmentHistory] status:', r.statusCode, d.slice(0, 100));
        resolve();
      });
    });
    req.on('error', e => { console.error('[assessmentHistory] error:', e.message); resolve(); });
    req.write(bodyStr);
    req.end();
  });
}
