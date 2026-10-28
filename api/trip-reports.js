const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Trip Reports';

async function airtableGet(path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

const SECTION_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K'];

// A section's photos live in one long-text field ("Photos A"), one photo per line as
//   url | optional caption
// Pipe, not comma: Cloudinary transform URLs contain commas (w_760,f_auto,q_auto).
function parsePhotoLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => {
      const s = line.trim();
      if (!s) return null;
      const bar = s.indexOf('|');           // split on the FIRST pipe only,
      if (bar === -1) return { url: s, caption: '' };   // so captions may contain pipes
      const url = s.slice(0, bar).trim();
      const caption = s.slice(bar + 1).trim();
      return url ? { url, caption } : null;
    })
    .filter(Boolean);
}

function sectionPhotos(f, L) {
  return parsePhotoLines(f[`Photos ${L}`]);
}

// ── Who this trip suits ───────────────────────────────────────────────────────
// An "Archetypes" long-text field on the report, one per line:
//     The Wildlife Expeditioner | Long drives, early starts, no guarantees
//     The Cultural Explorer
// The name is resolved against the Archetype Table for its tagline; the optional text
// after the pipe is why THIS trip suits them.
const ARCHETYPE_TABLE = 'Archetype Table';

function parseArchetypeLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => {
      const s = line.trim();
      if (!s) return null;
      const bar = s.indexOf('|');
      return bar === -1
        ? { name: s, why: '' }
        : { name: s.slice(0, bar).trim(), why: s.slice(bar + 1).trim() };
    })
    .filter(a => a && a.name);
}

async function resolveArchetypes(list) {
  if (!list.length) return [];
  let byName = new Map();
  try {
    const params = new URLSearchParams();
    ['Archetype Name', 'Notes', 'Description'].forEach(f => params.append('fields[]', f));
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ARCHETYPE_TABLE)}?${params}`;
    const data = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY } }).then(r => r.json());
    (data.records || []).forEach(r => {
      const f = r.fields || {};
      if (f['Archetype Name']) byName.set(normName(f['Archetype Name']), {
        name: f['Archetype Name'],
        tagline: f['Notes'] || '',
        description: f['Description'] || '',
      });
    });
  } catch (e) { /* unresolved names still render with just the name */ }

  return list.map(a => {
    // Tolerate a missing leading "The", since it is easy to drop when typing.
    const hit = byName.get(normName(a.name)) || byName.get(normName('The ' + a.name));
    return {
      name: hit ? hit.name : a.name,
      tagline: hit ? hit.tagline : '',
      description: hit ? hit.description : '',
      why: a.why,
      unmatched: !hit,
    };
  });
}

// ── How the trip was travelled ────────────────────────────────────────────────
// One "Transport" long-text field on the report, one leg per line:
//     Flight | Minneapolis → Las Vegas, Delta
//     Car    | Rental SUV, about 1,400 miles over ten days
// The mode before the pipe picks an icon; everything after it is free text. A line with
// no pipe still shows, just without a mode label.
function parseTransport(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => {
      const s = line.trim();
      if (!s) return null;
      const bar = s.indexOf('|');
      if (bar === -1) return { mode: '', detail: s };
      return { mode: s.slice(0, bar).trim(), detail: s.slice(bar + 1).trim() };
    })
    .filter(t => t && (t.mode || t.detail));
}

// ── Animals seen at a stop ────────────────────────────────────────────────────
// "Animals A".."Animals K" hold the species seen at that stop, one per line (commas
// also work). Names are resolved against the TBT Wildlife table for a photo and realm.
const WILDLIFE_TABLE = 'TBT Wildlife';

// The Realm field is set on almost no species, so derive it from Type — which is
// populated on 2046 of 2048 rows — and let an explicit Realm win when present.
const REALM_BY_TYPE = {
  'bird': 'Sky',
  'marine mammal': 'Ocean', 'fish': 'Ocean', 'marine': 'Ocean',
  'cephalopod': 'Ocean', 'crustacean': 'Ocean', 'coral': 'Ocean',
  'mammal': 'Land', 'reptile': 'Land', 'amphibian': 'Land',
  'insect': 'Land', 'invertebrate': 'Land',
};
const REALM_ORDER = ['Land', 'Ocean', 'Sky', 'Other'];

function realmFor(f) {
  const explicit = String(f['Realm'] || '').trim();     // note: the choice is stored as "Ocean "
  if (explicit) return explicit;
  return REALM_BY_TYPE[String(f['Type'] || '').trim().toLowerCase()] || 'Other';
}

const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function parseAnimalNames(text) {
  return [...new Set(
    String(text || '')
      .split(/[\r\n,]+/)
      .map(s => s.trim())
      .filter(Boolean)
  )];
}

// One lookup for every species named anywhere in the report, chunked so the
// filterByFormula stays a sane length.
async function fetchSpecies(names) {
  const out = new Map();
  if (!names.length) return out;
  const fields = ['Species Name', 'Scientific Name', 'Photo URL', 'Realm', 'Type', 'Conservation Status'];
  for (let i = 0; i < names.length; i += 20) {
    const chunk = names.slice(i, i + 20);
    // Match on species name OR scientific name — no fuzzy matching, because "Lion"
    // partially matches five different sea lions and a wrong animal is worse than none.
    const formula = `OR(${chunk.map(n => {
      const v = normName(n).replace(/"/g, '\\"');
      return `LOWER({Species Name})="${v}",LOWER({Scientific Name})="${v}"`;
    }).join(',')})`;
    const params = new URLSearchParams();
    params.set('filterByFormula', formula);
    fields.forEach(f => params.append('fields[]', f));
    try {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(WILDLIFE_TABLE)}?${params}`;
      const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY } });
      const data = await resp.json();
      (data.records || []).forEach(r => {
        const f = r.fields || {};
        const entry = {
          name: f['Species Name'] || '',
          scientific: f['Scientific Name'] || '',
          photo: f['Photo URL'] || '',
          status: f['Conservation Status'] || '',
          realm: realmFor(f),
        };
        if (entry.name) out.set(normName(entry.name), entry);
        if (entry.scientific && !out.has(normName(entry.scientific))) out.set(normName(entry.scientific), entry);
      });
    } catch (e) { /* a failed chunk just means those names render unmatched */ }
  }
  return out;
}

// Resolved animals for one stop, grouped into the three realms.
function sectionAnimals(names, speciesMap) {
  const groups = new Map();
  names.forEach(raw => {
    const hit = speciesMap.get(normName(raw));
    const a = hit || { name: raw, scientific: '', photo: '', status: '', realm: 'Other', unmatched: true };
    if (!groups.has(a.realm)) groups.set(a.realm, []);
    groups.get(a.realm).push(a);
  });
  return [...groups.entries()]
    .sort((x, y) => REALM_ORDER.indexOf(x[0]) - REALM_ORDER.indexOf(y[0]))
    .map(([realm, animals]) => ({ realm, animals }));
}

function validCoords(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;          // empty Number fields read as 0,0
  return { lat, lng };
}

// One "Map Coords" long-text field can carry the whole itinerary, one line per section:
//     A 51.4226,-116.4356
//     B  51.3558, -116.3308   ← spacing and an optional colon/pipe are all fine
// Cheapest to set up: a single field to create rather than one per section.
function parseCoordBlock(text) {
  const out = {};
  String(text || '').split(/\r?\n/).forEach(line => {
    const m = line.trim().match(/^([A-K])\s*[:|,\s]\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i);
    if (m) out[m[1].toUpperCase()] = { lat: Number(m[2]), lng: Number(m[3]) };
  });
  return out;
}

// A stop's position can be given any of three ways, so it fits whichever is handier:
//   • Map Coords        — one field for the whole report, one line per section
//   • Coords A          — "51.4254, -116.1773", exactly what Google Maps copies
//   • Latitude A / Longitude A — separate Number fields, matching the convention
//     already used by Animal Regions and Wildlife Locations elsewhere in this base
// Per-section fields beat the report-wide block, so a single stop can be corrected
// without unpicking the Map Coords list.
function sectionCoords(f, L, block) {
  const m = String(f[`Coords ${L}`] || '').match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return validCoords(Number(m[1]), Number(m[2]));

  // "Lattitude" is the existing misspelling in Wildlife Locations — accepted so a
  // copied field name doesn't silently drop the pin.
  const lat = f[`Latitude ${L}`] ?? f[`Lattitude ${L}`];
  const lng = f[`Longitude ${L}`];
  if (lat != null && lng != null && lat !== '' && lng !== '') {
    const pair = validCoords(Number(lat), Number(lng));
    if (pair) return pair;
  }

  const fromBlock = block && block[L];
  return fromBlock ? validCoords(fromBlock.lat, fromBlock.lng) : null;
}

function buildSections(f) {
  // Section Order — an optional Single Line Text field on the Trip Reports row.
  // Comma-separated list of letters, e.g. "A,C,B,D,E,F,G,H,I,J,K".
  // Letters in the list come first (in that order); any remaining populated
  // sections not in the list fall back to alphabetical order after them.
  const coordBlock = parseCoordBlock(f['Map Coords']);
  const orderStr = String(f['Section Order'] || '').toUpperCase().trim();
  const orderList = orderStr
    ? orderStr.split(/[,\s]+/).map(s => s.trim()).filter(L => SECTION_LETTERS.includes(L))
    : [];
  const orderIdx = L => {
    const i = orderList.indexOf(L);
    return i === -1 ? 100 + SECTION_LETTERS.indexOf(L) : i;
  };
  return SECTION_LETTERS
    .map(L => {
      const subtitle = (f[`Subtitle ${L}`] || '').trim();
      if (!subtitle) return null;
      const summary  = f[`Summary ${L}`] || '';
      return {
        letter: L, subtitle, summary,
        photos: sectionPhotos(f, L),
        coords: sectionCoords(f, L, coordBlock),
        animalNames: parseAnimalNames(f[`Animals ${L}`]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => orderIdx(a.letter) - orderIdx(b.letter));
}

function shapeReport(r) {
  const f = r.fields || {};
  return {
    id:               r.id,
    destination:      f['Destination'] || '',
    title:            f['Title']       || '',
    tripSummary:      f['Trip Summary'] || '',
    heroPhoto:        f['Hero Photo']   || '',
    travelers:        f['Travelers']           || '',
    travelersPhoto:   f['Travelers Photo URL'] || '',
    travelersReview:  f['Travelers Description'] || f['Travelers Review'] || '',
    sections:         buildSections(f),
    transport:        parseTransport(f['Transport']),
    archetypeLines:   parseArchetypeLines(f['Archetypes']),
    closingHeadline:  f['Closing Headline'] || '',
    closingPhoto:     f['Closing Photo']    || '',
    closingSummary:   f['Closing Summary']  || '',
  };
}

// The Trip Reports table has no Continent column, so the index page groups by a value
// derived from the destination. An optional "Continent" field on the row always wins,
// for anything this list does not recognise.
const CONTINENT_HINTS = [
  ['Africa',        /uganda|zimbabwe|kenya|tanzania|rwanda|botswana|namibia|south africa|zambia|madagascar|morocco|egypt|ethiopia|serengeti|okavango|kruger|masai|maasai|victoria falls/i],
  ['South America', /patagonia|gal[áa]pagos|ecuador|peru|chile|argentina|brazil|bolivia|colombia|amazon|torres del paine|pantanal/i],
  ['North America', /canad|rockies|alaska|yellowstone|yukon|united states|desert southwest|mexico|costa rica|panama|belize|churchill|great lakes|superior|apostle island|acadia|everglades|smok|glacier national|grand canyon|yosemite|olympic|boundary waters|\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i],
  ['Asia',          /india|nepal|bhutan|borneo|indonesia|japan|thailand|vietnam|sri lanka|mongolia|china|malaysia/i],
  ['Europe',        /iceland|norway|scotland|spain|italy|france|svalbard|finland|sweden|portugal|greece/i],
  ['Oceania',       /new zealand|australia|fiji|papua|tasmania|great barrier/i],
  ['Antarctica',    /antarctic|south georgia/i],
];

function continentFor(f) {
  const explicit = String(f['Continent'] || '').trim();
  if (explicit) return explicit;
  const hay = `${f['Destination'] || ''} ${f['Title'] || ''}`;
  const hit = CONTINENT_HINTS.find(([, re]) => re.test(hay));
  return hit ? hit[0] : 'Other';
}

// Draft / Published, mirroring the Status field the Blog Posts table already uses.
// A blank Status counts as published, so existing reports need no editing.
const isDraft = f => String(f['Status'] || '').trim().toLowerCase() === 'draft';

function shapeListItem(r) {
  const f = r.fields || {};
  return {
    id:          r.id,
    destination: f['Destination'] || '',
    title:       f['Title']       || '',
    heroPhoto:   f['Hero Photo']   || '',
    continent:   continentFor(f),
    draft:       isDraft(f),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { destination } = req.query;
  // ?preview=1 reveals drafts — used by the author to review before publishing.
  const preview = ['1', 'true', 'yes'].includes(String(req.query.preview || '').toLowerCase());

  try {
    const records = [];
    let offset = '';
    do {
      const params = new URLSearchParams();
      if (offset) params.set('offset', offset);
      if (destination) {
        params.set('filterByFormula',
          `LOWER({Destination}) = LOWER("${destination.replace(/"/g, '\\"')}")`);
      }
      params.set('sort[0][field]', 'Destination');
      params.set('sort[0][direction]', 'asc');

      const qs   = params.toString() ? '?' + params.toString() : '';
      const data = await airtableGet(qs);
      if (data.error) return res.status(500).json({ error: data.error.message });
      records.push(...(data.records || []));
      offset = data.offset || '';
    } while (offset);

    // Browsers must revalidate every time (max-age=0) so an Airtable edit shows on the
    // next reload instead of hiding behind a five-minute client cache. The CDN still
    // absorbs the traffic: it serves a cached copy for a minute and can keep serving a
    // stale one for five more while it refreshes in the background.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate, s-maxage=60, stale-while-revalidate=300');

    if (destination) {
      const rec = records[0];
      // A draft is invisible without ?preview=1 — same answer as a report that isn't there.
      if (rec && isDraft(rec.fields || {}) && !preview) return res.status(200).json({ report: null });
      const report = rec ? shapeReport(rec) : null;
      if (report) {
        report.draft = isDraft(rec.fields || {});
        // Resolve every species named in the report in one pass, then group per stop.
        const wanted = [...new Set(report.sections.flatMap(s => s.animalNames))];
        const speciesMap = await fetchSpecies(wanted);
        report.sections.forEach(s => {
          s.animals = sectionAnimals(s.animalNames, speciesMap);
          delete s.animalNames;
        });
        report.archetypes = await resolveArchetypes(report.archetypeLines);
        delete report.archetypeLines;
      }
      return res.status(200).json({ report });
    }
    // List view: drop records with no Destination, and drafts unless previewing.
    const reports = records.map(shapeListItem)
      .filter(r => r.destination)
      .filter(r => preview || !r.draft);
    return res.status(200).json({ reports });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
