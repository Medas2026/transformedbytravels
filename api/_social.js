// Shared helpers for the server-rendered social cards (trip reports, itineraries).
// NOT routed — the leading underscore keeps Vercel from exposing it as an endpoint.
//
// Social crawlers do not run JavaScript. They read the static <head> and nothing else, which
// is why pages whose content arrives by fetch need their Open Graph tags baked in server-side.

// Social cards want exactly 1200x630. A Hero Photo is whatever was uploaded — often something
// like 1152x648 — and declaring a size we do not actually serve gives Facebook a reason to fall
// back to a small card, or to none at all. These are Cloudinary URLs, so ask Cloudinary for the
// right crop rather than lying about it: g_auto picks the subject instead of the middle, which
// matters when the animal is off to one side. It also cuts the file by about 85%, so the
// crawler is far less likely to time out fetching it.
//
// Anything that is not a Cloudinary upload URL passes through untouched, and in that case the
// dimensions are simply not declared — better silent than wrong.
const CLOUDINARY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

function socialImage(url) {
  const m = CLOUDINARY.exec(String(url || ''));
  if (!m) return { url: url || '', sized: false };
  // Drop any transformation that is already on the URL, so ours is not appended to a conflicting one.
  const rest = m[2].replace(/^(c_[^/]*|w_\d+|h_\d+|g_[^/]*|q_[^/]*|f_[^/]*)(,[^/]*)*\//, '');
  return { url: `${m[1]}c_fill,g_auto,w_1200,h_630,f_jpg,q_auto/${rest}`, sized: true };
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Rich text flattened to a sentence or two for a share card, cut at a sentence end where one
// falls in range, otherwise at a word boundary with an ellipsis.
function plain(s, max = 200) {
  let t = String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_#`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  const cut  = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (stop > 80 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…').trim();
}

// The tag block itself, so both renderers emit exactly the same shape.
function ogTags({ type, siteName, pageUrl, title, description, image, noindex }) {
  const social = socialImage(image);
  return `
  <meta property="og:type"        content="${esc(type || 'website')}">
  <meta property="og:site_name"   content="${esc(siteName)}">
  <meta property="og:url"         content="${esc(pageUrl)}">
  <meta property="og:title"       content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  ${social.url ? `<meta property="og:image" content="${esc(social.url)}">
  ${social.sized ? `<meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">` : ''}` : ''}
  <meta name="twitter:card"        content="${social.url ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title"       content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  ${social.url ? `<meta name="twitter:image" content="${esc(social.url)}">` : ''}
  <meta name="description"         content="${esc(description)}">
  <link rel="canonical" href="${esc(pageUrl)}">
  ${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}`;
}

module.exports = { socialImage, esc, plain, ogTags };
