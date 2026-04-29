const fs   = require('fs');
const path = require('path');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Blog Posts';

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = async function handler(req, res) {
  const slug = (req.query.slug || '').trim();

  let title       = 'My Journeys — Transformed by Travels';
  let description = 'Stories, insights, and inspiration for transformational travelers.';
  let image       = '';
  const pageUrl   = `https://app.transformedbytravels.com/blog-post.html${slug ? '?slug=' + encodeURIComponent(slug) : ''}`;

  if (slug) {
    try {
      const filter = `?filterByFormula=${encodeURIComponent(`AND({Slug}="${slug}",{Status}="Published")`)}`;
      const url    = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${filter}`;
      const resp   = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
      const data   = await resp.json();
      const rec    = (data.records || [])[0];
      if (rec) {
        const f = rec.fields;
        if (f['Title'])           title       = esc(f['Title']) + ' — Transformed by Travels';
        if (f['Excerpt'])         description = esc(f['Excerpt']);
        if (f['Hero Image URL'])  image       = f['Hero Image URL'];
      }
    } catch(e) { /* serve page anyway without custom OG */ }
  }

  const ogTags = `
  <meta property="og:type"        content="article">
  <meta property="og:site_name"   content="Transformed by Travels">
  <meta property="og:url"         content="${pageUrl}">
  <meta property="og:title"       content="${title}">
  <meta property="og:description" content="${description}">
  ${image ? `<meta property="og:image" content="${image}">` : ''}
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${title}">
  <meta name="twitter:description" content="${description}">
  ${image ? `<meta name="twitter:image" content="${image}">` : ''}`;

  try {
    const htmlPath = path.join(process.cwd(), 'blog-post.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace('</head>', ogTags + '\n</head>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch(e) {
    return res.status(500).send('Page not available');
  }
};
