// Add Wildlife Locations for all remaining regions
// Run: node scripts/add-remaining-locations.js [--dry-run]

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Wildlife Locations';
const DRY_RUN = process.argv.includes('--dry-run');

const fs   = require('fs');
const path = require('path');
const KEY  = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY'); process.exit(1); }

const NEW_LOCATIONS = [
  // ── Galápagos ─────────────────────────────────────────────────────────────
  { name: 'Santa Cruz Island',        region: 'Galápagos',            continent: 'South America', country: 'Ecuador', lat: -0.63,   lng: -90.37  },
  { name: 'Isabela Island',           region: 'Galápagos',            continent: 'South America', country: 'Ecuador', lat: -0.95,   lng: -91.08  },
  { name: 'Española Island',          region: 'Galápagos',            continent: 'South America', country: 'Ecuador', lat: -1.35,   lng: -89.68  },
  { name: 'Fernandina Island',        region: 'Galápagos',            continent: 'South America', country: 'Ecuador', lat: -0.40,   lng: -91.55  },
  { name: 'Genovesa Island',          region: 'Galápagos',            continent: 'South America', country: 'Ecuador', lat:  0.32,   lng: -89.95  },
  { name: 'Bartolomé Island',         region: 'Galápagos',            continent: 'South America', country: 'Ecuador', lat: -0.28,   lng: -90.55  },
  { name: 'San Cristóbal Island',     region: 'Galápagos',            continent: 'South America', country: 'Ecuador', lat: -0.83,   lng: -89.43  },
  { name: 'North Seymour Island',     region: 'Galápagos',            continent: 'South America', country: 'Ecuador', lat: -0.37,   lng: -90.29  },

  // ── Amazon ────────────────────────────────────────────────────────────────
  { name: 'Manu National Park',       region: 'Amazon',               continent: 'South America', country: 'Peru',    lat: -12.00,  lng: -71.50  },
  { name: 'Tambopata Reserve',        region: 'Amazon',               continent: 'South America', country: 'Peru',    lat: -12.80,  lng: -69.28  },
  { name: 'Yasuní National Park',     region: 'Amazon',               continent: 'South America', country: 'Ecuador', lat: -0.93,   lng: -76.42  },
  { name: 'Cristalino Lodge',         region: 'Amazon',               continent: 'South America', country: 'Brazil',  lat: -9.60,   lng: -55.93  },
  { name: 'Pacaya-Samiria Reserve',   region: 'Amazon',               continent: 'South America', country: 'Peru',    lat: -5.50,   lng: -74.50  },
  { name: 'Cuyabeno Reserve',         region: 'Amazon',               continent: 'South America', country: 'Ecuador', lat: -0.00,   lng: -76.20  },
  { name: 'Mamirauá Reserve',         region: 'Amazon',               continent: 'South America', country: 'Brazil',  lat: -2.50,   lng: -65.00  },
  { name: 'Anavilhanas National Park',region: 'Amazon',               continent: 'South America', country: 'Brazil',  lat: -2.70,   lng: -60.95  },

  // ── Andes ─────────────────────────────────────────────────────────────────
  { name: 'Mindo Cloud Forest',       region: 'Andes',                continent: 'South America', country: 'Ecuador', lat: -0.05,   lng: -78.77  },
  { name: 'Mashpi Reserve',           region: 'Andes',                continent: 'South America', country: 'Ecuador', lat:  0.13,   lng: -78.87  },
  { name: 'Los Llanos',               region: 'Andes',                continent: 'South America', country: 'Venezuela', lat: 7.75,  lng: -68.50  },
  { name: 'Tayrona National Park',    region: 'Andes',                continent: 'South America', country: 'Colombia', lat: 11.33,  lng: -73.92  },
  { name: 'Colca Canyon',             region: 'Andes',                continent: 'South America', country: 'Peru',    lat: -15.53,  lng: -71.97  },
  { name: 'Cotopaxi National Park',   region: 'Andes',                continent: 'South America', country: 'Ecuador', lat: -0.68,   lng: -78.44  },
  { name: 'Antisana Ecological Reserve', region: 'Andes',            continent: 'South America', country: 'Ecuador', lat: -0.48,   lng: -78.15  },

  // ── Pantanal ──────────────────────────────────────────────────────────────
  { name: 'Transpantaneira Highway',  region: 'Pantanal',             continent: 'South America', country: 'Brazil',  lat: -16.40,  lng: -56.80  },
  { name: 'Porto Jofre',             region: 'Pantanal',             continent: 'South America', country: 'Brazil',  lat: -17.35,  lng: -56.78  },
  { name: 'Bonito',                  region: 'Pantanal',             continent: 'South America', country: 'Brazil',  lat: -21.12,  lng: -56.48  },
  { name: 'Caiman Ecological Refuge',region: 'Pantanal',             continent: 'South America', country: 'Brazil',  lat: -19.93,  lng: -56.32  },
  { name: 'Araras Ecolodge',         region: 'Pantanal',             continent: 'South America', country: 'Brazil',  lat: -16.17,  lng: -56.65  },
  { name: 'Serra da Bodoquena',      region: 'Pantanal',             continent: 'South America', country: 'Brazil',  lat: -20.88,  lng: -56.80  },

  // ── Central America ───────────────────────────────────────────────────────
  { name: 'Corcovado National Park',  region: 'Central America',      continent: 'North America', country: 'Costa Rica', lat: 8.55,  lng: -83.57  },
  { name: 'Tortuguero National Park', region: 'Central America',      continent: 'North America', country: 'Costa Rica', lat: 10.55, lng: -83.50  },
  { name: 'Monteverde Cloud Forest',  region: 'Central America',      continent: 'North America', country: 'Costa Rica', lat: 10.30, lng: -84.82  },
  { name: 'Manuel Antonio National Park', region: 'Central America',  continent: 'North America', country: 'Costa Rica', lat: 9.38,  lng: -84.14  },
  { name: 'Soberanía National Park',  region: 'Central America',      continent: 'North America', country: 'Panama',  lat:  9.13,   lng: -79.73  },
  { name: 'Darién National Park',     region: 'Central America',      continent: 'North America', country: 'Panama',  lat:  8.00,   lng: -77.73  },
  { name: 'Arenal Volcano National Park', region: 'Central America',  continent: 'North America', country: 'Costa Rica', lat: 10.46, lng: -84.70  },
  { name: 'Barro Colorado Island',    region: 'Central America',      continent: 'North America', country: 'Panama',  lat:  9.15,   lng: -79.83  },

  // ── Patagonia ─────────────────────────────────────────────────────────────
  { name: 'Torres del Paine National Park', region: 'Patagonia',      continent: 'South America', country: 'Chile',   lat: -50.93,  lng: -73.05  },
  { name: 'Los Glaciares National Park',    region: 'Patagonia',      continent: 'South America', country: 'Argentina', lat: -50.00, lng: -73.00 },
  { name: 'Valdés Peninsula',         region: 'Patagonia',            continent: 'South America', country: 'Argentina', lat: -42.43, lng: -63.93 },
  { name: 'Tierra del Fuego National Park', region: 'Patagonia',      continent: 'South America', country: 'Argentina', lat: -54.55, lng: -68.55 },
  { name: 'Carretera Austral',        region: 'Patagonia',            continent: 'South America', country: 'Chile',   lat: -46.00,  lng: -72.50  },
  { name: 'Chiloé Island',            region: 'Patagonia',            continent: 'South America', country: 'Chile',   lat: -42.65,  lng: -73.95  },

  // ── Antarctica & Falklands ────────────────────────────────────────────────
  { name: 'Antarctic Peninsula',      region: 'Antarctica & Falklands', continent: 'South America', country: 'Antarctica', lat: -64.78, lng: -62.58 },
  { name: 'South Georgia Island',     region: 'Antarctica & Falklands', continent: 'South America', country: 'South Georgia', lat: -54.28, lng: -36.51 },
  { name: 'Falkland Islands',         region: 'Antarctica & Falklands', continent: 'South America', country: 'Falkland Islands', lat: -51.70, lng: -59.52 },
  { name: 'Deception Island',         region: 'Antarctica & Falklands', continent: 'South America', country: 'Antarctica', lat: -62.97, lng: -60.65 },
  { name: 'Weddell Sea',              region: 'Antarctica & Falklands', continent: 'South America', country: 'Antarctica', lat: -72.00, lng: -40.00 },
  { name: 'South Shetland Islands',   region: 'Antarctica & Falklands', continent: 'South America', country: 'Antarctica', lat: -62.08, lng: -58.60 },

  // ── Yellowstone ───────────────────────────────────────────────────────────
  { name: 'Yellowstone National Park',region: 'Yellowstone',          continent: 'North America', country: 'USA',     lat: 44.43,   lng: -110.59  },
  { name: 'Grand Teton National Park',region: 'Yellowstone',          continent: 'North America', country: 'USA',     lat: 43.73,   lng: -110.80  },
  { name: 'Lamar Valley',             region: 'Yellowstone',          continent: 'North America', country: 'USA',     lat: 44.88,   lng: -110.22  },
  { name: 'Hayden Valley',            region: 'Yellowstone',          continent: 'North America', country: 'USA',     lat: 44.65,   lng: -110.50  },
  { name: 'Glacier National Park',    region: 'Yellowstone',          continent: 'North America', country: 'USA',     lat: 48.70,   lng: -113.72  },
  { name: 'Bighorn Canyon',           region: 'Yellowstone',          continent: 'North America', country: 'USA',     lat: 45.12,   lng: -108.17  },

  // ── Alaska & Yukon ────────────────────────────────────────────────────────
  { name: 'Denali National Park',     region: 'Alaska & Yukon',       continent: 'North America', country: 'USA',     lat: 63.33,   lng: -150.50  },
  { name: 'Katmai National Park',     region: 'Alaska & Yukon',       continent: 'North America', country: 'USA',     lat: 58.60,   lng: -154.97  },
  { name: 'Kenai Fjords National Park', region: 'Alaska & Yukon',     continent: 'North America', country: 'USA',     lat: 59.92,   lng: -150.00  },
  { name: 'Wrangell-St. Elias National Park', region: 'Alaska & Yukon', continent: 'North America', country: 'USA', lat: 61.50,   lng: -142.00  },
  { name: 'Tongass National Forest',  region: 'Alaska & Yukon',       continent: 'North America', country: 'USA',     lat: 57.05,   lng: -135.00  },
  { name: 'Kluane National Park',     region: 'Alaska & Yukon',       continent: 'North America', country: 'Canada',  lat: 60.72,   lng: -138.42  },
  { name: 'Arctic National Wildlife Refuge', region: 'Alaska & Yukon', continent: 'North America', country: 'USA',   lat: 68.50,   lng: -143.50  },
  { name: 'Kodiak Island',            region: 'Alaska & Yukon',       continent: 'North America', country: 'USA',     lat: 57.50,   lng: -153.40  },

  // ── Canadian Arctic ───────────────────────────────────────────────────────
  { name: 'Churchill',                region: 'Canadian Arctic',      continent: 'North America', country: 'Canada',  lat: 58.77,   lng: -94.17  },
  { name: 'Wapusk National Park',     region: 'Canadian Arctic',      continent: 'North America', country: 'Canada',  lat: 57.90,   lng: -93.22  },
  { name: 'Baffin Island',            region: 'Canadian Arctic',      continent: 'North America', country: 'Canada',  lat: 68.00,   lng: -73.00  },
  { name: 'Auyuittuq National Park',  region: 'Canadian Arctic',      continent: 'North America', country: 'Canada',  lat: 67.85,   lng: -65.12  },
  { name: 'Hudson Bay',               region: 'Canadian Arctic',      continent: 'North America', country: 'Canada',  lat: 60.00,   lng: -85.00  },
  { name: 'Nunavut Coast',            region: 'Canadian Arctic',      continent: 'North America', country: 'Canada',  lat: 70.00,   lng: -86.00  },

  // ── Canadian Rockies ──────────────────────────────────────────────────────
  { name: 'Banff National Park',      region: 'Canadian Rockies',     continent: 'North America', country: 'Canada',  lat: 51.50,   lng: -115.93  },
  { name: 'Jasper National Park',     region: 'Canadian Rockies',     continent: 'North America', country: 'Canada',  lat: 52.87,   lng: -118.08  },
  { name: 'Yoho National Park',       region: 'Canadian Rockies',     continent: 'North America', country: 'Canada',  lat: 51.42,   lng: -116.48  },
  { name: 'Kootenay National Park',   region: 'Canadian Rockies',     continent: 'North America', country: 'Canada',  lat: 50.93,   lng: -116.02  },
  { name: 'Waterton Lakes National Park', region: 'Canadian Rockies', continent: 'North America', country: 'Canada',  lat: 49.05,   lng: -113.92  },
  { name: 'Columbia Icefield',        region: 'Canadian Rockies',     continent: 'North America', country: 'Canada',  lat: 52.22,   lng: -117.22  },

  // ── Australia ─────────────────────────────────────────────────────────────
  { name: 'Great Barrier Reef',       region: 'Australia',            continent: 'Oceania', country: 'Australia', lat: -18.29,   lng: 147.70  },
  { name: 'Kangaroo Island',          region: 'Australia',            continent: 'Oceania', country: 'Australia', lat: -35.78,   lng: 137.18  },
  { name: 'Cradle Mountain',          region: 'Australia',            continent: 'Oceania', country: 'Australia', lat: -41.65,   lng: 145.95  },
  { name: 'Kakadu National Park',     region: 'Australia',            continent: 'Oceania', country: 'Australia', lat: -12.87,   lng: 132.47  },
  { name: 'Daintree Rainforest',      region: 'Australia',            continent: 'Oceania', country: 'Australia', lat: -16.17,   lng: 145.42  },
  { name: 'Ningaloo Reef',            region: 'Australia',            continent: 'Oceania', country: 'Australia', lat: -22.68,   lng: 113.70  },
  { name: 'Shark Bay',                region: 'Australia',            continent: 'Oceania', country: 'Australia', lat: -25.98,   lng: 113.77  },
  { name: 'Lord Howe Island',         region: 'Australia',            continent: 'Oceania', country: 'Australia', lat: -31.55,   lng: 159.08  },

  // ── New Zealand ───────────────────────────────────────────────────────────
  { name: 'Fiordland National Park',  region: 'New Zealand',          continent: 'Oceania', country: 'New Zealand', lat: -45.42,  lng: 167.72  },
  { name: 'Abel Tasman National Park',region: 'New Zealand',          continent: 'Oceania', country: 'New Zealand', lat: -40.90,  lng: 172.97  },
  { name: 'Kaikōura',                 region: 'New Zealand',          continent: 'Oceania', country: 'New Zealand', lat: -42.40,  lng: 173.68  },
  { name: 'Otago Peninsula',          region: 'New Zealand',          continent: 'Oceania', country: 'New Zealand', lat: -45.83,  lng: 170.72  },
  { name: 'Stewart Island',           region: 'New Zealand',          continent: 'Oceania', country: 'New Zealand', lat: -46.90,  lng: 168.10  },
  { name: 'Tongariro National Park',  region: 'New Zealand',          continent: 'Oceania', country: 'New Zealand', lat: -39.20,  lng: 175.57  },
  { name: 'Poor Knights Islands',     region: 'New Zealand',          continent: 'Oceania', country: 'New Zealand', lat: -35.47,  lng: 174.73  },

  // ── Philippines ───────────────────────────────────────────────────────────
  { name: 'Tubbataha Reef',           region: 'Philippines',          continent: 'Oceania', country: 'Philippines', lat: 8.93,    lng: 119.92  },
  { name: 'Apo Island',               region: 'Philippines',          continent: 'Oceania', country: 'Philippines', lat: 9.08,    lng: 123.27  },
  { name: 'Coron',                    region: 'Philippines',          continent: 'Oceania', country: 'Philippines', lat: 12.00,   lng: 120.20  },
  { name: 'El Nido',                  region: 'Philippines',          continent: 'Oceania', country: 'Philippines', lat: 11.18,   lng: 119.38  },
  { name: 'Anilao',                   region: 'Philippines',          continent: 'Oceania', country: 'Philippines', lat: 13.82,   lng: 120.90  },
  { name: 'Moalboal',                 region: 'Philippines',          continent: 'Oceania', country: 'Philippines', lat: 9.93,    lng: 123.40  },
  { name: 'Puerto Galera',            region: 'Philippines',          continent: 'Oceania', country: 'Philippines', lat: 13.52,   lng: 120.95  },

  // ── Papua New Guinea ──────────────────────────────────────────────────────
  { name: 'Milne Bay',                region: 'Papua New Guinea',     continent: 'Oceania', country: 'Papua New Guinea', lat: -10.30, lng: 150.47 },
  { name: 'Kimbe Bay',                region: 'Papua New Guinea',     continent: 'Oceania', country: 'Papua New Guinea', lat: -5.55,  lng: 150.15 },
  { name: 'Madang',                   region: 'Papua New Guinea',     continent: 'Oceania', country: 'Papua New Guinea', lat: -5.22,  lng: 145.80 },
  { name: 'Kavieng',                  region: 'Papua New Guinea',     continent: 'Oceania', country: 'Papua New Guinea', lat: -2.57,  lng: 150.80 },
  { name: 'Tufi',                     region: 'Papua New Guinea',     continent: 'Oceania', country: 'Papua New Guinea', lat: -9.07,  lng: 149.32 },
  { name: 'Varirata National Park',   region: 'Papua New Guinea',     continent: 'Oceania', country: 'Papua New Guinea', lat: -9.38,  lng: 147.22 },
  { name: 'Tari Valley',              region: 'Papua New Guinea',     continent: 'Oceania', country: 'Papua New Guinea', lat: -5.85,  lng: 142.95 },

  // ── Micronesia ────────────────────────────────────────────────────────────
  { name: 'Palau',                    region: 'Micronesia',           continent: 'Oceania', country: 'Palau',    lat:  7.50,    lng: 134.60  },
  { name: 'Jellyfish Lake',           region: 'Micronesia',           continent: 'Oceania', country: 'Palau',    lat:  7.16,    lng: 134.38  },
  { name: 'Blue Corner',              region: 'Micronesia',           continent: 'Oceania', country: 'Palau',    lat:  7.12,    lng: 134.22  },
  { name: 'Chuuk Lagoon',             region: 'Micronesia',           continent: 'Oceania', country: 'Micronesia', lat: 7.40,   lng: 151.82  },
  { name: 'Yap',                      region: 'Micronesia',           continent: 'Oceania', country: 'Micronesia', lat: 9.54,   lng: 138.13  },
  { name: 'Pohnpei',                  region: 'Micronesia',           continent: 'Oceania', country: 'Micronesia', lat: 6.87,   lng: 158.22  },

  // ── Svalbard ──────────────────────────────────────────────────────────────
  { name: 'Longyearbyen',             region: 'Svalbard',             continent: 'Europe', country: 'Norway',    lat: 78.22,    lng: 15.63   },
  { name: 'Spitsbergen',              region: 'Svalbard',             continent: 'Europe', country: 'Norway',    lat: 78.65,    lng: 16.32   },
  { name: 'Nordaustlandet',           region: 'Svalbard',             continent: 'Europe', country: 'Norway',    lat: 79.80,    lng: 22.00   },
  { name: 'Hornsund',                 region: 'Svalbard',             continent: 'Europe', country: 'Norway',    lat: 76.98,    lng: 15.75   },
  { name: 'Kongsfjorden',             region: 'Svalbard',             continent: 'Europe', country: 'Norway',    lat: 78.90,    lng: 12.55   },

  // ── European Wildlife ─────────────────────────────────────────────────────
  { name: 'Białowieża Forest',        region: 'European Wildlife',    continent: 'Europe', country: 'Poland',    lat: 52.70,    lng: 23.87   },
  { name: 'Danube Delta',             region: 'European Wildlife',    continent: 'Europe', country: 'Romania',   lat: 45.20,    lng: 29.45   },
  { name: 'Doñana National Park',     region: 'European Wildlife',    continent: 'Europe', country: 'Spain',     lat: 37.03,    lng: -6.45   },
  { name: 'Carpathian Mountains',     region: 'European Wildlife',    continent: 'Europe', country: 'Romania',   lat: 45.55,    lng: 25.22   },
  { name: 'Camargue',                 region: 'European Wildlife',    continent: 'Europe', country: 'France',    lat: 43.50,    lng: 4.62    },
  { name: 'Hortobágy National Park',  region: 'European Wildlife',    continent: 'Europe', country: 'Hungary',   lat: 47.60,    lng: 21.13   },
  { name: 'Neusiedler See',           region: 'European Wildlife',    continent: 'Europe', country: 'Austria',   lat: 47.77,    lng: 16.77   },

  // ── Iceland ───────────────────────────────────────────────────────────────
  { name: 'Þingvellir National Park', region: 'Iceland',              continent: 'Europe', country: 'Iceland',   lat: 64.26,    lng: -21.13  },
  { name: 'Vatnajökull National Park',region: 'Iceland',              continent: 'Europe', country: 'Iceland',   lat: 64.42,    lng: -16.97  },
  { name: 'Snæfellsnes Peninsula',    region: 'Iceland',              continent: 'Europe', country: 'Iceland',   lat: 64.90,    lng: -23.78  },
  { name: 'Lake Mývatn',             region: 'Iceland',              continent: 'Europe', country: 'Iceland',   lat: 65.60,    lng: -17.00  },
  { name: 'Jökulsárlón Glacier Lagoon', region: 'Iceland',           continent: 'Europe', country: 'Iceland',   lat: 64.05,    lng: -16.18  },
  { name: 'Westfjords',               region: 'Iceland',              continent: 'Europe', country: 'Iceland',   lat: 65.90,    lng: -23.45  },
];

async function airtableFetch(path, opts = {}) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  });
  return resp.json();
}

async function fetchExisting() {
  const records = [];
  let offset = '';
  do {
    const data = await airtableFetch(offset ? `?offset=${encodeURIComponent(offset)}` : '');
    if (data.error) throw new Error(JSON.stringify(data.error));
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

(async () => {
  console.log('Fetching existing locations…');
  const existing = await fetchExisting();
  const existingNames = new Set(existing.map(r => (r.fields['Location Name'] || '').toLowerCase().trim()));
  console.log(`${existing.length} existing locations\n`);

  const toAdd = NEW_LOCATIONS.filter(l => {
    if (existingNames.has(l.name.toLowerCase().trim())) {
      console.log(`  ↷ skip (exists): ${l.name}`);
      return false;
    }
    return true;
  });

  console.log(`\n${toAdd.length} new locations to add`);
  if (DRY_RUN) { console.log('Dry run — no changes written.'); return; }

  for (let i = 0; i < toAdd.length; i += 10) {
    const batch = toAdd.slice(i, i + 10).map(l => ({
      fields: {
        'Location Name': l.name,
        'Region':        l.region,
        'Continent':     l.continent,
        'Country':       l.country,
        'Lattitude':     l.lat,
        'Longitude':     l.lng,
      },
    }));
    const data = await airtableFetch('', { method: 'POST', body: JSON.stringify({ records: batch }) });
    if (data.error) throw new Error(JSON.stringify(data.error));
    process.stdout.write('.');
  }
  console.log(`\nDone — added ${toAdd.length} locations.`);
  console.log(`Total locations: ~${existing.length + toAdd.length}`);
})().catch(err => { console.error(err); process.exit(1); });
