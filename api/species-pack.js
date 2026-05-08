const BASE_ID = 'appdlxcWb45dIqNK2';

async function at(table, path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Optional ?parks=Bwindi,Kibale filter
  const { parks } = req.query;
  const parkFilter = parks ? parks.split(',').map(p => p.trim().toLowerCase()) : null;

  try {
    // Page through all species
    let all = [], offset = '';
    do {
      const data = await at('tblYtFaj6UYMUEwFQ', `?sort[0][field]=Species Name&sort[0][direction]=asc${offset ? '&offset=' + offset : ''}`);
      all = all.concat(data.records || []);
      offset = data.offset || '';
    } while (offset);

    const species = all
      .map(r => {
        const f = r.fields;
        const bestParks = Array.isArray(f['Best Parks']) ? f['Best Parks'] : (f['Best Parks'] || '').split(',').map(s => s.trim()).filter(Boolean);

        // Filter by parks if requested
        if (parkFilter && parkFilter.length) {
          const match = bestParks.some(p => parkFilter.some(pf => p.toLowerCase().includes(pf)));
          if (!match) return null;
        }

        // Downsize Cloudinary photo to thumbnail for offline storage
        let thumbUrl = f['Photo URL'] || '';
        if (thumbUrl.includes('cloudinary.com')) {
          thumbUrl = thumbUrl.replace('/image/upload/', '/image/upload/w_400,h_300,c_fill,q_auto,f_jpg/');
        }

        return {
          id:                 r.id,
          name:               f['Species Name'] || '',
          scientificName:     f['Scientific Name'] || '',
          type:               f.Type || '',
          category:           f.Category || '',
          conservationStatus: f['Conservation Status'] || '',
          description:        f.Description || '',
          habitat:            f.Habitat || '',
          bestParks,
          bestMonths:         Array.isArray(f['Best Months']) ? f['Best Months'] : (f['Best Months'] || '').split(',').map(s => s.trim()).filter(Boolean),
          photoUrl:           thumbUrl,
          ebirdCode:          f['eBird Code'] || '',
          inaturalistId:      f['iNaturalist ID'] || '',
        };
      })
      .filter(Boolean);

    // Cache-friendly headers — good for 6 hours
    res.setHeader('Cache-Control', 'public, max-age=21600');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      generated: new Date().toISOString(),
      count:     species.length,
      parks:     parkFilter || [],
      species,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
