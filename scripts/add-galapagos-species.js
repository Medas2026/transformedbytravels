// Batch-add 30 iconic Galápagos species to the Species table.
// Run:   node scripts/add-galapagos-species.js            (actually inserts)
//        node scripts/add-galapagos-species.js --dry-run  (prints, doesn't POST)
//
// Best Parks values are set to island names that already exist in the Places
// table (Isabela, Santa Cruz Island, San Cristóbal Island, Pinzon Island,
// Darwin Island, Espanola Island, Floreana Island). Wolf Island is treated
// identically to Darwin — both are the far-northern archipelago hotspots.

const fs   = require('fs');
const path = require('path');
const DRY  = process.argv.includes('--dry-run');

const BASE_ID  = 'appdlxcWb45dIqNK2';
const TABLE_ID = 'tblYtFaj6UYMUEwFQ'; // Species

const KEY = (fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').match(/AIRTABLE_API_KEY="?([^"\n]+)"?/) || [])[1]?.trim();
if (!KEY) { console.error('Missing AIRTABLE_API_KEY in .env.local'); process.exit(1); }

// Islands present in the Places table (per user 2026-07-23):
const ISLANDS = {
  ISABELA:   'Isabela',
  SANTA:     'Santa Cruz Island',
  SAN_C:     'San Cristóbal Island',
  PINZON:    'Pinzon Island',
  DARWIN:    'Darwin Island',
  WOLF:      'Wolf Island',        // add if not present; identical to Darwin for wildlife
  ESPANOLA:  'Espanola Island',
  FLOREANA:  'Floreana Island',
};

// Month abbreviations used elsewhere in the app
const ALL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const SPECIES = [
  // ── Reptiles (5) ─────────────────────────────────────────────────────────
  {
    name: 'Galápagos Giant Tortoise', sci: 'Chelonoidis niger', type: 'Reptile', category: 'Reptile',
    status: 'Vulnerable',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.PINZON, ISLANDS.ESPANOLA, ISLANDS.FLOREANA],
    months: ALL_MONTHS,
    desc: 'The largest living tortoise on Earth — up to 500 lb, can live 150+ years. Each island evolved its own subspecies, ranging from dome-shelled highland grazers to saddle-backed lowland browsers. Darwin\'s observations of these variations helped shape his theory of natural selection.',
    habitat: 'Highland grasslands and lowland scrub; wallows in muddy pools during hot months to regulate temperature.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Aldabra_giant_tortoise_%28Aldabrachelys_gigantea%29_male_3.jpg/1280px-Aldabra_giant_tortoise_%28Aldabrachelys_gigantea%29_male_3.jpg',
  },
  {
    name: 'Marine Iguana', sci: 'Amblyrhynchus cristatus', type: 'Reptile', category: 'Reptile',
    status: 'Vulnerable',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.ESPANOLA, ISLANDS.FLOREANA, ISLANDS.PINZON],
    months: ALL_MONTHS,
    desc: 'The world\'s only ocean-going lizard. Feeds on algae in cold currents, then basks on black lava to warm up. Sneezes crystalline salt from specialized nose glands. Espanola\'s subspecies turns brilliant red and green during breeding season.',
    habitat: 'Rocky volcanic shorelines and intertidal zones; nests in sand above the high-tide line.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Marine_Iguana_%28Amblyrhynchus_cristatus%29_%2836385046842%29.jpg/1280px-Marine_Iguana_%28Amblyrhynchus_cristatus%29_%2836385046842%29.jpg',
  },
  {
    name: 'Galápagos Land Iguana', sci: 'Conolophus subcristatus', type: 'Reptile', category: 'Reptile',
    status: 'Vulnerable',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.FLOREANA],
    months: ALL_MONTHS,
    desc: 'Yellow-and-brown giant lizards that eat prickly-pear cactus pads — spines and all. Adults reach 3 feet and 25 lb. Nearly extinct in the 20th century; reintroduction programs on Santa Cruz and Isabela are showing strong recovery.',
    habitat: 'Arid lowlands with cactus forest; shelters in burrows dug into volcanic soil.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Conolophus_subcristatus_%28Land_Iguana%29.jpg/1280px-Conolophus_subcristatus_%28Land_Iguana%29.jpg',
  },
  {
    name: 'Lava Lizard', sci: 'Microlophus albemarlensis', type: 'Reptile', category: 'Reptile',
    status: 'Least Concern',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.ESPANOLA, ISLANDS.FLOREANA, ISLANDS.PINZON],
    months: ALL_MONTHS,
    desc: 'Small, agile lizards seen everywhere on the islands — often perched on lava boulders doing push-up displays. Males patrol tiny territories; females tolerate multiple mates within their range.',
    habitat: 'Arid lowlands across every major island; each island typically has its own endemic species.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Galapagos_Lava_Lizard.jpg/1280px-Galapagos_Lava_Lizard.jpg',
  },
  {
    name: 'Green Sea Turtle', sci: 'Chelonia mydas', type: 'Reptile', category: 'Reptile',
    status: 'Endangered',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.ESPANOLA, ISLANDS.FLOREANA, ISLANDS.DARWIN, ISLANDS.WOLF],
    months: ALL_MONTHS,
    desc: 'The most common turtle seen on Galápagos snorkeling trips. Grazes on algae in shallow bays and rests on sandy bottoms. The Galápagos population nests on quiet beaches Dec–May, most notably Bartolomé and Floreana.',
    habitat: 'Shallow reefs, mangrove lagoons, and offshore currents.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Chelonia_mydas_is_going_for_the_air_edit.jpg/1280px-Chelonia_mydas_is_going_for_the_air_edit.jpg',
  },

  // ── Mammals (3) ──────────────────────────────────────────────────────────
  {
    name: 'Galápagos Sea Lion', sci: 'Zalophus wollebaeki', type: 'Mammal', category: 'Mammal',
    status: 'Endangered',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.ESPANOLA, ISLANDS.FLOREANA, ISLANDS.PINZON],
    months: ALL_MONTHS,
    desc: 'Playful, curious pinnipeds that share beaches with tourists throughout the archipelago. Pups born year-round, with peaks Aug–Nov. Young males spar in the shallows while alpha bulls patrol territories.',
    habitat: 'Sandy beaches, rocky shorelines, and shallow bays where they hunt sardines and small fish.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Galapagos_sea_lion_%28Zalophus_wollebaeki%29_female_2.jpg/1280px-Galapagos_sea_lion_%28Zalophus_wollebaeki%29_female_2.jpg',
  },
  {
    name: 'Galápagos Fur Seal', sci: 'Arctocephalus galapagoensis', type: 'Mammal', category: 'Mammal',
    status: 'Endangered',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C],
    months: ALL_MONTHS,
    desc: 'Smaller and more shy than the sea lion, with a denser coat that once made them a prime target of 19th-century sealers. Nocturnal hunters — most active at dawn and dusk. Nearly hunted to extinction, now recovering.',
    habitat: 'Shaded rocky coastlines and sea caves on the western islands.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Galapagos_fur_seal.jpg/1280px-Galapagos_fur_seal.jpg',
  },
  {
    name: 'Common Bottlenose Dolphin', sci: 'Tursiops truncatus', type: 'Mammal', category: 'Mammal',
    status: 'Least Concern',
    parks: [ISLANDS.DARWIN, ISLANDS.WOLF, ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C],
    months: ALL_MONTHS,
    desc: 'Frequently bow-rides alongside inter-island cruise boats. Pods of 5–20 common in productive upwelling zones on the western and northern archipelago.',
    habitat: 'Deep offshore channels and coastal waters throughout the archipelago.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Tursiops_truncatus_01.jpg/1280px-Tursiops_truncatus_01.jpg',
  },

  // ── Birds (13) ───────────────────────────────────────────────────────────
  {
    name: 'Blue-footed Booby', sci: 'Sula nebouxii', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.ESPANOLA, ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.FLOREANA],
    months: ALL_MONTHS,
    desc: 'The Galápagos icon — turquoise feet on a plain white-and-brown body. Males perform an elaborate high-stepping dance and sky-pointing display during courtship. Plunge-dives from 30+ feet to catch sardines.',
    habitat: 'Nests on flat, open ground near cliffs; hunts in nearshore waters.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Sula_nebouxii_-Punta_Suarez%2C_Espanola_Island%2C_Galapagos_Islands%2C_Ecuador_-adult_and_juvenile-8.jpg/1280px-Sula_nebouxii_-Punta_Suarez%2C_Espanola_Island%2C_Galapagos_Islands%2C_Ecuador_-adult_and_juvenile-8.jpg',
  },
  {
    name: 'Red-footed Booby', sci: 'Sula sula', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.DARWIN, ISLANDS.WOLF, ISLANDS.SAN_C, ISLANDS.FLOREANA],
    months: ALL_MONTHS,
    desc: 'The smallest booby species — nests in mangroves and low trees rather than on the ground. Two color morphs, white and brown, and both have brilliant crimson feet. Feeds far offshore.',
    habitat: 'Tree-nesting colonies on outer islands.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Redfootedbooby.jpg/1280px-Redfootedbooby.jpg',
  },
  {
    name: 'Nazca Booby', sci: 'Sula granti', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.ESPANOLA, ISLANDS.DARWIN, ISLANDS.WOLF, ISLANDS.SAN_C],
    months: ALL_MONTHS,
    desc: 'The largest of the three Galápagos boobies — pure white with a black mask and orange bill. Practices "obligate siblicide" — the older chick pushes the younger from the nest. Cliff-top colonies at Punta Suárez are the most famous.',
    habitat: 'Nests on flat cliff-top plateaus; forages far out at sea.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Nazca_Booby_RWD.jpg/1280px-Nazca_Booby_RWD.jpg',
  },
  {
    name: 'Waved Albatross', sci: 'Phoebastria irrorata', type: 'Bird', category: 'Bird',
    status: 'Critically Endangered',
    parks: [ISLANDS.ESPANOLA],
    months: ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    desc: 'Nests almost exclusively on Espanola — the only place on Earth to see them. 8-foot wingspan. Elaborate courtship "dance" involves bill-clacking, sky-pointing, and synchronized stepping. Absent Jan–Mar when they range across the Pacific.',
    habitat: 'Cliff-top nesting colonies on Espanola Island.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Waved_Albatross_%287184057184%29.jpg/1280px-Waved_Albatross_%287184057184%29.jpg',
  },
  {
    name: 'Magnificent Frigatebird', sci: 'Fregata magnificens', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.SAN_C, ISLANDS.SANTA, ISLANDS.FLOREANA, ISLANDS.ISABELA],
    months: ALL_MONTHS,
    desc: 'Males inflate a scarlet throat pouch the size of a soccer ball during courtship, calling from bushes for weeks. Notorious "kleptoparasites" — steal fish from other seabirds in mid-air. Cannot land on water; feathers aren\'t waterproof.',
    habitat: 'Coastal areas and mangroves near seabird colonies.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Fregata_magnificens_-Galapagos%2C_Ecuador_-male-8.jpg/1280px-Fregata_magnificens_-Galapagos%2C_Ecuador_-male-8.jpg',
  },
  {
    name: 'Great Frigatebird', sci: 'Fregata minor', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.DARWIN, ISLANDS.WOLF, ISLANDS.SAN_C, ISLANDS.ESPANOLA],
    months: ALL_MONTHS,
    desc: 'The species with the largest wingspan-to-body-weight ratio of any bird. Also inflates a red throat pouch but with more of a greenish sheen than the Magnificent. Nests on outer, more remote islands.',
    habitat: 'Cliff-top and treetop colonies on the northern and eastern islands.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Great_Frigatebird.jpg/1280px-Great_Frigatebird.jpg',
  },
  {
    name: 'Galápagos Penguin', sci: 'Spheniscus mendiculus', type: 'Bird', category: 'Bird',
    status: 'Endangered',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA],
    months: ALL_MONTHS,
    desc: 'The only penguin found north of the equator. Small (~18 in tall), depends on the cold Cromwell and Humboldt currents. Population fluctuates dramatically with El Niño events. Best snorkel encounters are at Isabela\'s Punta Vicente Roca.',
    habitat: 'Rocky volcanic coastlines with access to cold upwelling waters.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Galapagos_penguin_%28Spheniscus_mendiculus%29_male.jpg/1280px-Galapagos_penguin_%28Spheniscus_mendiculus%29_male.jpg',
  },
  {
    name: 'Flightless Cormorant', sci: 'Nannopterum harrisi', type: 'Bird', category: 'Bird',
    status: 'Vulnerable',
    parks: [ISLANDS.ISABELA],
    months: ALL_MONTHS,
    desc: 'The only cormorant species that lost the ability to fly — stubby vestigial wings held out to dry after each dive. Restricted to Isabela\'s western shore and Fernandina. One of the rarest seabirds in the world; total population under 2000 pairs.',
    habitat: 'Rocky western shorelines rich in nearshore squid and octopus.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Flightless_Cormorant_from_The_Crossley_ID_Guide_Eastern_Birds.jpg/1280px-Flightless_Cormorant_from_The_Crossley_ID_Guide_Eastern_Birds.jpg',
  },
  {
    name: 'Galápagos Hawk', sci: 'Buteo galapagoensis', type: 'Bird', category: 'Bird',
    status: 'Vulnerable',
    parks: [ISLANDS.ESPANOLA, ISLANDS.SANTA, ISLANDS.ISABELA, ISLANDS.PINZON],
    months: ALL_MONTHS,
    desc: 'The archipelago\'s only diurnal raptor. Females mate with 2–7 males in a cooperative polyandrous system found in almost no other bird. Fearless around humans — a legacy of no historical mammalian predators.',
    habitat: 'Open lowlands and highlands across many major islands.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Buteo_galapagoensis_-Punta_Suarez%2C_Espanola_Island%2C_Galapagos_Islands%2C_Ecuador-8.jpg/1280px-Buteo_galapagoensis_-Punta_Suarez%2C_Espanola_Island%2C_Galapagos_Islands%2C_Ecuador-8.jpg',
  },
  {
    name: 'Galápagos Short-eared Owl', sci: 'Asio flammeus galapagoensis', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.SANTA, ISLANDS.ISABELA, ISLANDS.ESPANOLA],
    months: ALL_MONTHS,
    desc: 'Diurnal on Galápagos — often seen hunting storm petrels at their breeding grounds on Genovesa. On islands without hawks, it takes the top predator role. Fluffs its "ear tufts" when alert.',
    habitat: 'Open volcanic terrain and grassy lowlands.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Asio_flammeus_-Galapagos%2C_Ecuador-8.jpg/1280px-Asio_flammeus_-Galapagos%2C_Ecuador-8.jpg',
  },
  {
    name: 'Darwin\'s Finches', sci: 'Geospiza / Camarhynchus spp.', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.SANTA, ISLANDS.ISABELA, ISLANDS.SAN_C, ISLANDS.FLOREANA, ISLANDS.ESPANOLA, ISLANDS.PINZON],
    months: ALL_MONTHS,
    desc: 'Fifteen closely-related species descended from a single South American ancestor — the textbook example of adaptive radiation. Beak shape varies from thick nut-crackers to thin insect-probers to the woodpecker-like tool-user. Small, drab, but ecologically famous.',
    habitat: 'Highland forests, coastal scrub, and everywhere in between depending on the species.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Darwin_finches_-_Galapagos_Islands_-_Isabela_Island_-_2008.jpg/1280px-Darwin_finches_-_Galapagos_Islands_-_Isabela_Island_-_2008.jpg',
  },
  {
    name: 'Galápagos Mockingbird', sci: 'Mimus parvulus', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C],
    months: ALL_MONTHS,
    desc: 'Curious, tame, and cooperative — different islands have distinct subspecies. Espanola has its own endemic species (Espanola Mockingbird) known for stealing water from visitors\' bottles. First alerted Darwin to the pattern of island endemism.',
    habitat: 'Arid lowlands and coastal scrub.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Mimus_parvulus_-Galapagos_Islands-8_%28cropped%29.jpg/1280px-Mimus_parvulus_-Galapagos_Islands-8_%28cropped%29.jpg',
  },
  {
    name: 'Greater Flamingo', sci: 'Phoenicopterus roseus', type: 'Bird', category: 'Bird',
    status: 'Least Concern',
    parks: [ISLANDS.FLOREANA, ISLANDS.ISABELA, ISLANDS.SANTA],
    months: ALL_MONTHS,
    desc: 'Small population (~500 birds) restricted to a handful of brackish coastal lagoons. Filter-feeds on brine shrimp that give them their pink color. Best sightings at Punta Cormorant (Floreana) and lagoons on Rábida.',
    habitat: 'Brackish coastal lagoons and salt pans.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Greater_Flamingo_-_Chile_2016_%2830938128492%29.jpg/1280px-Greater_Flamingo_-_Chile_2016_%2830938128492%29.jpg',
  },

  // ── Marine (9) ───────────────────────────────────────────────────────────
  {
    name: 'Whale Shark', sci: 'Rhincodon typus', type: 'Marine', category: 'Marine',
    status: 'Endangered',
    parks: [ISLANDS.DARWIN, ISLANDS.WOLF],
    months: ['Jul','Aug','Sep','Oct','Nov'],
    desc: 'The largest fish in the ocean — up to 40 feet. Darwin and Wolf host the world\'s highest concentration of very large, pregnant females each year Jul–Nov. Dive operators from Santa Cruz run week-long liveaboards specifically for this window.',
    habitat: 'Deep pelagic waters around the far-northern seamounts.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Whale_shark_Georgia_aquarium.jpg/1280px-Whale_shark_Georgia_aquarium.jpg',
  },
  {
    name: 'Scalloped Hammerhead Shark', sci: 'Sphyrna lewini', type: 'Marine', category: 'Marine',
    status: 'Critically Endangered',
    parks: [ISLANDS.DARWIN, ISLANDS.WOLF, ISLANDS.SAN_C],
    months: ALL_MONTHS,
    desc: 'Schools of 50–200 hammerheads circle the Darwin Arch cleaning stations — one of the world\'s legendary dive experiences. Best sightings during the cool season Jun–Nov when currents concentrate them.',
    habitat: 'Cleaning stations and drop-offs around the northern seamounts.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Hammerhead_shark_%28Sphyrna_lewini%29.jpg/1280px-Hammerhead_shark_%28Sphyrna_lewini%29.jpg',
  },
  {
    name: 'Galápagos Shark', sci: 'Carcharhinus galapagensis', type: 'Marine', category: 'Marine',
    status: 'Least Concern',
    parks: [ISLANDS.DARWIN, ISLANDS.WOLF, ISLANDS.ESPANOLA],
    months: ALL_MONTHS,
    desc: 'A robust, curious reef shark that patrols cleaning stations and cliff drop-offs. Often mistaken for a bull shark. Groups of 5–20 common at Darwin and Wolf.',
    habitat: 'Open water around volcanic pinnacles and seamounts.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Galapagos_shark_%285398421866%29.jpg/1280px-Galapagos_shark_%285398421866%29.jpg',
  },
  {
    name: 'White-tipped Reef Shark', sci: 'Triaenodon obesus', type: 'Marine', category: 'Marine',
    status: 'Vulnerable',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.DARWIN, ISLANDS.WOLF],
    months: ALL_MONTHS,
    desc: 'Docile reef shark that rests on sandy bottoms in shallow caves during the day. Nocturnal hunter — pumps water over its gills without swimming. Frequently seen by snorkelers in every part of the archipelago.',
    habitat: 'Shallow reefs, sandy channels, and lava caves.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Whitetip_reef_shark_at_Roca_Partida_Revillagigedo.jpg/1280px-Whitetip_reef_shark_at_Roca_Partida_Revillagigedo.jpg',
  },
  {
    name: 'Spotted Eagle Ray', sci: 'Aetobatus narinari', type: 'Marine', category: 'Marine',
    status: 'Endangered',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.ESPANOLA, ISLANDS.FLOREANA],
    months: ALL_MONTHS,
    desc: 'Wing-spans up to 10 feet, spotted like a leopard. Cruises open water and shallow lagoons in loose groups. Often seen on snorkeling trips and from panga rides between islands.',
    habitat: 'Sandy bays and open water throughout the archipelago.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Spotted_eagle_ray_-_Aetobatus_narinari.jpg/1280px-Spotted_eagle_ray_-_Aetobatus_narinari.jpg',
  },
  {
    name: 'Manta Ray', sci: 'Mobula birostris', type: 'Marine', category: 'Marine',
    status: 'Endangered',
    parks: [ISLANDS.DARWIN, ISLANDS.WOLF, ISLANDS.ISABELA],
    months: ['Jun','Jul','Aug','Sep','Oct','Nov'],
    desc: 'Ocean giants with wingspans up to 23 feet, often approaching divers with apparent curiosity. Feeds on plankton blooms during the cool season. Cleaning stations at Punta Vicente Roca (Isabela) attract predictable visits.',
    habitat: 'Open water around productive upwelling zones.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Manta_alfredi_%28Krivenko%29.jpg/1280px-Manta_alfredi_%28Krivenko%29.jpg',
  },
  {
    name: 'Golden Cownose Ray', sci: 'Rhinoptera steindachneri', type: 'Marine', category: 'Marine',
    status: 'Near Threatened',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.ESPANOLA],
    months: ALL_MONTHS,
    desc: 'Small (~3 ft) golden-brown ray that moves in dense schools of hundreds during migrations. Signature Galápagos snorkel sighting when currents converge them in bays.',
    habitat: 'Sandy-bottom shallows and inter-island channels.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Rhinoptera_steindachneri.jpg/1280px-Rhinoptera_steindachneri.jpg',
  },
  {
    name: 'Yellowfin Tuna', sci: 'Thunnus albacares', type: 'Marine', category: 'Marine',
    status: 'Near Threatened',
    parks: [ISLANDS.DARWIN, ISLANDS.WOLF, ISLANDS.ISABELA],
    months: ALL_MONTHS,
    desc: 'Fast, powerful pelagic predator — divers see them blasting through baitballs. Population of the eastern Pacific concentrates around productive Galápagos upwellings. Individuals up to 400 lb.',
    habitat: 'Open pelagic water around the archipelago.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Yellowfin_tuna_1.jpg/1280px-Yellowfin_tuna_1.jpg',
  },
  {
    name: 'Sally Lightfoot Crab', sci: 'Grapsus grapsus', type: 'Marine', category: 'Marine',
    status: 'Least Concern',
    parks: [ISLANDS.ISABELA, ISLANDS.SANTA, ISLANDS.SAN_C, ISLANDS.ESPANOLA, ISLANDS.FLOREANA, ISLANDS.PINZON],
    months: ALL_MONTHS,
    desc: 'Brilliant orange, red, and blue crabs that scatter across every rocky shoreline. Named for their nimble side-stepping across wave-splashed lava. Photogenic against black volcanic rock.',
    habitat: 'Intertidal lava rocks around every major island.',
    photo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Sally_Lightfoot_Crab_%28Grapsus_grapsus%29_%2836374301741%29.jpg/1280px-Sally_Lightfoot_Crab_%28Grapsus_grapsus%29_%2836374301741%29.jpg',
  },
];

async function main() {
  console.log(`${DRY ? '[DRY RUN] ' : ''}Adding ${SPECIES.length} Galápagos species…`);
  console.log(`Target: Species table (${TABLE_ID}) in base ${BASE_ID}`);
  if (DRY) {
    SPECIES.forEach((s, i) => console.log(`  ${(i+1).toString().padStart(2)}. ${s.name.padEnd(30)} — ${s.parks.length} island${s.parks.length===1?'':'s'}`));
    process.exit(0);
  }

  // Airtable allows up to 10 records per POST
  for (let i = 0; i < SPECIES.length; i += 10) {
    const batch = SPECIES.slice(i, i + 10);
    const body = {
      // typecast lets Airtable coerce strings into multi-select options,
      // auto-creating any missing option values (e.g. "Wolf Island" if it
      // doesn't yet exist on the Best Parks field).
      typecast: true,
      records: batch.map(s => ({
        fields: {
          'Species Name':         s.name,
          'Scientific Name':      s.sci,
          'Type':                 s.type,
          'Category':             s.category,
          'Conservation Status':  s.status,
          'Best Parks':           s.parks,           // multi-select → array
          'Best Months':          s.months,          // multi-select → array
          'Description':          s.desc,
          'Habitat':              s.habitat,
          'Photo URL':            s.photo,
          'Animal Regions':       ['Ecuador', 'Galapagos Islands'], // multi-select → array
        },
      })),
    };
    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.error) { console.error(`Batch ${i/10 + 1} failed:`, data.error); process.exit(1); }
    console.log(`  ✓ Batch ${i/10 + 1}: ${data.records.length} records added`);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
