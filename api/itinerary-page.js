// Serves a single itinerary with its own Open Graph tags baked into the <head>.
//
// Same reasoning as trip-report-page.js: the itinerary renders client-side from
// /api/itineraries, and social crawlers do not run JavaScript — they read the static head and
// nothing else. Without this, every shared itinerary previewed as the generic site card.
// vercel.json rewrites /threerealms/itinerary.html here, so the ordinary shareable URL
// (…/itinerary.html?name=Uganda) keeps working exactly as before. The CDN caches the result,
// so this is not a per-visitor Airtable call.
const fs   = require('fs');
const path = require('path');
const { esc, plain, ogTags } = require('./_social.js');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Itineraries';
const SITE    = 'https://threerealmstravel.com';

module.exports = async (req, res) => {
  const name = String((req.query && req.query.name) || '').trim();
  // ?preview=1 reveals drafts, matching /api/itineraries — the author uses it to check a page
  // before publishing. A preview is never indexed and never gets a rich card.
  const preview = ['1', 'true', 'yes'].includes(String((req.query && req.query.preview) || '').toLowerCase());

  let title       = 'Itineraries — Three Realms Travel';
  let description = 'Wildlife itineraries built around the animals you want to see, the places they actually live, and the months you can see them.';
  let image       = '';
  let noindex     = false;
  const pageUrl   = `${SITE}/threerealms/itinerary.html${name ? '?name=' + encodeURIComponent(name) : ''}`;

  if (name) {
    try {
      const escName = name.replace(/"/g, '\\"');
      const filter  = `?filterByFormula=${encodeURIComponent(`LOWER({${TABLE}}) = LOWER("${escName}")`)}&maxRecords=1`;
      const url     = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${filter}`;
      const data    = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY } }).then(r => r.json());
      const rec     = (data.records || [])[0];
      const f       = (rec && rec.fields) || {};
      // A draft must not produce a rich social card — pasting the link anywhere would
      // otherwise leak the title and hero photo of unpublished work. Same rule as drafts
      // in /api/itineraries and in the trip reports.
      const draft = String(f['Status'] || '').trim().toLowerCase() === 'draft';

      if (rec && !draft) {
        if (f[TABLE])         title = `${f[TABLE]} — Three Realms Travel`;
        if (f['Description']) description = plain(f['Description']);
        if (f['Hero Photo'])  image = heroUrl(f['Hero Photo']);
      }
      if (draft) noindex = true;
    } catch (e) { /* fall through to the generic card rather than failing the page */ }
  }
  if (preview) noindex = true;

  const og = ogTags({ type: 'article', siteName: 'Three Realms Travel', pageUrl, title, description, image, noindex });

  try {
    // The page markup lives at itinerary-view.html. A static file at the public path would take
    // precedence over the rewrite, so /threerealms/itinerary.html deliberately has no file
    // behind it and is served entirely by this function.
    const htmlPath = path.join(process.cwd(), 'threerealms', 'itinerary-view.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    // The page sets its own <title> from JS once the fetch resolves; replacing the static one
    // keeps the tab right for crawlers and for the moment before that happens.
    html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title id="page-title">${esc(title)}</title>`);
    html = html.replace('</head>', og + '\n</head>');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send('Itinerary not available');
  }
};

// Hero Photo may be an Airtable attachment array or a plain URL string, depending on how the
// field was filled in. Take the first usable url either way.
function heroUrl(v) {
  if (Array.isArray(v)) return (v[0] && (v[0].url || '')) || '';
  if (v && typeof v === 'object') return v.url || '';
  return String(v || '');
}

module.exports.config = { maxDuration: 15 };
