// Serves the trip report page with per-report Open Graph tags baked into the <head>.
//
// The report itself renders client-side from /api/trip-reports, but social crawlers
// (Facebook, LinkedIn, iMessage, Slack, X) do not run JavaScript — they read the static
// head and nothing else. Without this, every shared trip report previewed as the generic
// site card. vercel.json rewrites /threerealms/trip-report.html here so the ordinary
// shareable URL works; the CDN caches the result, so this is not a per-visitor cost.
const { socialImage } = require('./_social.js');

const fs   = require('fs');
const path = require('path');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Trip Reports';
const SITE    = 'https://threerealmstravel.com';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Trip Summary is rich text. Flatten it to a plain sentence or two for the share card.
function plain(s, max = 200) {
  let t = String(s || '')
    .replace(/<[^>]+>/g, ' ')          // any embedded html
    .replace(/[*_#`>]/g, '')           // light markdown
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
}

module.exports = async function handler(req, res) {
  const destination = String(req.query.destination || '').trim();

  let title = 'Trip Report — Three Realms Travel';
  let description = 'Real journeys, real wildlife, real days in camp — what happens when our travelers come back from a place.';
  let image = '';
  let noindex = false;
  const pageUrl = `${SITE}/threerealms/trip-report.html${destination ? '?destination=' + encodeURIComponent(destination) : ''}`;

  if (destination) {
    try {
      const filter = `?filterByFormula=${encodeURIComponent(`LOWER({Destination})=LOWER("${destination.replace(/"/g, '\\"')}")`)}`;
      const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${filter}`;
      const data = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY } }).then(r => r.json());
      const rec = (data.records || [])[0];
      // A draft must not produce a rich social card — pasting the link anywhere would
      // otherwise leak the title and hero photo of unpublished work.
      const draft = rec && String(rec.fields['Status'] || '').trim().toLowerCase() === 'draft';
      if (rec && !draft) {
        const f = rec.fields;
        if (f['Title'])        title = `${f['Title']} — Three Realms Travel`;
        else if (f['Destination']) title = `${f['Destination']} — Three Realms Travel`;
        if (f['Trip Summary']) description = plain(f['Trip Summary']);
        if (f['Hero Photo'])   image = f['Hero Photo'];
      }
      if (draft) noindex = true;
    } catch (e) { /* fall through to the generic card rather than failing the page */ }
  }

  const social = socialImage(image);
  const og = `
  <meta property="og:type"        content="article">
  <meta property="og:site_name"   content="Three Realms Travel">
  <meta property="og:url"         content="${esc(pageUrl)}">
  <meta property="og:title"       content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  ${social.url ? `<meta property="og:image" content="${esc(social.url)}">
  ${social.sized ? `<meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">` : ''}` : ''}
  <meta name="twitter:card"        content="${image ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title"       content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  ${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
  <meta name="description"         content="${esc(description)}">
  <link rel="canonical" href="${esc(pageUrl)}">
  ${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}`;

  try {
    // The page markup lives at trip-report-view.html. A static file at the public path
    // would take precedence over the rewrite, so the public /threerealms/trip-report.html
    // deliberately has no file behind it and is served entirely by this function.
    const htmlPath = path.join(process.cwd(), 'threerealms', 'trip-report-view.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    // The page sets its own <title> from JS after load; replacing the static one keeps
    // the tab correct for crawlers and for the moment before the fetch resolves.
    html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title id="page-title">${esc(title)}</title>`);
    html = html.replace('</head>', og + '\n</head>');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Served from the CDN for most visitors; a stale copy is fine while it refreshes.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send('Trip report not available');
  }
};

module.exports.config = { maxDuration: 15 };
