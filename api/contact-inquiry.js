// Save a contact form submission to the Airtable "Contact Inquiries" table.
//
// Usage:  POST /api/contact-inquiry
//   body: { name, email, message, source, ref, site }

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Contact Inquiries';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')     return res.status(405).json({ error: 'Method not allowed' });

  const b = req.body || {};
  const name    = String(b.name    || '').trim().slice(0, 200);
  const email   = String(b.email   || '').trim().toLowerCase().slice(0, 200);
  const message = String(b.message || '').trim().slice(0, 4000);
  const source  = String(b.source  || 'lets-talk').trim().slice(0, 100);
  const ref     = String(b.ref     || '').trim().slice(0, 100);
  const site    = String(b.site    || 'threerealms').trim().slice(0, 50);

  if (!email || !message) {
    return res.status(400).json({ error: 'email and message required' });
  }

  try {
    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}`, {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        fields: {
          'Name':         name,
          'Email':        email,
          'Message':      message,
          'Source':       source,
          'Ref':          ref,
          'Site':         site,
          'Received At':  new Date().toISOString(),
        }
      }),
    });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
    return res.status(200).json({ success: true, id: data.id });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
