const BASE_ID   = 'appdlxcWb45dIqNK2';
const TABLE     = 'Blog Posts';

async function airtableFetch(path) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — list published posts
  if (req.method === 'GET' && !req.query.slug) {
    const filter = `?filterByFormula=${encodeURIComponent(`{Status}="Published"`)}` +
      `&sort[0][field]=Published%20Date&sort[0][direction]=desc`;
    try {
      const data = await airtableFetch(filter);
      return res.status(200).json({ records: data.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // GET — single post by slug
  if (req.method === 'GET' && req.query.slug) {
    const slug   = (req.query.slug || '').trim();
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Slug}="${slug}",{Status}="Published")`)}`;
    try {
      const data = await airtableFetch(filter);
      const rec  = (data.records || [])[0];
      if (!rec) return res.status(404).json({ error: 'Post not found' });
      return res.status(200).json({ record: rec });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — create post (admin)
  if (req.method === 'POST') {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.BLOG_ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`;
      const resp = await fetch(url, {
        method:  'POST',
        headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fields: req.body })
      });
      return res.status(200).json(await resp.json());
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PATCH — update post (admin)
  if (req.method === 'PATCH') {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.BLOG_ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
      const resp = await fetch(url, {
        method:  'PATCH',
        headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ fields: req.body })
      });
      return res.status(200).json(await resp.json());
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // DELETE — delete post (admin)
  if (req.method === 'DELETE') {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.BLOG_ADMIN_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const id = (req.query.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}/${id}`;
      const resp = await fetch(url, {
        method:  'DELETE',
        headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY }
      });
      return res.status(200).json(await resp.json());
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
