// Guide Photos — notification receipt
// POST /api/guide-photos  { tripId, tripName, guideEmail, count, folder }
// Emails Michael a "photos uploaded" receipt when a tour guide finishes a batch.
// Photos themselves live in Cloudinary (folder guide-uploads/<tripId>); this
// endpoint just closes the loop so he knows to go grab them.

const https = require('https');

const NOTIFY_TO   = 'MichaelE@transformedbytravels.com';
const NOTIFY_FROM = 'ThreeRealms@transformedbytravels.com';
const CLOUD_NAME  = 'dporenlvw';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
}

function sendEmail(subject, html) {
  return new Promise((resolve) => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return resolve(false);
    const body = JSON.stringify({ from: NOTIFY_FROM, to: [NOTIFY_TO], subject, html });
    const req = https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (r) => { r.on('data', () => {}); r.on('end', () => resolve(true)); });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const b = req.body || {};
  const tripId    = String(b.tripId || '').trim();
  const tripName  = String(b.tripName || 'a trip').trim();
  const guide     = String(b.guideEmail || 'A tour guide').trim();
  const count     = parseInt(b.count, 10) || 0;
  const folder    = String(b.folder || (tripId ? 'guide-uploads/' + tripId : '')).trim();

  if (!count) return res.status(400).json({ ok: false, error: 'count required' });

  const mediaLib = `https://console.cloudinary.com/console/${CLOUD_NAME}/media_library/search?q=${encodeURIComponent('folder:' + folder)}`;
  const html = `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
    <div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#0d1520;padding:20px 32px;border-bottom:3px solid #2dd4bf;">
        <img src="https://threerealmstravel.com/threerealms/realm-symbols/logo.png" height="44" alt="Three Realms Travel" style="display:block;margin:0 0 10px;" />
        <p style="font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0;">Three Realms Travel · Guide Photos</p>
      </div>
      <div style="padding:28px 32px;">
        <h1 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 12px;">${count} new photo${count === 1 ? '' : 's'} from the field</h1>
        <p style="font-size:15px;color:#0f172a;line-height:1.7;margin:0 0 18px;">
          <strong>${esc(guide)}</strong> just uploaded <strong>${count}</strong> photo${count === 1 ? '' : 's'} for <strong>${esc(tripName)}</strong>.
        </p>
        <p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 8px;">They're in your Cloudinary Media Library, in the folder:</p>
        <p style="font-size:14px;color:#0f172a;background:#f1f5f9;border-radius:8px;padding:10px 14px;margin:0 0 22px;font-family:monospace;">${esc(folder)}</p>
        <div style="text-align:center;margin:6px 0 4px;">
          <a href="${mediaLib}" style="display:inline-block;background:#2dd4bf;color:#0a1628;text-decoration:none;font-weight:800;font-size:15px;padding:13px 32px;border-radius:8px;">Open the folder in Cloudinary →</a>
        </div>
        <p style="font-size:12px;color:#94a3b8;margin:20px 0 0;line-height:1.6;">Originals are preserved for print. You can multi-select and download, or grab the whole folder as a zip.</p>
      </div>
    </div>
  </div>`;

  await sendEmail(`${count} photo${count === 1 ? '' : 's'} uploaded for ${tripName}`, html);
  return res.status(200).json({ ok: true });
};
