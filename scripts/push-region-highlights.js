// Push highlight text into Animal Regions Airtable fields
// node scripts/push-region-highlights.js

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const KEY     = (fs.readFileSync(path.join(__dirname,'../.env.local'),'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/)||[])[1]?.trim();
const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Animal Regions';

const HIGHLIGHTS = {
  'East Africa': {
    land:  'The Serengeti-Mara ecosystem hosts the greatest wildlife spectacle on earth. Two million wildebeest, zebra and gazelle move in an endless circuit — and where the herds go, the predators follow. Lion, leopard, cheetah and wild dog are all within reach on a single day\'s drive.',
    sky:   'East Africa\'s Rift Valley lakes turn pink with a million flamingos. The acacia savannahs hold an extraordinary density of raptors and storks, while Samburu\'s northern arid zone holds endemic species found nowhere else — Grevy\'s zebra, reticulated giraffe, and the vulturine guineafowl.',
  },
  'Gorilla Countries': {
    land:  'Uganda and Rwanda share more than half the world\'s remaining mountain gorillas. Tracking a habituated family through dense cloud forest is among the most profound wildlife encounters on earth. The same forests hold chimpanzees, golden monkeys, and the elusive L\'Hoest\'s monkey.',
    sky:   'The Albertine Rift holds more endemic bird species than any other region in Africa — over 40 found nowhere else. Bwindi and Nyungwe are among the continent\'s premier birding destinations, with the African green broadbill, Grauer\'s warbler, and the shoebill waiting for those who look.',
  },
  'South Africa': {
    land:  'Kruger and the Greater Kruger private reserves offer the most reliable Big Five sightings in Africa. The white rhino population here is the world\'s largest, and the predator diversity — lion, leopard, cheetah, wild dog, hyena — is unmatched. Luxury lodges sit inside the wildlife, not beside it.',
    ocean: 'The South African coast is one of the world\'s great whale watching destinations. Southern right whales calve in the bays of Hermanus from June to November. Great white sharks patrol the cold Atlantic. And the Sardine Run off the Eastern Cape is one of the ocean\'s most dramatic feeding events.',
    sky:   'The Cape Floral Region is a global biodiversity hotspot with extraordinary endemic birdlife. Hluhluwe and the KwaZulu-Natal wetlands hold southern Africa\'s finest concentrations of waterbirds, and the endangered wattled crane and blue crane both call this region home.',
  },
  'Botswana': {
    land:  'The Okavango Delta is one of the world\'s last great wildlife sanctuaries — a vast inland sea that floods the Kalahari each year, drawing every large mammal in southern Africa. Elephant herds of 100 move through Chobe. Wild dog packs hunt the open floodplains of Linyanti. Botswana has chosen exclusivity over volume, and the wildlife reflects it.',
    sky:   'The Okavango\'s papyrus channels and floodplains attract an extraordinary diversity of waterbirds — African skimmer, slaty egret, Pel\'s fishing owl, and wattled crane among them. The Makgadikgadi salt pans host flamingo and migrant waders in their millions after rains.',
  },
  'Namibia': {
    land:  'Namibia\'s desert-adapted elephants navigate ancient river corridors in the Kunene. Etosha\'s waterholes concentrate wildlife with extraordinary efficiency — lion, rhino and elephant all visible in an afternoon. And the coastline holds the largest Cape fur seal colony in the world, with brown hyena and black-backed jackal hunting the beach at dawn.',
    ocean: 'The cold Benguela Current makes Namibia\'s coast one of Africa\'s richest marine environments. Whale watching, dolphin encounters, and the annual sardine migrations draw seabirds in staggering numbers. The Skeleton Coast is one of earth\'s most dramatic wilderness coastlines.',
    sky:   'Etosha and the Caprivi Strip hold southern Africa\'s most spectacular concentrations of raptors and waterbirds. The Caprivi in particular — wedged between Angola, Zambia and Botswana — punches far above its size for birding diversity.',
  },
  'Madagascar': {
    land:  'Madagascar split from Africa 160 million years ago and evolved in total isolation — 90% of its wildlife exists nowhere else on earth. Lemurs, chameleons, fossas, and extraordinary insects fill ecosystems that feel genuinely alien. Every national park is a window into a separate evolutionary experiment.',
    ocean: 'Humpback whales calve in Madagascar\'s sheltered bays from July to September. The coral reefs of the northeast hold spectacular biodiversity, and whale sharks patrol the outer reefs seasonally.',
    sky:   'Madagascar holds over 100 endemic bird species, including five families found nowhere else. The ground rollers, asities, vangas and couas are all uniquely Malagasy — making it one of the world\'s premier birding destinations for those chasing life list firsts.',
  },
  'Ethiopia': {
    land:  'The Simien Mountains hold the world\'s largest population of gelada baboons — the only grass-grazing primate on earth. Ethiopian wolves, Africa\'s rarest carnivore, hunt the Bale Mountains afroalpine meadows. The Omo Valley\'s national parks hold Africa\'s most intact assemblage of large mammals south of the Sahara.',
    sky:   'Ethiopia\'s highland endemic birds — the thick-billed raven, blue-winged goose, and wattled ibis — are found nowhere else. The Rift Valley lakes hold vast concentrations of flamingos and pelicans, and the country\'s diversity of habitats produces a spectacular species count for visiting birders.',
  },
  'Mozambique': {
    land:  'Gorongosa National Park is one of Africa\'s great conservation success stories — a park devastated by civil war that has been restored to extraordinary wildlife density in under two decades. Buffalo, lion, elephant, and hippo have all returned in numbers, and the recovery continues.',
    ocean: 'The Bazaruto Archipelago holds the last viable population of dugongs in the western Indian Ocean. Whale sharks feed in the Quirimbas. Humpback whales pass the coast on their annual migration. And the coral reefs here are among the most intact in Africa — warm, clear water with visibility to match.',
    sky:   'Gorongosa\'s floodplains attract spectacular concentrations of waterbirds during the rainy season, and the restored woodland habitats have brought back species that disappeared during the conflict years.',
  },
  'Indian Tigers & Rhinos': {
    land:  'India holds the largest remaining population of wild tigers on earth, concentrated in a network of national parks across central and northern India. Ranthambore\'s tigers hunt in the ruins of a 10th-century fort. Kanha\'s meadows are where Jim Corbett wrote. Chitwan in Nepal has the densest concentration of one-horned rhinos anywhere.',
    sky:   'India\'s tiger reserves hold exceptional birdlife alongside the big mammals. Keoladeo Ghana — formerly Bharatpur — is one of Asia\'s legendary birding wetlands. And the forests of central India hold an extraordinary diversity of raptors, hornbills, and forest birds.',
  },
  'Indian Specialty Wildlife': {
    land:  'Kaziranga holds two-thirds of the world\'s remaining one-horned rhinos and one of India\'s densest tiger populations. Gir in Gujarat protects the last wild Asiatic lions on earth. Hemis in Ladakh is the world\'s best location to track snow leopards in winter.',
    sky:   'Bharatpur\'s Keoladeo wetland was once considered the finest waterbird sanctuary in Asia. The Sundarbans mangroves hold specialist species found nowhere else. And India\'s extreme diversity of habitats — from the Himalayan treeline to the tropical south — produces an extraordinary national species count.',
  },
  'Sri Lanka': {
    land:  'Sri Lanka has one of the highest leopard densities in the world, concentrated in Yala National Park. Minneriya hosts the annual elephant gathering — hundreds of Asian elephants converging on a single tank as the dry season reduces water availability. Small, compact, and extraordinarily productive for wildlife.',
    ocean: 'The waters off Mirissa host one of the most reliable blue whale watching experiences in the world. Sperm whales, spinner dolphins, and whale sharks are all encountered regularly. The combination of pelagic megafauna so close to a tropical coast is genuinely rare.',
    sky:   'Sri Lanka\'s endemic bird list includes 34 species found nowhere else on earth. The island sits on the migratory flyway between Europe and Australia, making it exceptional for passage species as well as residents.',
  },
  'Borneo': {
    land:  'Borneo is the last stronghold of the orangutan — the great ape most closely related to us in expression and personality. The Kinabatangan River corridor holds pygmy elephants, proboscis monkeys, and sun bears in dense riverine forest. Danum Valley is among the most intact primary rainforest remaining in Southeast Asia.',
    ocean: 'Sipadan Island is consistently rated among the world\'s top five dive sites — a sheer wall dropping into the deep ocean, circled by hawksbill turtles and schooling barracuda. The Celebes Sea surrounding Borneo holds extraordinary marine biodiversity.',
    sky:   'Borneo holds eight hornbill species, including the spectacular rhinoceros hornbill. The rainforest bird diversity rivals anything on earth — pittas, broadbills, kingfishers, and the bizarre oriental bay owl all find sanctuary in the remaining primary forest.',
  },
  'Indonesia': {
    land:  'Komodo dragons are the largest lizards on earth and exist only on a handful of Indonesian islands. Tangkoko in Sulawesi holds spectral tarsiers — nocturnal primates with eyes larger than their brains. Each Indonesian island has its own suite of endemic species found nowhere else.',
    ocean: 'Raja Ampat has the highest marine biodiversity ever recorded anywhere on earth — more fish species in a single dive than most reefs hold in total. The manta ray aggregations at Komodo are legendary. Whale sharks patrol the outer reefs of Cendrawasih Bay.',
    sky:   'New Guinea and the eastern islands hold birds of paradise — among the most extraordinary animals on earth. The Wallacea region produces a remarkable concentration of endemic species, and Indonesia\'s island chain functions as a series of isolated evolutionary laboratories.',
  },
  'Galápagos': {
    land:  'The Galápagos is the only place on earth where wildlife has no evolutionary fear of humans — marine iguanas bask inches from your feet, sea lions sleep on your path. Giant tortoises weighing 250kg wander the highlands. Darwin observed here and nothing has changed.',
    ocean: 'The convergence of cold and warm currents makes the Galápagos one of the world\'s premier dive destinations. Hammerhead sharks school in the hundreds at Darwin and Wolf islands. Whale sharks pass regularly. Penguins, sea lions and marine iguanas all hunt underwater alongside you.',
    sky:   'The waved albatross nests only on Española island. Blue-footed, red-footed and Nazca boobies each occupy different islands and niches. The finches that inspired Darwin\'s theory of natural selection are still here, still diverging.',
  },
  'Amazon': {
    land:  'The Amazon holds 10% of all species on earth in a continuous forest the size of a continent. Jaguar, giant river otter, giant anteater, tapir and three species of monkey are all possible in a single week. The flooded varzea forests of Mamiraua host pink dolphins that hunt among the tree trunks.',
    sky:   'The Amazon basin holds the greatest bird diversity on earth — over 1,300 species. Macaw licks at clay cliffs draw hundreds of scarlet, red-and-green and blue-and-yellow macaws simultaneously. The harpy eagle, largest raptor in the Americas, nests in the emergent canopy.',
  },
  'Andes': {
    land:  'The spectacled bear — South America\'s only bear — roams the cloud forest slopes of Ecuador and Peru. Andean condors thermal over the Colca Canyon with wingspans reaching three metres. The high-altitude páramo holds the puma in landscapes that feel like the edge of the world.',
    ocean: 'Humpback whales breed off the Pacific coast of Colombia and Ecuador from June to October. The cold Humboldt Current brings extraordinary productivity to the coastal waters, supporting vast seabird colonies on the offshore islands.',
    sky:   'The cloud forests of Ecuador and Colombia hold the most extraordinary concentration of hummingbirds on earth — over 130 species in some valleys. Mindo alone lists over 400 bird species. The tanagers, antpittas and cotingas of the Andes are among the most spectacular birds in the world.',
  },
  'Pantanal': {
    land:  'The Pantanal is the best place on earth to see a jaguar. The open floodplain habitat and concentrated prey make sightings almost routine — multiple individuals in a single boat ride is common at peak season. Giant anteaters, giant otters and capybara are all abundant. This is wildlife watching at its most accessible.',
    sky:   'The Pantanal holds the world\'s largest population of hyacinth macaws — the largest parrot on earth. Jabiru storks nest in the open grasslands and thousands of wading birds concentrate around the drying lagoons as the dry season advances.',
  },
  'Central America': {
    land:  'Costa Rica pioneered wildlife tourism and the infrastructure remains exceptional. Corcovado holds all four monkey species, all six cat species, and tapir in primary rainforest. Tortuguero is the most important leatherback sea turtle nesting beach in the Caribbean. The density of wildlife per square kilometre is hard to match.',
    ocean: 'Cocos Island, 500km off the Costa Rican coast, is one of the world\'s great dive destinations — hammerhead sharks, whale sharks, and schooling fish in extraordinary abundance. The Caribbean reef system runs the length of the coast.',
    sky:   'The resplendent quetzal — arguably the most spectacular bird in the Americas — nests in the cloud forests of Costa Rica and Guatemala. Tanagers, toucans, trogons and motmots fill forests that hold 900 species in a country smaller than Ireland.',
  },
  'Patagonia': {
    land:  'Pumas hunt guanacos across the open steppe of Torres del Paine. Península Valdés hosts the only orca population in the world known to intentionally beach itself to catch sea lions. Magellanic penguin colonies of 200,000 nest along the Atlantic coast. Patagonia is wild in a way that feels ancient.',
    ocean: 'Southern right whales calve in the sheltered bays of Patagonia from May to December. Orcas hunt in the kelp forests of Tierra del Fuego. Elephant seals, fur seals and sea lions share the cold rocky coastline with an extraordinary diversity of seabirds.',
    sky:   'The wandering albatross has the largest wingspan of any bird on earth and nests on the sub-Antarctic islands. Andean condors thermal over the Andean foothills. The Valdés peninsula hosts spectacular concentrations of seabirds alongside the marine mammals.',
  },
  'Antarctica & Falklands': {
    land:  'The Falkland Islands hold five penguin species, including king and rockhopper, nesting within walking distance of each other. South Georgia is the single most extraordinary wildlife island on earth — 300,000 king penguins at Salisbury Plain, and 400,000 fur seals on the beaches below.',
    ocean: 'The Southern Ocean is the world\'s most productive marine environment. Humpback, minke and fin whales feed in the krill-rich waters. Leopard seals hunt penguin at the ice edge. Blue whales — the largest animals that have ever lived — are seen regularly on expeditions south.',
    sky:   'South Georgia holds 22 million macaroni penguins and the world\'s largest colony of wandering albatrosses. The sub-Antarctic islands host extraordinary concentrations of seabirds — petrels, skuas, prions and diving petrels in their millions.',
  },
  'Yellowstone': {
    land:  'Yellowstone is one of the few places in the lower 48 states where grizzly bears, wolves, bison, elk, pronghorn, and bighorn sheep coexist at scale. The reintroduction of wolves in 1995 created a textbook case of trophic cascade — changing not just the animals but the rivers and forests. The Lamar Valley is called America\'s Serengeti.',
    sky:   'Yellowstone and the surrounding Greater Yellowstone Ecosystem hold exceptional raptor diversity — golden eagle, bald eagle, osprey, and great grey owl. The geothermal areas attract unique micro-habitats and the open landscapes make observation straightforward.',
  },
  'Alaska & Yukon': {
    land:  'Brown bears fish for salmon at Katmai\'s Brooks Falls in numbers that have to be seen to be believed. Denali holds grizzly, wolf, caribou and Dall sheep in a landscape larger than Switzerland with no roads. The Pacific coast holds sea otters, Steller sea lions and the largest concentration of bald eagles in the world.',
    ocean: 'The Gulf of Alaska and the Inside Passage hold humpback whales, orcas, Steller sea lions and Dall\'s porpoise in cold, productive waters. Glacier Bay is one of the world\'s great wilderness marine experiences — ice calving into water where humpbacks surface.',
    sky:   'Alaska holds North America\'s greatest seabird colonies — puffins, murres, kittiwakes and fulmars nest on the offshore islands. The Chilkat Valley hosts the world\'s largest concentration of bald eagles each November. Shorebird migrations through the Copper River Delta are on a scale that defies belief.',
  },
  'Canadian Arctic': {
    land:  'Churchill, Manitoba, is the polar bear capital of the world. Every October and November, 900 bears congregate on the Hudson Bay shore waiting for the ice to form. Beluga whales summer in the estuary below town. Caribou migrate through in herds of thousands.',
    ocean: 'Narwhals surface in the bays of Nunavut — the most mythic of all whales, their spiral tusks breaking the Arctic surface. Bowhead whales, the longest-lived mammals on earth, travel the same routes they have navigated for millennia.',
    sky:   'The tundra hosts extraordinary concentrations of breeding shorebirds and waterfowl in summer. Snow geese migrate through in flocks of hundreds of thousands. Snowy owls hunt the open landscape and rough-legged hawks nest on the coastal cliffs.',
  },
  'Australia': {
    land:  'Australia\'s mammal fauna is found nowhere else on earth. Kangaroos, wombats, quolls, echidnas and the duck-billed platypus are all uniquely Australian. Kakadu in the Northern Territory combines ancient Aboriginal culture with extraordinary wildlife density. Kangaroo Island is a wildlife sanctuary with sea lions, echidnas and koalas in wild numbers.',
    ocean: 'The Great Barrier Reef is the largest living structure on earth. Ningaloo Reef in Western Australia offers the world\'s most reliable whale shark snorkelling — guaranteed encounters from March to July. Humpback whales pass the southern coasts on their annual migration.',
    sky:   'Australia holds 800 bird species, 45% of which are endemic. The cassowary — a 60kg remnant dinosaur — stalks the Daintree rainforest. Budgerigars and cockatoos move in flocks of tens of thousands across the outback.',
  },
  'New Zealand': {
    land:  'New Zealand evolved for 80 million years without land mammals — its birds filled every ecological niche. The kiwi is the most unusual bird on earth. The kea is the world\'s only alpine parrot. Fiordland holds takahe, moose-sized birds once thought extinct, and the kākāpō — the world\'s heaviest parrot.',
    ocean: 'Kaikoura sits above a submarine canyon where the cold Humboldt Current surfaces — creating a nutrient upwelling that supports sperm whales year-round. Hector\'s dolphin, the world\'s smallest and rarest marine dolphin, is found only in New Zealand waters.',
    sky:   'The Otago Peninsula hosts royal albatrosses nesting within walking distance of a city — the only mainland albatross colony in the world. The forests of the South Island are among the world\'s great birding destinations for endemic species.',
  },
  'Svalbard': {
    land:  'Svalbard holds roughly 3,000 polar bears — one for every resident human. Walrus haul out on the beaches of remote fjords. Arctic foxes in pure white winter coats hunt ptarmigan across the tundra. In July, the midnight sun means wildlife watching around the clock.',
    ocean: 'Svalbard\'s fjords fill with bowhead whales, beluga whales and bearded seals as the sea ice retreats in summer. The cold waters are extraordinarily productive, feeding seabird colonies of millions and the bears that patrol the ice edge.',
    sky:   'Little auks nest in talus slopes in colonies of hundreds of thousands — one of the great seabird spectacles of the Arctic. Ivory gulls, sabine\'s gulls and long-tailed skuas follow the ice edge. Barnacle geese breed in extraordinary numbers on the steep cliff faces.',
  },
  'European Wildlife': {
    land:  'Białowieża Forest on the Poland-Belarus border is the last remaining fragment of primeval European lowland forest. European bison, wolves, lynx and the rare European mink all survive here. The Danube Delta in Romania is one of the world\'s great wetland wildernesses, holding pelicans, cormorants and rare waterbirds in staggering numbers.',
    sky:   'The Danube Delta hosts the world\'s largest Dalmatian pelican colony. Doñana in Spain is a critical wintering ground for millions of migratory birds moving between Europe and Africa. The Hungarian Puszta holds great bustards — the world\'s heaviest flying bird — in one of their last European strongholds.',
  },
};

function atReq(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.airtable.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function fetchAll() {
  const records = [];
  let offset = '';
  do {
    const qs = offset ? `?offset=${offset}` : '';
    const data = await atReq('GET', `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${qs}`);
    if (data.error) { console.error('Fetch error:', data.error); process.exit(1); }
    records.push(...(data.records || []));
    offset = data.offset || '';
  } while (offset);
  return records;
}

(async () => {
  console.log('Fetching Animal Regions…');
  const records = await fetchAll();
  console.log(`Found ${records.length} regions`);

  const updates = records
    .filter(r => HIGHLIGHTS[r.fields['Region']])
    .map(r => {
      const h = HIGHLIGHTS[r.fields['Region']];
      return {
        id: r.id,
        fields: {
          ...(h.land  ? { 'Land Description':  h.land  } : {}),
          ...(h.ocean ? { 'Ocean Description': h.ocean } : {}),
          ...(h.sky   ? { 'Sky Description':   h.sky   } : {}),
        }
      };
    });

  const missing = records.filter(r => !HIGHLIGHTS[r.fields['Region']]).map(r => r.fields['Region']);
  if (missing.length) console.warn('No highlights for:', missing.join(', '));

  console.log(`Updating ${updates.length} regions…`);
  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10);
    const result = await atReq('PATCH', `/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`, { records: batch });
    if (result.error) { console.error('Update error:', result.error); process.exit(1); }
    process.stdout.write(`  ${Math.min(i + 10, updates.length)}/${updates.length}\r`);
  }
  console.log('\nDone.');
})();
