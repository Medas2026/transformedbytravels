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
    const date = rec.fields['Date'];
    if (!date) return false;
    return date >= checkIn && date <= checkOut;
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — fetch all lodging for a trip
  if (req.method === 'GET') {
    const tripId = (req.query.tripId || '').trim();
    if (!tripId) return res.status(400).json({ error: 'tripId required' });
    const filter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}`;
    try {
      const r = await airtableRequest('GET', filter, null);
      return res.status(200).json({ records: r.body.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — create lodging and link to days
  if (req.method === 'POST') {
    const { tripId, name, location, type, description, amenities, imageUrl,
            confirmationNum, reservationUrl, checkIn, checkOut } = req.body || {};
    if (!tripId || !name) return res.status(400).json({ error: 'tripId and name required' });
    const fields = {
      'Trip ID':         tripId,
      'Name':            name,
      'Location':        location        || '',
      'Type':            type            || '',
      'Description':     description     || '',
      'Amenities':       amenities       || '',
      'Image URL':       imageUrl        || '',
      'Confirmation #':  confirmationNum || '',
      'Reservation URL': reservationUrl  || '',
      'Check-in Date':   checkIn         || '',
      'Check-out Date':  checkOut        || ''
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
    const { id, tripId, name, location, type, description, amenities, imageUrl,
            confirmationNum, reservationUrl, checkIn, checkOut } = req.body || {};
    if (!id || !tripId) return res.status(400).json({ error: 'id and tripId required' });
    const fields = {};
    if (name            !== undefined) fields['Name']            = name;
    if (location        !== undefined) fields['Location']        = location;
    if (type            !== undefined) fields['Type']            = type;
    if (description     !== undefined) fields['Description']     = description;
    if (amenities       !== undefined) fields['Amenities']       = amenities;
    if (imageUrl        !== undefined) fields['Image URL']       = imageUrl;
    if (confirmationNum !== undefined) fields['Confirmation #']  = confirmationNum;
    if (reservationUrl  !== undefined) fields['Reservation URL'] = reservationUrl;
    if (checkIn         !== undefined) fields['Check-in Date']   = checkIn;
    if (checkOut        !== undefined) fields['Check-out Date']  = checkOut;
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
