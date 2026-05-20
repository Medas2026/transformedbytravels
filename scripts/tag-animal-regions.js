// Tag animal regions for wildlife destinations
// Reads destinations.js, applies country/airport rules, outputs a review CSV
//
// Run: node scripts/tag-animal-regions.js > scripts/region-proposals.csv

const fs   = require('fs');
const path = require('path');

// ── Load destinations ────────────────────────────────────────────────────────
const raw = fs.readFileSync(path.join(__dirname, '../js/destinations.js'), 'utf8');
// Strip the const declaration so we can eval just the array
const match = raw.match(/const DESTINATIONS\s*=\s*(\[[\s\S]*?\]);/);
if (!match) { console.error('Could not parse destinations.js'); process.exit(1); }
const DESTINATIONS = eval(match[1]);

// ── Wildlife passion filter ──────────────────────────────────────────────────
const WILDLIFE_PASSIONS = new Set([
  'Wildlife & Safari',
  'Birding',
  'National Parks',
  'Game Drive',
]);

function isWildlife(dest) {
  const passions = dest[6] || [];
  return passions.some(p => WILDLIFE_PASSIONS.has(p));
}

// ── Alaska airport codes ─────────────────────────────────────────────────────
const ALASKA_AIRPORTS = new Set([
  'FAI','ANC','JNU','KTN','SIT','CDV','OME','OTZ','BRW','AKN',
  'DLG','BET','YAK','ADQ','KSM','SNP','WRG','PSG','HNS','GST',
]);

// ── Borneo airport codes ─────────────────────────────────────────────────────
const BORNEO_AIRPORTS = new Set([
  'BKI','TWU','MYY','SDK','LBU','BTU','KCH','SBW','TGC',
]);

// ── Canadian Arctic airport codes ────────────────────────────────────────────
const ARCTIC_AIRPORTS = new Set([
  'YFB','YZS','YHI','YCO','YEK','YUX','YCK','YBB','YZF','YHY',
  'XRR','YSY','YRB','YGZ','YXH',
]);

// ── Amazon keywords ──────────────────────────────────────────────────────────
const AMAZON_KEYWORDS = [
  'amazon','manu','tambopata','yasuni','cristalino','pacaya','cuyabeno',
  'mamiraua','anavilhanas','iquitos','leticia','manaus','belem',
];

// ── Pantanal keywords ────────────────────────────────────────────────────────
const PANTANAL_KEYWORDS = [
  'pantanal','transpantaneira','bonito','bodoquena','campo grande','cuiaba',
];

// ── India tigers keywords ─────────────────────────────────────────────────────
const INDIA_TIGER_KEYWORDS = [
  'ranthambore','bandhavgarh','kanha','corbett','jim corbett','pench',
  'tadoba','panna','chitwan','bardia','dudhwa','tiger',
];

// ── India specialty keywords ──────────────────────────────────────────────────
const INDIA_SPECIALTY_KEYWORDS = [
  'kaziranga','gir','hemis','sundarbans','bharatpur','rann','sagarmatha',
  'langtang','kangchenjunga','rhino','snow leopard','asiatic lion',
];

function containsAny(str, keywords) {
  const s = str.toLowerCase();
  return keywords.some(k => s.includes(k));
}

// ── Main region assignment ────────────────────────────────────────────────────
function assignRegion(dest) {
  const [name, country, , airport] = dest;
  const nameLower    = name.toLowerCase();
  const countryLower = country.toLowerCase();

  // ── Africa ──────────────────────────────────────────────────────────────────
  if (['kenya', 'tanzania'].includes(countryLower))                  return 'East Africa';
  if (['uganda', 'rwanda'].includes(countryLower))                   return 'Gorilla Countries';
  if (['south africa'].includes(countryLower))                       return 'South Africa';
  if (countryLower === 'zambia')                                     return 'South Africa';
  if (countryLower === 'zimbabwe')                                   return 'South Africa';
  if (countryLower === 'malawi')                                     return 'South Africa';
  if (countryLower === 'botswana')                                   return 'Botswana';
  if (countryLower === 'namibia')                                    return 'Namibia';
  if (countryLower === 'madagascar')                                 return 'Madagascar';
  if (countryLower === 'ethiopia')                                   return 'Ethiopia';
  if (countryLower === 'mozambique')                                 return 'Mozambique';

  // ── Asia ────────────────────────────────────────────────────────────────────
  if (countryLower === 'sri lanka')                                  return 'Sri Lanka';
  if (countryLower === 'malaysia' || BORNEO_AIRPORTS.has(airport))  return 'Borneo';
  if (countryLower === 'indonesia') {
    if (BORNEO_AIRPORTS.has(airport))                               return 'Borneo';
    return 'Indonesia';
  }
  if (countryLower === 'india' || countryLower === 'nepal') {
    if (containsAny(name, INDIA_TIGER_KEYWORDS))                    return 'Indian Tigers & Rhinos';
    if (containsAny(name, INDIA_SPECIALTY_KEYWORDS))                return 'Indian Specialty Wildlife';
    return 'Indian Tigers & Rhinos'; // default for India wildlife
  }

  // ── Americas ─────────────────────────────────────────────────────────────────
  if (countryLower === 'ecuador') {
    if (containsAny(name, ['galapagos','galápagos','isabela','española','fernandina','genovesa','santa cruz']))
      return 'Galápagos';
    if (containsAny(name, AMAZON_KEYWORDS))                         return 'Amazon';
    return 'Andes';
  }
  if (countryLower === 'peru') {
    if (containsAny(name, AMAZON_KEYWORDS))                         return 'Amazon';
    return 'Andes';
  }
  if (countryLower === 'colombia') {
    if (containsAny(name, AMAZON_KEYWORDS))                         return 'Amazon';
    return 'Andes';
  }
  if (countryLower === 'brazil') {
    if (containsAny(name, PANTANAL_KEYWORDS))                       return 'Pantanal';
    return 'Amazon';
  }
  if (['costa rica','panama','belize','guatemala','honduras','nicaragua'].includes(countryLower))
    return 'Central America';
  if (['argentina','chile'].includes(countryLower))                 return 'Patagonia';
  if (countryLower === 'antarctica' || countryLower === 'falkland islands')
    return 'Antarctica & Falklands';

  // ── United States ────────────────────────────────────────────────────────────
  if (countryLower === 'united states') {
    if (ALASKA_AIRPORTS.has(airport) || containsAny(name, ['alaska','denali','katmai','kenai','kodiak','arctic']))
      return 'Alaska & Yukon';
    return 'Yellowstone'; // default for US wildlife
  }

  // ── Canada ───────────────────────────────────────────────────────────────────
  if (countryLower === 'canada') {
    if (ARCTIC_AIRPORTS.has(airport) || containsAny(name, ['arctic','churchill','baffin','wapusk','hudson','nunavut','polar bear']))
      return 'Canadian Arctic';
    if (airport === 'YVR' || airport === 'YYJ' || containsAny(name, ['yukon','kluane','whitehorse']))
      return 'Alaska & Yukon';
    return null; // most Canadian wildlife won't qualify — flag for review
  }

  // ── Europe ───────────────────────────────────────────────────────────────────
  if (countryLower === 'norway') {
    if (containsAny(name, ['svalbard','spitsbergen','longyearbyen']))return 'Svalbard';
    return null;
  }
  if (containsAny(name, ['bialowieza','białowieża','danube delta','doñana','donana','coto doñana','carpathian','camargue','neusiedler','hortobágy','hortobagy']))
    return 'European Wildlife';

  // ── Pacific ──────────────────────────────────────────────────────────────────
  if (countryLower === 'australia')                                  return 'Australia';
  if (countryLower === 'new zealand')                                return 'New Zealand';
  if (countryLower === 'fiji')                                       return 'Fiji';
  if (['micronesia','palau','marshall islands','guam'].includes(countryLower)) return 'Micronesia';
  if (countryLower === 'philippines')                                return 'Philippines';
  if (countryLower === 'papua new guinea')                           return 'Papua New Guinea';
  if (countryLower === 'canada' && containsAny(name, ['banff','jasper','yoho','kootenay','waterton','icefields','rockies']))
                                                                     return 'Canadian Rockies';

  return null; // no match — flag for manual review
}

// ── Run ───────────────────────────────────────────────────────────────────────
const wildlife = DESTINATIONS.filter(isWildlife);
const results  = wildlife.map(dest => {
  const [name, country, continent, airport, arch1, arch2, passions] = dest;
  const region  = assignRegion(dest);
  return { name, country, continent, airport, passions: passions.join(' | '), region: region || 'REVIEW' };
});

// Sort: REVIEW first so they're easy to find, then by region
results.sort((a, b) => {
  if (a.region === 'REVIEW' && b.region !== 'REVIEW') return -1;
  if (a.region !== 'REVIEW' && b.region === 'REVIEW') return  1;
  return a.region.localeCompare(b.region) || a.country.localeCompare(b.country);
});

// Output CSV
const escape = v => `"${String(v).replace(/"/g, '""')}"`;
console.log('Destination,Country,Continent,Airport,Passions,Proposed Region');
results.forEach(r => {
  console.log([r.name, r.country, r.continent, r.airport, r.passions, r.region].map(escape).join(','));
});

const reviewCount = results.filter(r => r.region === 'REVIEW').length;
process.stderr.write(`\nTotal wildlife destinations: ${results.length}\n`);
process.stderr.write(`Auto-assigned: ${results.length - reviewCount}\n`);
process.stderr.write(`Needs review:  ${reviewCount}\n`);
