// Tag Animal Regions on TBT Wildlife records based on Best Parks field
// Phase 1: node scripts/tag-species-regions.js preview   → outputs CSV for review
// Phase 2: node scripts/tag-species-regions.js apply     → writes to Airtable
//
// Requires: AIRTABLE_API_KEY in .env.local

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const KEY     = (fs.readFileSync(path.join(__dirname,'../.env.local'),'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/)||[])[1]?.trim();
const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'TBT Wildlife';

if (!KEY) { console.error('AIRTABLE_API_KEY not found in .env.local'); process.exit(1); }

// ── Region → Parks map (from species-pack.js) ────────────────────────────────
const REGION_PARKS = {
  'East Africa':              ['serengeti','masai mara','maasai mara','ngorongoro','tarangire','amboseli','tsavo','samburu','nakuru','ol pejeta','laikipia','manyara','selous','ruaha','mikumi','bale mountains'],
  'South Africa':             ['kruger','sabi','sabi sands','hluhluwe','addo','pilanesberg','madikwe','timbavati','limpopo','luangwa','kafue','liuwa','lower zambezi','hwange','mana pools','victoria falls','gonarezhou','malawi','liwonde'],
  'Botswana':                 ['okavango','chobe','moremi','makgadikgadi','central kalahari','linyanti','savuti'],
  'Gorilla Countries':        ['bwindi','volcanoes','kibale','queen elizabeth','mgahinga','nyungwe','akagera','murchison','kidepo','virunga','ziwa','gishwati'],
  'Namibia':                  ['etosha','skeleton coast','damaraland','sossusvlei','namib','caprivi','bwabwata','mudumu'],
  'Madagascar':               ['ranomafana','andasibe','tsingy','berenty','kirindy','ankarana','isalo','masoala'],
  'Ethiopia':                 ['simien','bale','awash','omo','gambella','nechisar'],
  'Mozambique':               ['gorongosa','niassa','zinave','bazaruto','quirimbas','maputo'],
  'Indian Tigers & Rhinos':   ['ranthambore','bandhavgarh','kanha','corbett','jim corbett','pench','tadoba','panna','chitwan','bardia','dudhwa'],
  'Indian Specialty Wildlife':['kaziranga','gir','hemis','sundarbans','bharatpur','little rann','sagarmatha','langtang','kangchenjunga'],
  'Sri Lanka':                ['yala','wilpattu','minneriya','udawalawe','sinharaja','horton plains','kumana'],
  'Borneo':                   ['kinabatangan','danum valley','sepilok','tanjung puting','deramakot','maliau basin','tabin','crocker range'],
  'Indonesia':                ['komodo','raja ampat','sulawesi','tangkoko','lorentz','bunaken','wakatobi'],
  'Galápagos':                ['galapagos','galápagos','santa cruz','isabela','española','fernandina','genovesa','bartolome'],
  'Amazon':                   ['manu','tambopata','yasuni','cristalino','pacaya-samiria','cuyabeno','mamiraua','anavilhanas'],
  'Andes':                    ['mindo','mashpi','los llanos','sierra nevada','tayrona','colca','cotapaxi','antisana','cloud forest','pacific coast'],
  'Pantanal':                 ['pantanal','transpantaneira','bonito','serra da bodoquena'],
  'Yellowstone':              ['yellowstone','grand teton','lamar','hayden','glacier','bighorn'],
  'Alaska & Yukon':           ['denali','katmai','kenai','wrangell','tongass','kluane','arctic refuge','kodiak','lake clark'],
  'Canadian Arctic':          ['churchill','baffin','wapusk','auyuittuq','nunavut','hudson bay'],
  'Central America':          ['corcovado','tortuguero','monteverde','manuel antonio','soberania','barro colorado','darien','arenal'],
  'Patagonia':                ['torres del paine','los glaciares','tierra del fuego','valdés','valdes','carretera austral','bernardo higgins','chiloé'],
  'Antarctica & Falklands':   ['antarctic peninsula','south georgia','falklands','falkland','weddell','ross sea','deception island'],
  'Australia':                ['great barrier reef','kangaroo island','tasmania','kakadu','daintree','ningaloo','shark bay','lord howe'],
  'New Zealand':              ['fiordland','abel tasman','kaikoura','otago peninsula','stewart island','tongariro','poor knights'],
  'Fiji':                     ['fiji','beqa','yasawa','taveuni','somosomo','rainbow reef','bligh water'],
  'Micronesia':               ['palau','truk','chuuk','yap','pohnpei','kosrae','blue corner','jellyfish lake'],
  'Philippines':              ['tubbataha','apo island','coron','el nido','anilao','moalboal','puerto galera','palawan'],
  'Papua New Guinea':         ['milne bay','kimbe bay','madang','manus','kavieng','tufi','varirata','tari'],
  'Canadian Rockies':         ['banff','jasper','yoho','kootenay','waterton','icefields','columbia icefield'],
  'Svalbard':                 ['svalbard','longyearbyen','spitsbergen','nordaustlandet'],
  'European Wildlife':        ['bialowieza','białowieża','danube delta','donana','doñana','coto donana','carpathian','camargue','neusiedler','hortobagy','hortobágy'],
};

// Build reverse map: park keyword → [regions]
const PARK_TO_REGIONS = {};
for (const [region, parks] of Object.entries(REGION_PARKS)) {
  for (const park of parks) {
    if (!PARK_TO_REGIONS[park]) PARK_TO_REGIONS[park] = [];
    PARK_TO_REGIONS[park].push(region);
  }
}

function regionsForParks(bestParks) {
  if (!Array.isArray(bestParks) || !bestParks.length) return [];
  const found = new Set();
  for (const park of bestParks) {
    const parkLower = park.toLowerCase();
    for (const [keyword, regions] of Object.entries(PARK_TO_REGIONS)) {
      if (parkLower.includes(keyword)) regions.forEach(r => found.add(r));
    }
  }
  return [...found].sort();
}

// ── Airtable helpers ──────────────────────────────────────────────────────────
function atGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.airtable.com',
      path,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + KEY }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end();
  });
}

function atPatch(records) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ records });
    const req = https.request({
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`,
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchAll() {
  const records = [];
  let offset = '';
  do {
    const qs = offset ? `?offset=${offset}` : '';
    const data = await atGet(`/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${qs}`);
    if (data.error) { console.error('Airtable error:', data.error); process.exit(1); }
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const mode = process.argv[2] || 'preview';

(async () => {
  console.error('Fetching TBT Wildlife records…');
  const records = await fetchAll();
  console.error(`Loaded ${records.length} species`);

  const proposals = records.map(r => {
    const name    = r.fields['Species Name'] || '';
    const parks   = r.fields['Best Parks'] || [];
    const regions = regionsForParks(parks);
    return { id: r.id, name, parks, regions };
  });

  if (mode === 'preview') {
    // Output CSV for review
    console.log('Species Name,Best Parks,Proposed Animal Regions,Notes');
    proposals.forEach(p => {
      const escape = v => `"${String(v).replace(/"/g,'""')}"`;
      const note = p.regions.length === 0 ? 'REVIEW — no park match' : '';
      console.log([p.name, p.parks.join(' | '), p.regions.join(' | '), note].map(escape).join(','));
    });
    const noMatch = proposals.filter(p => p.regions.length === 0).length;
    console.error(`\nProposed: ${proposals.length - noMatch} species`);
    console.error(`Needs review (no park match): ${noMatch}`);

  } else if (mode === 'apply') {
    // Write in batches of 10 (Airtable limit)
    const toUpdate = proposals.filter(p => p.regions.length > 0);
    console.error(`Writing ${toUpdate.length} species to Airtable…`);
    for (let i = 0; i < toUpdate.length; i += 10) {
      const batch = toUpdate.slice(i, i + 10).map(p => ({
        id: p.id,
        fields: { 'Animal Regions': p.regions }
      }));
      const result = await atPatch(batch);
      if (result.error) { console.error('Error:', result.error); process.exit(1); }
      process.stderr.write(`  ${Math.min(i + 10, toUpdate.length)}/${toUpdate.length}\r`);
    }
    console.error('\nDone.');
  } else {
    console.error('Usage: node tag-species-regions.js [preview|apply]');
  }
})();
