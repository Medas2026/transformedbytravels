// Close Nudge — cron endpoint that emails Coach when a trip is ready to close.
// GET /api/close-nudge (Vercel cron, daily)
//
// Logic per trip where Status=Active AND End Date ≤ today:
//   - Close Sent Date empty        → send initial email, set date = today
//   - Close Sent Date == yesterday → send reminder email, set date = today (last nudge)
//   - Close Sent Date == today (or older-than-yesterday) → skip
//
// Coach email is on the Traveler record (Coach Email field).

const https = require('https');

const BASE_ID        = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE    = 'Trips';
const TRAVELER_TABLE = 'Traveler';

function airtable(table, method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path || ''}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + process.env.AIRTABLE_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }); }
        catch(e) { reject(new Error('parse: ' + raw.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function sendEmail({ to, subject, html }) {
  const payload = JSON.stringify({
    from:    'Michael at Three Realms Travel <michael@transformedbytravels.com>',
    to, subject, html,
  });
  await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve());
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function buildEmailHtml({ tripName, destination, country, endDate, travelerName, closeUrl, isReminder }) {
  const destStr = destination + (country ? ', ' + country : '');
  const heading = isReminder ? 'Reminder — trip ready to close' : 'Trip ready to close';
  const bodyText = isReminder
    ? `Following up — <strong>${travelerName || 'your customer'}</strong>'s trip to <strong>${destStr}</strong> ended yesterday but hasn't been closed yet. When you're ready, use the button below to complete it.`
    : `<strong>${travelerName || 'Your customer'}</strong>'s trip to <strong>${destStr}</strong>${endDate ? ` (ended ${endDate})` : ''} is ready to be marked complete. Click below to close the trip — this sets it Completed, sends the traveler their welcome-home email, and notifies all Trip Members.`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#0d1520;padding:28px 40px;text-align:center;border-bottom:3px solid #a78bfa;">
        <img src="https://threerealmstravel.com/threerealms/realm-symbols/logo.png" height="44" alt="Three Realms Travel" style="display:block;margin:0 0 10px;" />
        <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#a78bfa;margin:0 0 6px;">Three Realms Travel</p>
        <p style="font-family:Georgia,serif;font-size:20px;color:#ffffff;margin:0;">🏁 ${heading}</p>
      </td></tr>
      <tr><td style="padding:32px 40px 24px;">
        <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 14px;">${tripName}</h2>
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${bodyText}</p>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${closeUrl}" style="display:inline-block;background:#a78bfa;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:8px;">
            Complete Trip →
          </a>
        </td></tr></table>
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:22px 0 0;">
          You'll be able to add coach notes and a rating before closing.
        </p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:18px 40px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Three Realms Travel · All rights reserved</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function yesterdayISO() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

module.exports = async function handler(req, res) {
  const today = new Date().toISOString().split('T')[0];
  const yday  = yesterdayISO();

  try {
    // Load candidate trips: Status=Active AND End Date on or before today
    const filter = `AND({Status of Trip}="Active",{End Date}<="${today}")`;
    const resp = await airtable(TRIPS_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(filter)}`);
    if (resp.body.error) return res.status(500).json({ error: resp.body.error.message || JSON.stringify(resp.body.error) });
    const trips = resp.body.records || [];

    let sent = 0, skipped = 0;
    const results = [];

    for (const trip of trips) {
      const f = trip.fields || {};
      const sentDate = (f['Close Sent Date'] || '').trim();
      let isReminder = false;
      if (sentDate === today) { skipped++; continue; }
      if (sentDate === yday)  { isReminder = true; }
      if (sentDate && sentDate !== yday && sentDate !== today) { skipped++; continue; }

      const travEmail = (f['Traveler Email'] || '').toLowerCase().trim();
      if (!travEmail) { skipped++; continue; }
      const travResp = await airtable(TRAVELER_TABLE, 'GET',
        `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${travEmail}"`)}&maxRecords=1`
      );
      const travRec = (travResp.body.records || [])[0];
      const coachEmail = travRec ? ((travRec.fields['Coach Email'] || '').trim().toLowerCase()) : '';
      const travelerName = travRec ? (travRec.fields['Traveler Name'] || travEmail) : travEmail;
      if (!coachEmail) { skipped++; continue; }

      const closeUrl = `https://app.transformedbytravels.com/portal.html?page=planner&completeTripId=${encodeURIComponent(trip.id)}`;
      const html = buildEmailHtml({
        tripName:     f['Trip Name'] || f['Destination'] || 'Trip',
        destination:  f['Destination'] || '',
        country:      f['Country'] || '',
        endDate:      f['End Date'] || '',
        travelerName,
        closeUrl,
        isReminder,
      });
      const subject = isReminder
        ? `Reminder: close ${travelerName}'s trip`
        : `${travelerName}'s trip is ready to close`;

      try {
        await sendEmail({ to: coachEmail, subject, html });
        await airtable(TRIPS_TABLE, 'PATCH', '/' + trip.id, { fields: { 'Close Sent Date': today } });
        sent++;
        results.push({ tripId: trip.id, coach: coachEmail, isReminder });
      } catch(e) {
        console.error('[close-nudge]', trip.id, e.message);
        results.push({ tripId: trip.id, error: e.message });
      }
    }

    return res.status(200).json({ ok: true, sent, skipped, total: trips.length, results });
  } catch(e) {
    console.error('[close-nudge]', e);
    return res.status(500).json({ error: e.message });
  }
};
