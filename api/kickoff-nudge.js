// Kickoff Nudge — cron endpoint that emails Coach when a trip is ready to launch.
// GET /api/kickoff-nudge (Vercel cron, daily)
//
// Logic per trip where Status=Committed AND Start Date ≤ today:
//   - Kickoff Sent Date empty       → send initial email, set date = today
//   - Kickoff Sent Date == yesterday → send reminder email, set date = today (last nudge)
//   - Kickoff Sent Date == today (or older-than-yesterday) → skip
//
// Coach email is on the Traveler record (Coach Email field).

const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE   = 'Trips';
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

function buildEmailHtml({ tripName, destination, country, startDate, endDate, travelerName, kickoffUrl, isReminder }) {
  const destStr = destination + (country ? ', ' + country : '');
  const dates = startDate ? `${startDate}${endDate ? ' – ' + endDate : ''}` : '';
  const heading = isReminder ? 'Reminder — trip ready to kick off' : 'Trip ready to kick off';
  const bodyText = isReminder
    ? `Following up — <strong>${travelerName || 'your customer'}</strong>'s trip to <strong>${destStr}</strong> was scheduled to start yesterday but hasn't been kicked off yet. When you're ready, use the button below to launch it.`
    : `<strong>${travelerName || 'Your customer'}</strong>'s trip to <strong>${destStr}</strong>${dates ? ` (${dates})` : ''} is scheduled to begin. When they're ready to depart, click below to kick off the trip — this sets it Active, enables the daily journal, and notifies everyone on the trip.`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#0d1520;padding:28px 40px;text-align:center;border-bottom:3px solid #fbbf24;">
        <img src="https://threerealmstravel.com/threerealms/realm-symbols/logo.png" height="44" alt="Three Realms Travel" style="display:block;margin:0 0 10px;" />
        <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#fbbf24;margin:0 0 6px;">Three Realms Travel</p>
        <p style="font-family:Georgia,serif;font-size:20px;color:#ffffff;margin:0;">🚀 ${heading}</p>
      </td></tr>
      <tr><td style="padding:32px 40px 24px;">
        <h2 style="font-family:Georgia,serif;font-size:20px;color:#0f172a;margin:0 0 14px;">${tripName}</h2>
        <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${bodyText}</p>
        <table cellpadding="0" cellspacing="0"><tr><td>
          <a href="${kickoffUrl}" style="display:inline-block;background:#fbbf24;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:8px;">
            Kickoff Trip →
          </a>
        </td></tr></table>
        <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:22px 0 0;">
          You'll be able to confirm time zone, journal time, and add any kickoff notes before launching.
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
    // Load candidate trips: Status=Committed AND Start Date on or before today
    const filter = `AND({Status of Trip}="Committed",{Start Date}<="${today}")`;
    const resp = await airtable(TRIPS_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(filter)}`);
    if (resp.body.error) return res.status(500).json({ error: resp.body.error.message || JSON.stringify(resp.body.error) });
    const trips = resp.body.records || [];

    let sent = 0, skipped = 0;
    const results = [];

    for (const trip of trips) {
      const f = trip.fields || {};
      const sentDate = (f['Kickoff Sent Date'] || '').trim();
      // Decide: send initial, send reminder, or skip
      let isReminder = false;
      if (sentDate === today) { skipped++; continue; }
      if (sentDate === yday)  { isReminder = true; }
      // Any other non-empty date that's not today: means we already sent + reminded → skip
      if (sentDate && sentDate !== yday && sentDate !== today) { skipped++; continue; }

      // Look up coach email via Traveler record
      const travEmail = (f['Traveler Email'] || '').toLowerCase().trim();
      if (!travEmail) { skipped++; continue; }
      const travResp = await airtable(TRAVELER_TABLE, 'GET',
        `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${travEmail}"`)}&maxRecords=1`
      );
      const travRec = (travResp.body.records || [])[0];
      const coachEmail = travRec ? ((travRec.fields['Coach Email'] || '').trim().toLowerCase()) : '';
      const travelerName = travRec ? (travRec.fields['Traveler Name'] || travEmail) : travEmail;
      if (!coachEmail) { skipped++; continue; }

      const kickoffUrl = `https://app.transformedbytravels.com/portal.html?page=planner&kickoffTripId=${encodeURIComponent(trip.id)}`;
      const html = buildEmailHtml({
        tripName:     f['Trip Name'] || f['Destination'] || 'Trip',
        destination:  f['Destination'] || '',
        country:      f['Country'] || '',
        startDate:    f['Start Date'] || '',
        endDate:      f['End Date'] || '',
        travelerName,
        kickoffUrl,
        isReminder,
      });
      const subject = isReminder
        ? `Reminder: kickoff ${travelerName}'s trip`
        : `${travelerName}'s trip is ready to kick off`;

      try {
        await sendEmail({ to: coachEmail, subject, html });
        await airtable(TRIPS_TABLE, 'PATCH', '/' + trip.id, { fields: { 'Kickoff Sent Date': today } });
        sent++;
        results.push({ tripId: trip.id, coach: coachEmail, isReminder });
      } catch(e) {
        console.error('[kickoff-nudge]', trip.id, e.message);
        results.push({ tripId: trip.id, error: e.message });
      }
    }

    return res.status(200).json({ ok: true, sent, skipped, total: trips.length, results });
  } catch(e) {
    console.error('[kickoff-nudge]', e);
    return res.status(500).json({ error: e.message });
  }
};
