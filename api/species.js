const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'tblYtFaj6UYMUEwFQ';

async function at(path, method = 'GET', body = null) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET — list species with optional search/type filter ──────────────────
  if (req.method === 'GET') {
    const { search, type, category } = req.query;
    const filters = [];
    if (type)     filters.push(`{Type}="${type}"`);
    if (category) filters.push(`{Category}="${category}"`);
    if (search)   filters.push(`OR(SEARCH(LOWER("${search}"),LOWER({Species Name})),SEARCH(LOWER("${search}"),LOWER({Scientific Name})))`);
    const formula = filters.length > 1 ? `AND(${filters.join(',')})` : (filters[0] || '');
    const qs = formula ? `?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Species Name&sort[0][direction]=asc`
                       : `?sort[0][field]=Species Name&sort[0][direction]=asc`;
    try {
      // Page through all records
      let all = [], offset = '';
      do {
        const data = await at(qs + (offset ? `&offset=${offset}` : ''));
        all = all.concat(data.records || []);
        offset = data.offset || '';
      } while (offset);
      return res.status(200).json({ records: all });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — create a species ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const b = req.body || {};
    const fields = buildFields(b);
    if (!fields['Species Name']) return res.status(400).json({ error: 'Species Name is required' });
    try {
      const rec = await at('', 'POST', { fields });
      if (rec.error) return res.status(500).json({ error: rec.error.message || JSON.stringify(rec.error) });
      return res.status(200).json({ ok: true, id: rec.id, record: rec });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── PATCH — update a species ─────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    const fields = buildFields(req.body || {});
    try {
      const rec = await at('/' + id, 'PATCH', { fields });
      if (rec.error) return res.status(500).json({ error: rec.error.message || JSON.stringify(rec.error) });
      return res.status(200).json({ ok: true, record: rec });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE — delete a species ────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
      await at('/' + id, 'DELETE');
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

function buildFields(b) {
  const f = {};
  if (b.name)               f['Species Name']        = b.name;
  if (b.scientificName)     f['Scientific Name']     = b.scientificName;
  if (b.type)               f['Type']                = b.type;
  if (b.category)           f['Category']            = b.category;
  if (b.description)        f['Description']         = b.description;
  if (b.habitat)            f['Habitat']             = b.habitat;
  if (b.conservationStatus) f['Conservation Status'] = b.conservationStatus;
  if (b.bestParks)          f['Best Parks']          = b.bestParks;          // comma-separated string
  if (b.bestMonths)         f['Best Months']         = b.bestMonths;         // comma-separated string
  if (b.photoUrl)           f['Photo URL']           = b.photoUrl;
  if (b.ebirdCode)          f['eBird Code']          = b.ebirdCode;
  if (b.inaturalistId)      f['iNaturalist ID']      = String(b.inaturalistId);
  if (b.notes)              f['Notes']               = b.notes;
  return f;
}
