const https = require('https');

const BASE_ID    = 'appdlxcWb45dIqNK2';
const TABLE_NAME = 'Lodging';

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

function tripDaysRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}/${encodeURIComponent('Trip Days')}${path}`,
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

// Link lodging to all Trip Days in the check-in/check-out range
async function linkLodgingToDays(tripId, lodgingId, checkIn, checkOut) {
  const filter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}`;
  const r = await tripDaysRequest('GET', filter, null);
  const days = (r.body.records || []).filter(rec => {
    const date = (rec.fields['Date'] || '').slice(0, 10);
    if (!date) return false;
    return date >= checkIn && date < checkOut;
  });
  if (!days.length) return;
  // Batch patch up to 10 at a time
  for (let i = 0; i < days.length; i += 10) {
    const chunk = days.slice(i, i + 10);
    await tripDaysRequest('PATCH', '', {
      records: chunk.map(d => ({ id: d.id, fields: { 'Lodging ID': lodgingId } }))
    });
  }
}

// Clear lodging ID from all Trip Days that reference this lodging record
async function clearLodgingFromDays(tripId, lodgingId) {
  const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Lodging ID}="${lodgingId}")`)}`;
  const r = await tripDaysRequest('GET', filter, null);
  const days = r.body.records || [];
  if (!days.length) return;
  for (let i = 0; i < days.length; i += 10) {
    const chunk = days.slice(i, i + 10);
    await tripDaysRequest('PATCH', '', {
      records: chunk.map(d => ({ id: d.id, fields: { 'Lodging ID': '' } }))
    });
  }
}

// Full rebuild: for every Trip Day, find the lodging record whose
// [Check-in Date, Check-out Date) range covers that day's Date, and set
// Lodging ID accordingly. Days with no covering lodging are cleared.
// Cleans up stale links from prior edits.
async function rebuildTripLodgingLinks(tripId) {
  // Load all lodging records + all trip days for this trip
  const lodgingFilter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}`;
  const daysFilter    = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}`;
  const [lodgingResp, daysResp] = await Promise.all([
    airtableRequest('GET', lodgingFilter, null),
    tripDaysRequest('GET', daysFilter, null),
  ]);
  const lodgings = (lodgingResp.body.records || []).map(r => ({
    id:       r.id,
    checkIn:  (r.fields['Check-in Date']  || '').slice(0, 10),
    checkOut: (r.fields['Check-out Date'] || '').slice(0, 10),
    name:     r.fields['Name'] || 'Lodging',
  })).filter(l => l.checkIn && l.checkOut);
  const days = (daysResp.body.records || []).map(r => ({
    id:      r.id,
    date:    (r.fields['Date'] || '').slice(0, 10),
    current: r.fields['Lodging ID'] || '',
  }));

  // For each day, determine the correct lodging (if any)
  const updates = [];
  const summary = { linked: 0, cleared: 0, unchanged: 0 };
  for (const d of days) {
    if (!d.date) { summary.unchanged++; continue; }
    const match = lodgings.find(l => d.date >= l.checkIn && d.date < l.checkOut);
    const targetId = match ? match.id : '';
    if (targetId === d.current) { summary.unchanged++; continue; }
    updates.push({ id: d.id, fields: { 'Lodging ID': targetId } });
    if (targetId) summary.linked++; else summary.cleared++;
  }

  // Batch PATCH (Airtable limit: 10 records per request)
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    await tripDaysRequest('PATCH', '', { records: chunk });
  }
  return { ...summary, daysScanned: days.length, lodgingCount: lodgings.length };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST ?action=rebuild-links — reconcile Trip Days' Lodging ID with current lodging dates
  if (req.method === 'POST' && req.query.action === 'rebuild-links') {
    const tripId = (req.body && req.body.tripId || req.query.tripId || '').trim();
    if (!tripId) return res.status(400).json({ error: 'tripId required' });
    try {
      const result = await rebuildTripLodgingLinks(tripId);
      return res.status(200).json({ success: true, ...result });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — fetch all lodging for a trip
  if (req.method === 'GET') {
    const tripId = (req.query.tripId || '').trim();
    if (!tripId) return res.status(400).json({ error: 'tripId required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}` +
      `&sort[0][field]=Check-in%20Date&sort[0][direction]=asc`;
    try {
      const r = await airtableRequest('GET', filter, null);
      return res.status(200).json({ records: r.body.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — create lodging and link to days
  if (req.method === 'POST') {
    const { tripId, name, location, type, description, amenities, phone, siteUrl, imageUrl,
            confirmationNum, checkIn, checkOut } = req.body || {};
    if (!tripId || !name) return res.status(400).json({ error: 'tripId and name required' });
    const fields = {
      'Trip ID':        tripId,
      'Name':           name,
      'Location':       location        || '',
      'Type':           type            || null,
      'Description':    description     || '',
      'Amenities':      amenities       || '',
      'Phone':          phone           || '',
      'Site URL':       siteUrl         || '',
      'Image URL':      imageUrl        || '',
      'Confirmation #': confirmationNum || '',
      'Check-in Date':  checkIn         || '',
      'Check-out Date': checkOut        || ''
    };
    try {
      const r = await airtableRequest('POST', '', { fields });
      if (r.body.error) return res.status(500).json({ error: r.body.error.message || JSON.stringify(r.body.error) });
      const lodgingId = r.body.id;
      if (checkIn && checkOut) await linkLodgingToDays(tripId, lodgingId, checkIn, checkOut);
      return res.status(200).json({ success: true, record: r.body });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PATCH — update lodging and re-link days
  if (req.method === 'PATCH') {
    const { id, tripId, name, location, type, description, amenities, phone, siteUrl, imageUrl,
            confirmationNum, checkIn, checkOut } = req.body || {};
    if (!id || !tripId) return res.status(400).json({ error: 'id and tripId required' });
    const fields = {};
    if (name            !== undefined) fields['Name']           = name;
    if (location        !== undefined) fields['Location']       = location;
    if (type            !== undefined) fields['Type']           = type || null;
    if (description     !== undefined) fields['Description']    = description;
    if (amenities       !== undefined) fields['Amenities']      = amenities;
    if (phone           !== undefined) fields['Phone']          = phone;
    if (siteUrl         !== undefined) fields['Site URL']       = siteUrl;
    if (imageUrl        !== undefined) fields['Image URL']      = imageUrl;
    if (confirmationNum !== undefined) fields['Confirmation #'] = confirmationNum;
    if (checkIn         !== undefined) fields['Check-in Date']  = checkIn;
    if (checkOut        !== undefined) fields['Check-out Date'] = checkOut;
    try {
      const r = await airtableRequest('PATCH', `/${id}`, { fields });
      if (r.body.error) return res.status(500).json({ error: r.body.error.message || JSON.stringify(r.body.error) });
      // Re-link: clear old links then re-apply with new dates
      if (checkIn !== undefined || checkOut !== undefined) {
        await clearLodgingFromDays(tripId, id);
        const newCheckIn  = checkIn  ?? r.body.fields['Check-in Date']  ?? '';
        const newCheckOut = checkOut ?? r.body.fields['Check-out Date'] ?? '';
        if (newCheckIn && newCheckOut) await linkLodgingToDays(tripId, id, newCheckIn, newCheckOut);
      }
      return res.status(200).json({ success: true, record: r.body });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE — remove lodging and clear day links
  if (req.method === 'DELETE') {
    const id     = (req.query.id     || '').trim();
    const tripId = (req.query.tripId || '').trim();
    if (!id || !tripId) return res.status(400).json({ error: 'id and tripId required' });
    try {
      await clearLodgingFromDays(tripId, id);
      const r = await airtableRequest('DELETE', `/${id}`, null);
      if (r.body.error) return res.status(500).json({ error: r.body.error });
      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
};
