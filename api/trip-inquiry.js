// Handles the "Send this to Michael" submission from /wishlist.html on Three Realms.
// Emails Michael with the visitor's contact, realm interests, wishlist, and message.
// No Airtable table for MVP — just Resend email.

async function sendViaResend({ to, subject, html, replyTo, from }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:     from || 'ThreeRealms@transformedbytravels.com',
      to,
      subject,
      html,
      reply_to: replyTo || undefined,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Resend error ' + resp.status);
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const b = req.body || {};
  const name    = String(b.name    || '').trim();
  const email   = String(b.email   || '').trim();
  const phone   = String(b.phone   || '').trim();
  const group   = String(b.group   || '').trim();
  const dates   = String(b.dates   || '').trim();
  const message = String(b.message || '').trim();
  const regions = Array.isArray(b.regions) ? b.regions : [];
  const places  = Array.isArray(b.places)  ? b.places  : [];
  const animals = Array.isArray(b.animals) ? b.animals : [];
  const itineraries = Array.isArray(b.itineraries) ? b.itineraries : [];
  const realms  = b.realms || {};

  if (!name || !email) return res.status(400).json({ error: 'name and email required' });

  const realmLine = ['land','ocean','sky']
    .filter(r => realms[r])
    .map(r => `${r.charAt(0).toUpperCase() + r.slice(1)}: ${realms[r]}`)
    .join(' · ') || '(not set)';

  const regionsHtml = regions.length
    ? regions.map(r => {
        const badges = [
          r.land  ? `Land ${r.land === 3 ? 'World-class' : r.land === 2 ? 'Notable' : 'Marginal'}`  : '',
          r.ocean ? `Ocean ${r.ocean === 3 ? 'World-class' : r.ocean === 2 ? 'Notable' : 'Marginal'}` : '',
          r.sky   ? `Sky ${r.sky === 3 ? 'World-class' : r.sky === 2 ? 'Notable' : 'Marginal'}`   : '',
        ].filter(Boolean).join(' · ');
        return `<li style="margin:6px 0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;"><strong>${r.name}</strong>${badges ? ` <span style="color:#64748b;font-size:12px;">(${badges})</span>` : ''}</li>`;
      }).join('')
    : '<li style="color:#94a3b8;font-style:italic;">(none)</li>';

  const itinerariesHtml = itineraries.length
    ? itineraries.map(it => {
        const days = it.days ? ` <span style="color:#64748b;font-size:12px;">(${escapeHtml(String(it.days))})</span>` : '';
        return `<li style="margin:6px 0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;"><strong>${escapeHtml(it.name || '')}</strong>${days}</li>`;
      }).join('')
    : '<li style="color:#94a3b8;font-style:italic;">(none)</li>';

  const placesHtml = places.length
    ? places.map(p => {
        const ctx = [p.region, p.country].filter(Boolean).join(' · ');
        return `<li style="margin:6px 0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;"><strong>${p.name}</strong>${ctx ? ` <span style="color:#64748b;font-size:12px;">(${ctx})</span>` : ''}</li>`;
      }).join('')
    : '<li style="color:#94a3b8;font-style:italic;">(none)</li>';

  const animalsHtml = animals.length
    ? animals.map(a => {
        const sci = a.sci ? ` <em style="color:#64748b;">${a.sci}</em>` : '';
        return `<li style="margin:6px 0;font-family:Arial,sans-serif;font-size:14px;color:#0f172a;"><strong>${a.name}</strong>${sci}</li>`;
      }).join('')
    : '<li style="color:#94a3b8;font-style:italic;">(none)</li>';

  const html = `
    <div style="max-width:640px;margin:0 auto;font-family:Arial,sans-serif;background:#f8fafc;padding:24px;">
      <div style="background:#fff;border-radius:12px;padding:28px 32px;">
        <h1 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 6px;">New trip inquiry — Three Realms</h1>
        <p style="font-size:13px;color:#64748b;margin:0 0 20px;">Received ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' })} CT</p>

        <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
          <tr><td style="padding:6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;width:120px;">Name</td><td style="padding:6px 0;font-size:15px;color:#0f172a;">${escapeHtml(name)}</td></tr>
          <tr><td style="padding:6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Email</td><td style="padding:6px 0;font-size:15px;color:#0f172a;"><a href="mailto:${escapeAttr(email)}" style="color:#2dd4bf;">${escapeHtml(email)}</a></td></tr>
          ${phone ? `<tr><td style="padding:6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Phone</td><td style="padding:6px 0;font-size:15px;color:#0f172a;">${escapeHtml(phone)}</td></tr>` : ''}
          ${group ? `<tr><td style="padding:6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Group size</td><td style="padding:6px 0;font-size:15px;color:#0f172a;">${escapeHtml(group)}</td></tr>` : ''}
          ${dates ? `<tr><td style="padding:6px 0;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">When</td><td style="padding:6px 0;font-size:15px;color:#0f172a;">${escapeHtml(dates)}</td></tr>` : ''}
        </table>

        <div style="background:#f1f5f9;border-radius:8px;padding:14px 18px;margin-bottom:20px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">Realm interests</div>
          <div style="font-size:14px;color:#0f172a;">${escapeHtml(realmLine)}</div>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">Regions of interest (${regions.length})</div>
          <ul style="margin:0;padding-left:20px;">${regionsHtml}</ul>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">Itineraries of interest (${itineraries.length})</div>
          <ul style="margin:0;padding-left:20px;">${itinerariesHtml}</ul>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">Specific parks / places (${places.length})</div>
          <ul style="margin:0;padding-left:20px;">${placesHtml}</ul>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">Animals of interest (${animals.length})</div>
          <ul style="margin:0;padding-left:20px;">${animalsHtml}</ul>
        </div>

        ${message ? `
        <div style="background:#f1f5f9;border-radius:8px;padding:14px 18px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">Message</div>
          <div style="font-size:14px;color:#0f172a;white-space:pre-wrap;line-height:1.6;">${escapeHtml(message)}</div>
        </div>
        ` : ''}

        <p style="font-size:12px;color:#94a3b8;margin:22px 0 0;">Reply directly to this email to get back to ${escapeHtml(name)}.</p>
      </div>
    </div>
  `;

  const subject = `Trip inquiry — ${name}`;

  try {
    await sendViaResend({
      to:      'MichaelE@transformedbytravels.com',
      subject,
      html,
      replyTo: email,
    });
    return res.status(200).json({ ok: true });
  } catch(e) {
    console.error('[trip-inquiry] send failed:', e);
    return res.status(500).json({ error: e.message || 'send failed' });
  }
};

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
