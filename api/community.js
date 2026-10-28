// Travelers' Corner — community feed.
//   GET  /api/community                → list published posts (newest first)
//   POST /api/community                → create a post
//        body { email, caption, photoUrls[], speciesId?, placeName?, latitude?, longitude?, realm?, tripId? }
//   POST /api/community?action=like    → { postId }  increment Likes
const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Community Posts';
const T       = encodeURIComponent(TABLE);
const TABLE_C = 'Community Comments';
const TC      = encodeURIComponent(TABLE_C);

async function at(path, method = 'GET', body = null) {
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    method,
    headers: {
      'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

const first = v => Array.isArray(v) ? (v[0] || '') : (v || '');

function shape(r) {
  const f = r.fields || {};
  // Split on newlines only — commas are legal inside Cloudinary transform URLs (f_jpg,q_auto,w_1600).
  const photos = String(f['Photo URLs'] || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  return {
    id:          r.id,
    authorName:  first(f['Traveler Name (from Author)']) || 'A traveler',
    authorPhoto: first(f['Profile Photo URL (from Author)']) || '',
    caption:     f['Caption'] || '',
    photos,
    species:     first(f['Species Name (from TBT Wildlife)']) || '',
    place:       f['Place Name'] || '',
    taken:       f['Taken'] || '',
    latitude:    f['Latitude']  ?? null,
    longitude:   f['Longitude'] ?? null,
    realm:       f['Realm'] || '',
    trip:        first(f['Trip Name (from Trip)']) || '',
    likes:       f['Likes'] || 0,
    featured:    f['Featured'] === true,
    created:     f['Created'] || r.createdTime || '',
  };
}

function shapeComment(r, travMap) {
  const f = r.fields || {};
  const authorId = first(f['Author']) || '';
  const t = (travMap && travMap[authorId]) || {};
  return {
    id:          r.id,
    postId:      first(f['Post']) || '',
    // Resolve name/photo from the Author link (robust to lookup-field naming).
    authorName:  t.name  || first(f['Traveler Name (from Author)'])      || 'A traveler',
    authorPhoto: t.photo || first(f['Profile Photo URL (from Author)'])  || '',
    text:        f['Comment'] || '',
    created:     f['Created'] || r.createdTime || '',
  };
}

// Fetch Traveler name/photo for a set of author record ids → { id: {name, photo} }.
async function fetchTravelers(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  const map = {};
  await Promise.all(uniq.map(async id => {
    try {
      const rec = await at('Traveler/' + id);
      if (rec && rec.fields) map[id] = {
        name:  rec.fields['Traveler Name'] || '',
        photo: rec.fields['Profile Photo URL'] || '',
      };
    } catch (e) { /* skip */ }
  }));
  return map;
}

// Fetch every published comment (paginated). Comments are filtered to a post in
// JS by the Post link's record id — Airtable formulas expose only the linked
// primary field, not the id, so a formula filter on postId is unreliable.
async function fetchAllComments() {
  let recs = [], offset = '';
  do {
    const p = `${TC}?filterByFormula=${encodeURIComponent('{Status}="Published"')}` +
              `&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=asc&pageSize=100` +
              (offset ? `&offset=${offset}` : '');
    const d = await at(p);
    if (d.error) throw new Error(d.error.message || 'comments error');
    recs = recs.concat(d.records || []);
    offset = d.offset || '';
  } while (offset);
  return recs;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const action = (req.query && req.query.action) || '';

      // ── Comments for one post ──
      if (action === 'comments') {
        const postId = String((req.query && req.query.postId) || '').trim();
        if (!postId) return res.status(400).json({ error: 'postId required' });
        let all = [];
        try { all = await fetchAllComments(); } catch (e) { return res.status(200).json({ comments: [] }); }
        const mine = all.filter(r => first(r.fields && r.fields['Post']) === postId);
        const travMap = await fetchTravelers(mine.map(r => first(r.fields['Author'])));
        const comments = mine.map(r => shapeComment(r, travMap));
        return res.status(200).json({ comments });
      }

      // ── Feed ──
      const params =
        'filterByFormula=' + encodeURIComponent('{Status}="Published"') +
        '&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc&pageSize=60';
      const data = await at(`${T}?${params}`);
      if (data.error) return res.status(500).json({ error: data.error.message || 'feed error' });
      const posts = (data.records || []).map(shape);

      // Attach comment counts (best-effort — table may not exist yet).
      try {
        const counts = {};
        (await fetchAllComments()).forEach(r => {
          const pid = first(r.fields && r.fields['Post']);
          if (pid) counts[pid] = (counts[pid] || 0) + 1;
        });
        posts.forEach(p => { p.comments = counts[p.id] || 0; });
      } catch (e) { posts.forEach(p => { p.comments = 0; }); }

      return res.status(200).json({ posts });
    }

    if (req.method === 'POST') {
      const action = (req.query && req.query.action) || '';
      const b = req.body || {};

      // ── Like ──
      if (action === 'like') {
        if (!b.postId) return res.status(400).json({ error: 'postId required' });
        const rec = await at(`${T}/${b.postId}`);
        const cur = (rec.fields && rec.fields['Likes']) || 0;
        const upd = await at(`${T}/${b.postId}`, 'PATCH', { fields: { Likes: cur + 1 } });
        return res.status(200).json({ ok: true, likes: (upd.fields && upd.fields['Likes']) || cur + 1 });
      }

      // ── Add a comment ──
      if (action === 'comment') {
        const posterEmail = String(b.email || '').trim().toLowerCase();
        const postId      = String(b.postId || '').trim();
        const text        = String(b.text || '').trim();
        if (!posterEmail) return res.status(400).json({ error: 'email required' });
        if (!postId)      return res.status(400).json({ error: 'postId required' });
        if (!text)        return res.status(400).json({ error: 'Write a comment first.' });
        // Commenter must be an existing member.
        const trav = await at('Traveler?filterByFormula=' +
          encodeURIComponent(`{Traveler Email}="${posterEmail}"`) + '&maxRecords=1');
        const authorRec = trav.records && trav.records[0];
        if (!authorRec) return res.status(403).json({ error: 'Not a member — please sign in first.' });
        const cf = {
          Comment: text.slice(0, 2000),
          Post:    [postId],
          Author:  [authorRec.id],
          Status:  'Published',
          Created: new Date().toISOString(),
        };
        let created = await at(TC, 'POST', { fields: cf });
        // If an optional field (Created / Status) doesn't exist yet, drop it and retry so commenting still works.
        if (created.error && /unknown field/i.test(created.error.message || '')) {
          delete cf['Created']; delete cf['Status'];
          created = await at(TC, 'POST', { fields: cf });
        }
        if (created.error) return res.status(500).json({ error: created.error.message || JSON.stringify(created.error) });
        const travMap = { [authorRec.id]: {
          name:  authorRec.fields['Traveler Name'] || '',
          photo: authorRec.fields['Profile Photo URL'] || '',
        }};
        return res.status(200).json({ ok: true, comment: shapeComment(created, travMap) });
      }

      // ── Create a post ──
      const posterEmail = String(b.email || '').trim().toLowerCase();       // the signed-in user
      if (!posterEmail) return res.status(400).json({ error: 'email required' });
      // A coach may credit the post to a customer via authorEmail; default is the poster.
      const authorEmail = String(b.authorEmail || '').trim().toLowerCase() || posterEmail;
      const caption = String(b.caption || '').trim();
      const photos  = Array.isArray(b.photoUrls) ? b.photoUrls.filter(Boolean)
                    : (b.photoUrls ? [b.photoUrls] : []);
      if (!caption && !photos.length) return res.status(400).json({ error: 'Add a caption or a photo.' });

      // Resolve the author (whom the post is credited to) — must be an existing member.
      const trav = await at('Traveler?filterByFormula=' +
        encodeURIComponent(`{Traveler Email}="${authorEmail}"`) + '&maxRecords=1');
      const authorRec = trav.records && trav.records[0];
      if (!authorRec) return res.status(403).json({ error: 'Not a member — please sign in first.' });
      // Posting on someone else's behalf is allowed only if the poster is their coach.
      if (authorEmail !== posterEmail) {
        const coachEmail = String(authorRec.fields['Coach Email'] || '').toLowerCase();
        if (coachEmail !== posterEmail) return res.status(403).json({ error: 'You can only post on behalf of your own customers.' });
      }

      const fields = {
        Author:       [authorRec.id],
        Caption:      caption,
        'Photo URLs': photos.join('\n'),
        'Place Name': String(b.placeName || '').trim(),
        Status:       'Published',
        Likes:        0,
        Created:      new Date().toISOString(),
      };
      if (b.speciesId) fields['TBT Wildlife'] = [b.speciesId];
      if (b.tripId)    fields['Trip']         = [b.tripId];
      if (b.realm && ['Land', 'Ocean', 'Sky'].includes(b.realm)) fields['Realm'] = b.realm;
      if (b.latitude  != null && b.latitude  !== '') fields['Latitude']  = Number(b.latitude);
      if (b.longitude != null && b.longitude !== '') fields['Longitude'] = Number(b.longitude);
      if (b.takenAt) fields['Taken'] = String(b.takenAt).slice(0, 80);

      let created = await at(T, 'POST', { fields });
      // If the optional 'Taken' field doesn't exist yet, retry without it so posting still works.
      if (created.error && /unknown field/i.test(created.error.message || '') && fields['Taken']) {
        delete fields['Taken'];
        created = await at(T, 'POST', { fields });
      }
      if (created.error) return res.status(500).json({ error: created.error.message || JSON.stringify(created.error) });
      return res.status(200).json({ ok: true, post: shape(created) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
