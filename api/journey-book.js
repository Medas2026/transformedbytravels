const BASE_ID    = 'appdlxcWb45dIqNK2';
const BOOKS      = 'Journey Books';
const PHOTOS     = 'Journey Book Photos';

async function at(table, path, method = 'GET', body = null) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const opts = { method, headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — load book by tripId or sessionId ──────────────────────────────
  if (req.method === 'GET') {
    const { tripId, sessionId } = req.query;
    if (!tripId && !sessionId) return res.status(400).json({ error: 'tripId or sessionId required' });

    try {
      const formula = tripId
        ? `{Trip ID}="${tripId}"`
        : `{Session ID}="${sessionId}"`;
      const data = await at(BOOKS,
        `?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Create%20Date&sort[0][direction]=desc`);
      const book = (data.records || [])[0];
      if (!book) return res.status(404).json({ error: 'No book found' });

      // Load photos for this book
      const photoData = await at(PHOTOS,
        `?filterByFormula=${encodeURIComponent(`{Journey Book ID}="${book.id}"`)}&sort[0][field]=Position&sort[0][direction]=asc`);

      return res.status(200).json({ book, photos: photoData.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — create a new book ────────────────────────────────────────────
  if (req.method === 'POST') {
    const { tripId, travelerEmail, sessionId, coverTitle, coverSubtitle, coverPhotoUrl,
            openingText, daysData, closingText, closingPhotoUrl, portraitPhotoUrl, guideData, bookStatus } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    try {
      // Prevent duplicates — one book per session
      if (sessionId) {
        const existing = await at(BOOKS,
          `?filterByFormula=${encodeURIComponent(`{Session ID}="${sessionId}"`)}`);
        if ((existing.records || []).length > 0) {
          return res.status(409).json({ error: 'Book already exists for this session', id: existing.records[0].id });
        }
      }

      const fields = {
        'Session ID':   sessionId,
        'Book Status':  bookStatus  || 'Draft',
      };
      if (tripId)         fields['Trip ID']            = tripId;
      if (travelerEmail)  fields['Traveler Email']     = travelerEmail;
      if (coverTitle)     fields['Cover Title']        = coverTitle;
      if (coverSubtitle)  fields['Cover Subtitle']     = coverSubtitle;
      const stripQ = v => (v || '').trim().replace(/^["']+|["']+$/g, '');
      const cp = stripQ(coverPhotoUrl);   if (cp)  fields['Cover Photo URL']    = cp;
      if (openingText)    fields['Opening Text']       = openingText;
      if (daysData)       fields['Days Data']          = daysData;
      if (closingText)    fields['Closing Text']       = closingText;
      const cl = stripQ(closingPhotoUrl);  if (cl)  fields['Closing Photo URL']  = cl;
      const pt = stripQ(portraitPhotoUrl); if (pt)  fields['Portrait Photo URL'] = pt;
      if (guideData)      fields['Guide Data']         = guideData;
      const rec = await at(BOOKS, '', 'POST', { fields });
      if (rec.error) return res.status(500).json({ error: rec.error.message || JSON.stringify(rec.error) });
      return res.status(200).json({ ok: true, id: rec.id, record: rec });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH — update an existing book ────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { tripId, coverTitle, coverSubtitle, coverPhotoUrl, openingText, daysData,
            closingText, closingPhotoUrl, portraitPhotoUrl, guideData, bookStatus } = req.body || {};

    const stripQ = v => (v || '').trim().replace(/^["']+|["']+$/g, '');
    const fields = {};
    if (tripId            !== undefined && tripId) fields['Trip ID']   = tripId;
    if (coverTitle        !== undefined) fields['Cover Title']         = coverTitle;
    if (coverSubtitle     !== undefined) fields['Cover Subtitle']      = coverSubtitle;
    const cleanCover = stripQ(coverPhotoUrl);
    if (cleanCover)     fields['Cover Photo URL']     = cleanCover;
    if (openingText       !== undefined) fields['Opening Text']        = openingText;
    if (daysData          !== undefined) fields['Days Data']           = daysData;
    if (closingText       !== undefined) fields['Closing Text']        = closingText;
    const cleanClosing = stripQ(closingPhotoUrl);
    if (cleanClosing)   fields['Closing Photo URL']   = cleanClosing;
    const cleanPortrait = stripQ(portraitPhotoUrl);
    if (cleanPortrait)  fields['Portrait Photo URL']  = cleanPortrait;
    if (guideData         !== undefined) fields['Guide Data']          = guideData;
    if (bookStatus        !== undefined) fields['Book Status']         = bookStatus;

    try {
      const rec = await at(BOOKS, `/${id}`, 'PATCH', { fields });
      if (rec.error) return res.status(500).json({ error: rec.error.message || JSON.stringify(rec.error) });
      return res.status(200).json({ ok: true, record: rec });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE — delete a book and its photos ──────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });

    try {
      // Delete all photos for this book first
      const photoData = await at(PHOTOS,
        `?filterByFormula=${encodeURIComponent(`{Journey Book ID}="${id}"`)}`);
      const photoIds = (photoData.records || []).map(r => r.id);
      for (let i = 0; i < photoIds.length; i += 10) {
        const chunk = photoIds.slice(i, i + 10);
        await at(PHOTOS, '?' + chunk.map(pid => `records[]=${pid}`).join('&'), 'DELETE');
      }
      await at(BOOKS, `/${id}`, 'DELETE');
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
