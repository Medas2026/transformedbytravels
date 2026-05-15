const BASE_ID = 'appdlxcWb45dIqNK2';

// Map region names to park name keywords for species filtering
// Keys must match the Region field values in Airtable (case-insensitive)
const REGION_PARKS = {
  // ── Africa ────────────────────────────────────────────────────────────────
  'east africa':                  ['serengeti', 'masai mara', 'maasai mara', 'ngorongoro', 'tarangire', 'amboseli', 'tsavo', 'samburu', 'nakuru', 'ol pejeta', 'laikipia', 'manyara', 'selous', 'ruaha', 'mikumi', 'bale mountains'],
  'south africa':                 ['kruger', 'sabi', 'sabi sands', 'hluhluwe', 'addo', 'pilanesberg', 'madikwe', 'timbavati', 'limpopo', 'luangwa', 'kafue', 'liuwa', 'lower zambezi', 'hwange', 'mana pools', 'victoria falls', 'gonarezhou', 'malawi', 'liwonde'],
  'botswana':                     ['okavango', 'chobe', 'moremi', 'makgadikgadi', 'central kalahari', 'linyanti', 'savuti'],
  'gorilla countries':            ['bwindi', 'volcanoes', 'kibale', 'queen elizabeth', 'mgahinga', 'nyungwe', 'akagera', 'murchison', 'kidepo', 'virunga'],
  'namibia':                      ['etosha', 'skeleton coast', 'damaraland', 'sossusvlei', 'namib', 'caprivi', 'bwabwata', 'mudumu'],
  'madagascar':                   ['ranomafana', 'andasibe', 'tsingy', 'berenty', 'kirindy', 'ankarana', 'isalo', 'masoala'],
  'ethiopia':                     ['simien', 'bale', 'awash', 'omo', 'gambella', 'nechisar'],

  // ── Asia ─────────────────────────────────────────────────────────────────
  'indian tigers & rhinos':       ['ranthambore', 'bandhavgarh', 'kanha', 'corbett', 'jim corbett', 'pench', 'tadoba', 'panna', 'chitwan', 'bardia', 'dudhwa'],
  'indian specialty wildlife':    ['kaziranga', 'gir', 'hemis', 'sundarbans', 'bharatpur', 'little rann', 'sagarmatha', 'langtang', 'kangchenjunga'],
  'sri lanka':                    ['yala', 'wilpattu', 'minneriya', 'udawalawe', 'sinharaja', 'horton plains', 'kumana'],
  'borneo':                       ['kinabatangan', 'danum valley', 'sepilok', 'tanjung puting', 'deramakot', 'maliau basin', 'tabin', 'crocker range'],
  'indonesia':                    ['komodo', 'raja ampat', 'sulawesi', 'tangkoko', 'lorentz', 'bunaken', 'wakatobi'],

  // ── Americas ─────────────────────────────────────────────────────────────
  'galápagos':                    ['galapagos', 'galápagos', 'santa cruz', 'isabela', 'española', 'fernandina', 'genovesa', 'bartolome'],
  'amazon':                       ['manu', 'tambopata', 'yasuni', 'cristalino', 'pacaya-samiria', 'cuyabeno', 'mamiraua', 'anavilhanas'],
  'northwest south america':      ['mindo', 'mashpi', 'los llanos', 'sierra nevada', 'tayrona', 'colca', 'cotapaxi', 'antisana', 'cloud forest', 'pacific coast'],
  'pantanal':                     ['pantanal', 'transpantaneira', 'bonito', 'serra da bodoquena'],
  'yellowstone':                  ['yellowstone', 'grand teton', 'lamar', 'hayden', 'glacier', 'bighorn'],
  'alaska & yukon':               ['denali', 'katmai', 'kenai', 'wrangell', 'tongass', 'kluane', 'arctic refuge', 'kodiak', 'lake clark'],
  'canadian arctic':              ['churchill', 'baffin', 'wapusk', 'auyuittuq', 'nunavut', 'hudson bay'],
  'central america':              ['corcovado', 'tortuguero', 'monteverde', 'manuel antonio', 'soberania', 'barro colorado', 'darien', 'arenal'],
  'patagonia':                    ['torres del paine', 'los glaciares', 'tierra del fuego', 'valdés', 'valdes', 'carretera austral', 'bernardo higgins', 'chiloé'],
  'antarctica & falklands':       ['antarctic peninsula', 'south georgia', 'falklands', 'falkland', 'weddell', 'ross sea', 'deception island'],

  // ── Pacific & Oceania ─────────────────────────────────────────────────────
  'australia':                    ['great barrier reef', 'kangaroo island', 'tasmania', 'kakadu', 'daintree', 'ningaloo', 'shark bay', 'lord howe'],
  'new zealand':                  ['fiordland', 'abel tasman', 'kaikoura', 'otago peninsula', 'stewart island', 'tongariro', 'poor knights'],

  // ── Legacy country aliases (backward compatibility) ───────────────────────
  'uganda':         ['bwindi', 'kibale', 'queen elizabeth', 'murchison', 'kidepo'],
  'rwanda':         ['volcanoes', 'nyungwe', 'akagera'],
  'uganda/rwanda':  ['bwindi', 'kibale', 'queen elizabeth', 'murchison', 'kidepo', 'volcanoes', 'nyungwe', 'akagera'],
  'kenya':          ['masai mara', 'amboseli', 'tsavo', 'samburu', 'nakuru'],
  'tanzania':       ['serengeti', 'ngorongoro', 'tarangire', 'manyara', 'selous', 'ruaha'],
  'zambia':         ['luangwa', 'zambezi', 'kafue', 'liuwa'],
  'zimbabwe':       ['hwange', 'mana pools', 'victoria falls', 'gonarezhou'],
};

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

  // Optional ?parks=Bwindi,Kibale or ?region=Gorilla+Countries or ?country=Rwanda (legacy)
  const { parks, region, country } = req.query;
  let parkFilter = parks ? parks.split(',').map(p => p.trim().toLowerCase()) : null;
  if (!parkFilter) {
    const regionStr = region || country || '';
    if (regionStr) {
      const regionKeys = regionStr.split(',').map(r => r.trim().toLowerCase());
      const combined = regionKeys.flatMap(k => REGION_PARKS[k] || []);
      parkFilter = combined.length ? [...new Set(combined)] : null;
    }
  }

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
      region:    region || country || null,
      parks:     parkFilter || [],
      species,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
