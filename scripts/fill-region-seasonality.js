// Populate Best Months + Avoid Months + Seasonality Notes on Animal Regions.
// Only writes to regions where the field is currently blank (won't overwrite
// anything you've already filled in). Safe to run repeatedly.
//
// Run:
//   node scripts/fill-region-seasonality.js --dry-run   (prints, no writes)
//   node scripts/fill-region-seasonality.js             (writes)

const fs   = require('fs');
const path = require('path');
const DRY  = process.argv.includes('--dry-run');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Animal Regions';
const KEY = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY'); process.exit(1); }

// Month tokens must match the multi-select options Airtable auto-creates.
// Typecast:true handles option creation.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DATA = {
  // ── Africa ──────────────────────────────────────────────────────────────
  'East Africa': {
    best:  ['Jun','Jul','Aug','Sep','Oct'],
    avoid: ['Apr','May'],
    notes: "The Great Migration crosses the Mara River Jul–Oct — the most dramatic wildlife spectacle on Earth. Dry season (Jun–Oct) concentrates game around water. Short rains Nov–Dec still deliver good game viewing; long rains Apr–May close many camps and turn roads to mud.",
  },
  'Gorilla Countries': {
    best:  ['Jun','Jul','Aug','Sep','Dec','Jan','Feb'],
    avoid: [],
    notes: "Gorilla trekking is year-round, but drier months (Jun–Sep, Dec–Feb) mean shorter, less muddy treks. Rainy months (Mar–May, Oct–Nov) bring lusher forest and fewer permits sold. Golden monkey and chimp tracking follow the same seasons.",
  },
  'South Africa': {
    best:  ['May','Jun','Jul','Aug','Sep'],
    avoid: [],
    notes: "Kruger's dry winter (May–Sep) concentrates game around waterholes and thins the bush for sightings. Cape Town's summer (Nov–Mar) is prime for whale watching off Hermanus. Green season (Nov–Feb) delivers newborns and bird migrants but denser vegetation.",
  },
  'Botswana': {
    best:  ['Jun','Jul','Aug','Sep','Oct'],
    avoid: ['Jan','Feb'],
    notes: "The paradox of Botswana — the Okavango Delta floods peak May–Aug even though it's the dry season, drawing wildlife from surrounding drylands. Chobe elephants gather in massive numbers Jul–Oct. Green season (Nov–Apr) brings lower prices and dramatic skies but harder game viewing.",
  },
  'Namibia': {
    best:  ['May','Jun','Jul','Aug','Sep','Oct'],
    avoid: ['Jan','Feb'],
    notes: "Etosha's dry season (May–Oct) concentrates game around waterholes — one of Africa's easiest game viewing environments. Skeleton Coast seal colonies active year-round with peak pupping Oct–Dec. Rainy season (Jan–Mar) brings scattered game but green landscapes.",
  },
  'Madagascar': {
    best:  ['Apr','May','Sep','Oct','Nov'],
    avoid: ['Jan','Feb','Mar'],
    notes: "Dry season (Apr–Nov) is when most lemurs are active and roads are passable. Best lemur baby viewing Sep–Nov. Cyclone season (Jan–Mar) closes many parks and reserves. Different regions have wildly different climates — check specifics for chosen parks.",
  },
  'Ethiopia': {
    best:  ['Oct','Nov','Dec','Jan','Feb'],
    avoid: ['Jun','Jul','Aug','Sep'],
    notes: "Simien and Bale Mountains at their most accessible Oct–Feb — dry season with clear skies. Gelada baboons and Ethiopian wolves are photographed best in this window. Kiremt rains (Jun–Sep) make highland roads difficult.",
  },
  'Mozambique': {
    best:  ['Apr','May','Jun','Jul','Aug','Sep','Oct'],
    avoid: ['Jan','Feb','Mar'],
    notes: "Whale shark aggregations off Tofo peak Oct–Mar though water is warmest. Manta rays year-round with best conditions May–Sep. Cyclone season (Dec–Mar) can close resorts. Bazaruto Archipelago diving best Apr–Sep.",
  },

  // ── Asia ────────────────────────────────────────────────────────────────
  'Northern India': {
    best:  ['Mar','Apr','May','Jun'],
    avoid: ['Jul','Aug','Sep'],
    notes: "Tiger sightings peak in the hot dry months (Apr–Jun) when tigers concentrate at scarce water. Parks close during monsoon (Jul–Sep) for breeding. Cooler months (Nov–Feb) are pleasant but sightings slightly harder in fuller vegetation.",
  },
  'Sri Lanka': {
    best:  ['Jan','Feb','Mar','Apr','Jul','Aug','Sep'],
    avoid: ['Oct','Nov'],
    notes: "Two monsoon seasons split Sri Lanka geographically — west/south coast dry Dec–Mar, east coast dry May–Sep. Leopard sightings peak in Yala's dry season (Feb–Jun). Elephant gatherings at Minneriya Aug–Sep are spectacular. Northeast monsoon (Oct–Jan) closes east coast parks.",
  },
  'Borneo': {
    best:  ['Mar','Apr','May','Jun','Jul','Aug','Sep'],
    avoid: ['Nov','Dec','Jan'],
    notes: "Orangutan and pygmy elephant viewing at Kinabatangan best in dry months (Mar–Oct). Turtle nesting on Selingan year-round with peak Jul–Sep. Monsoon (Nov–Feb) brings heavy rain and rough seas for Sipadan diving.",
  },
  'Indonesia': {
    best:  ['Apr','May','Jun','Sep','Oct','Nov'],
    avoid: ['Jan','Feb'],
    notes: "Komodo dragons active year-round but dry season (May–Oct) makes trails passable. Raja Ampat diving best Oct–Apr for whale sharks and calm seas. Bali/Java rainy season (Nov–Mar) brings afternoon downpours but greener landscapes.",
  },
  'Japan': {
    best:  ['Jan','Feb','Sep','Oct','Nov','Dec'],
    avoid: ['Jul','Aug'],
    notes: "Winter (Jan–Feb) is prime for red-crowned cranes, Steller sea eagles on Hokkaido pack ice, and snow monkeys at Jigokudani. Autumn (Sep–Nov) brings brown bear salmon feeding on Shiretoko. Summer humidity limits wildlife activity.",
  },
  'Philippines': {
    best:  ['Nov','Dec','Jan','Feb','Mar','Apr','May'],
    avoid: ['Jul','Aug'],
    notes: "Dry season (Nov–May) delivers calm seas and visibility for Tubbataha and Anilao diving. Whale shark aggregations off Donsol peak Feb–Apr. Typhoon season (Jun–Oct) closes Tubbataha entirely and disrupts inter-island travel.",
  },

  // ── Americas ────────────────────────────────────────────────────────────
  'Galápagos': {
    best:  ['Jun','Jul','Aug','Sep','Oct','Nov'],
    avoid: [],
    notes: "Cool dry season (Jun–Nov) means calmer diving and active seabirds. Warm rainy season (Dec–May) brings warmer water, more active reptiles, and lush vegetation. Whale sharks Jul–Nov at Darwin/Wolf, waved albatross at Espanola Apr–Dec, sea lion pupping Aug–Nov.",
  },
  'Amazon': {
    best:  ['Jun','Jul','Aug','Sep','Oct'],
    avoid: ['Feb','Mar','Apr'],
    notes: "Dry season (Jun–Oct) means concentrated wildlife at receding rivers and easier trail access. Wet season (Dec–May) floods forests and enables canoe access into flooded canopy for arboreal species. Different lodges optimize for different seasons — dry-forest specialists vs. flooded-forest specialists.",
  },
  'Andes': {
    best:  ['May','Jun','Jul','Aug','Sep'],
    avoid: ['Jan','Feb','Mar'],
    notes: "Dry season (May–Sep) delivers clear high-altitude skies for Andean condor viewing and vicuña photography on the altiplano. Wet season (Dec–Mar) makes trekking difficult and closes some routes. Manu cloud forest wildlife active year-round with peak biodiversity May–Oct.",
  },
  'Pantanal': {
    best:  ['Jul','Aug','Sep','Oct'],
    avoid: ['Jan','Feb','Mar'],
    notes: "Dry season (Jul–Oct) concentrates jaguars along rivers — Sep is peak. Wet season (Nov–Mar) floods vast areas, disperses wildlife, and closes many lodges. Bird migrations peak May and Sep. Water levels lowest (best jaguar viewing) Aug–Oct.",
  },
  'Central America': {
    best:  ['Dec','Jan','Feb','Mar','Apr'],
    avoid: ['Sep','Oct'],
    notes: "Dry season (Dec–Apr) is peak for beach turtle nesting, dry forest wildlife, and clear trails. Green season (May–Nov) brings resplendent quetzals to easier viewing, sea turtle nesting, and lower prices. Sep–Oct is heaviest rain — some Caribbean regions become inaccessible.",
  },
  'Patagonia': {
    best:  ['Nov','Dec','Jan','Feb','Mar'],
    avoid: ['Jun','Jul','Aug'],
    notes: "Southern hemisphere summer (Nov–Mar) is the only viable window for Torres del Paine trekking, puma tracking, and whale watching from Valdés. Winter (Jun–Aug) closes most trails and access roads. Best puma sightings Apr–May and Sep–Oct — shoulder seasons deliver quiet.",
  },
  'Alaska & Yukon': {
    best:  ['Jun','Jul','Aug','Sep'],
    avoid: ['Nov','Dec','Jan','Feb','Mar'],
    notes: "Peak wildlife viewing summer (Jun–Sep) when brown bears feed on salmon runs at Brooks Falls and Katmai. Fall (Sep) delivers rutting moose, aurora, and bear fat-up feeding. Winter is dark and cold, most access impossible.",
  },
  'Yellowstone': {
    best:  ['May','Jun','Jul','Aug','Sep','Oct'],
    avoid: [],
    notes: "Summer (Jun–Aug) delivers full park access and bison calf viewing. Fall (Sep–Oct) is elk rut season with dramatic bugling. Winter (Dec–Mar) is a different experience — wolves are easiest to see against snow but access limited to snowmobile/snow coach.",
  },
  'Canadian Arctic': {
    best:  ['Jul','Aug','Sep','Oct','Nov'],
    avoid: ['Jan','Feb','Mar'],
    notes: "Polar bear season in Churchill peaks Oct–Nov as bears wait for Hudson Bay to freeze. Beluga whale viewing at Churchill Jul–Aug. Narwhal viewing at the floe edge in the High Arctic May–Jul. Winter is too cold and dark for most viewing.",
  },
  'Canadian Rockies': {
    best:  ['Jun','Jul','Aug','Sep'],
    avoid: ['Nov','Dec','Jan','Mar','Apr'],
    notes: "Summer (Jun–Sep) for grizzly, moose, elk, and mountain goat viewing in Banff/Jasper. Fall (Sep–Oct) brings rutting elk and dramatic light. Winter delivers wolves and lynx tracking but severe cold and limited access. May can still hold snow at elevation.",
  },
  'Pacific Coast': {
    best:  ['May','Jun','Jul','Aug','Sep'],
    avoid: ['Nov','Dec','Jan'],
    notes: "Orca season peaks Jun–Sep off Vancouver Island — the resident pods concentrate around Johnstone Strait. Grizzly bear viewing at Knight Inlet best Aug–Oct during salmon runs. Winter storms and rain limit boat-based viewing.",
  },
  'Lake Superior': {
    best:  ['May','Jun','Jul','Aug','Sep','Oct'],
    avoid: ['Feb','Mar'],
    notes: "Isle Royale accessible Apr–Oct. Moose calving May–Jun, wolf tracking easiest in early season. Fall migrations of hawks and songbirds through the Duluth corridor Sep–Oct. Winter closes most access but delivers dramatic wolf-on-snow viewing for hardier travelers.",
  },
  'Mexico': {
    best:  ['Dec','Jan','Feb','Mar'],
    avoid: ['Aug','Sep','Oct'],
    notes: "Monarch butterfly migration in Michoacán peaks Nov–Mar. Gray whale calving in Baja lagoons Jan–Mar. Whale shark aggregations off Isla Contoy Jun–Sep. Hurricane season (Jun–Nov) affects Caribbean coast; dry season perfect for cenotes and inland wildlife.",
  },

  // ── Pacific ─────────────────────────────────────────────────────────────
  'Australia': {
    best:  ['Apr','May','Jun','Jul','Aug','Sep','Oct'],
    avoid: ['Jan','Feb'],
    notes: "Different regions have different windows — Northern Australia dry (May–Oct), Southern Australia summer (Nov–Feb). Great Barrier Reef diving best Jun–Nov. Kangaroo Island wildlife year-round. Cyclone season (Nov–Apr) affects the north.",
  },
  'New Zealand': {
    best:  ['Nov','Dec','Jan','Feb','Mar','Apr'],
    avoid: ['Jun','Jul','Aug'],
    notes: "Southern summer (Nov–Apr) for fur seal pups, kea watching, and yellow-eyed penguin viewing on Otago. Winter is cold and wet — many trails closed. Whales year-round off Kaikōura with sperm whales resident.",
  },
  'Fiji': {
    best:  ['May','Jun','Jul','Aug','Sep','Oct'],
    avoid: ['Jan','Feb'],
    notes: "Dry season (May–Oct) delivers calm seas for Rainbow Reef diving. Humpback whale season Jul–Sep. Manta rays year-round at Wakaya cleaning stations. Cyclone season (Nov–Apr) affects diving and resort access.",
  },
  'Micronesia': {
    best:  ['Nov','Dec','Jan','Feb','Mar','Apr','May'],
    avoid: ['Aug','Sep','Oct'],
    notes: "Dry season (Dec–Apr) is peak for Palau's Blue Corner, Chuuk wrecks, and Yap's manta rays. Rainy season (Jul–Nov) brings tropical storms and can close remote atolls. Typhoons occasional Jun–Nov.",
  },
  'Papua New Guinea': {
    best:  ['May','Jun','Jul','Aug','Sep','Oct','Nov'],
    avoid: ['Feb','Mar'],
    notes: "Bird of paradise displays year-round with peak courtship Jul–Nov. Muck diving at Kimbe Bay best Apr–Nov. Highland treks best in dry season (May–Sep). Wet season Dec–Mar closes some highland routes.",
  },

  // ── Europe ──────────────────────────────────────────────────────────────
  'European Wildlife': {
    best:  ['May','Jun','Jul','Aug','Sep'],
    avoid: [],
    notes: "Brown bear viewing in Slovenia/Romania peaks Apr–Oct with peak activity dawn/dusk. European bison in Białowieża year-round with best viewing in snow (Dec–Feb) against forest. Iberian lynx in Andalusia best Jan–Mar during mating. Nordic reindeer migrations spring/autumn.",
  },
  'Iceland': {
    best:  ['Jun','Jul','Aug'],
    avoid: ['Nov','Dec','Jan','Feb'],
    notes: "Puffin colonies active May–Aug at Látrabjarg and Vestmannaeyjar. Whale watching from Húsavík peaks Jun–Sep. Northern lights viewing Nov–Mar but access to remote coast limited. Winter storms can close roads.",
  },

  // ── Polar ───────────────────────────────────────────────────────────────
  'Svalbard': {
    best:  ['May','Jun','Jul','Aug','Sep'],
    avoid: ['Nov','Dec','Jan','Feb','Mar'],
    notes: "Polar bear expeditions Jun–Aug when pack ice recedes but bears still hunt. Walrus haul-outs peak Jul–Aug. Beluga and bowhead whales Jul–Sep. Winter (Nov–Mar) is dark, cold, and largely inaccessible.",
  },
  'Antarctica & Falklands': {
    best:  ['Nov','Dec','Jan','Feb','Mar'],
    avoid: ['May','Jun','Jul','Aug'],
    notes: "Antarctic summer (Nov–Mar) is the only viable travel window. Nov delivers courtship displays and pristine snow; Dec–Jan brings peak breeding and 24-hour daylight; Feb–Mar delivers whales at feeding peaks and chick fledging. Winter travel is impossible.",
  },
};

async function airtable(pth, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}${pth}`, opts);
  return resp.json();
}

async function main() {
  console.log(`${DRY ? '[DRY RUN] ' : ''}Filling seasonality on Animal Regions…`);
  const records = [];
  let offset = '';
  do {
    const p = new URLSearchParams();
    if (offset) p.set('offset', offset);
    const data = await airtable(`/${encodeURIComponent(TABLE)}?${p.toString()}`);
    if (data.error) { console.error(data.error); process.exit(1); }
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);

  const byName = new Map(records.map(r => [r.fields.Region, r]));
  const updates = [];
  const skips   = [];
  const missing = [];

  for (const [regionName, seed] of Object.entries(DATA)) {
    const rec = byName.get(regionName);
    if (!rec) { missing.push(regionName); continue; }
    const f = rec.fields;
    const fields = {};
    // Only fill blank fields — never overwrite user edits
    if (!Array.isArray(f['Best Months'])  || !f['Best Months'].length)  fields['Best Months']       = seed.best;
    if (!Array.isArray(f['Avoid Months']) || !f['Avoid Months'].length) fields['Avoid Months']      = seed.avoid;
    if (!(f['Seasonality Notes'] || '').trim())                          fields['Seasonality Notes'] = seed.notes;
    if (!Object.keys(fields).length) { skips.push(regionName); continue; }
    console.log(`  → ${regionName.padEnd(26)} filling: ${Object.keys(fields).join(', ')}`);
    updates.push({ id: rec.id, fields });
  }

  if (missing.length) {
    console.log(`\n⚠️  Not in Airtable: ${missing.join(', ')}`);
  }
  if (skips.length) {
    console.log(`\n· Already populated (skipped): ${skips.join(', ')}`);
  }
  console.log(`\n${updates.length} records to update.`);

  if (!updates.length) return;
  if (DRY) { console.log('[DRY RUN] Skipping PATCH.'); return; }

  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const data = await airtable(`/${encodeURIComponent(TABLE)}`, 'PATCH', { records: batch, typecast: true });
    if (data.error) { console.error('PATCH failed:', data.error); process.exit(1); }
    console.log(`  ✓ PATCHed ${data.records.length}`);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
