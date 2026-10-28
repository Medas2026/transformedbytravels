// Coach Daily Digest — cron endpoint.
// For each Coach, sends ONE email summarizing all their Active trips with
// today's activity (sightings count, journal status, day number).
//
// GET /api/coach-digest (Vercel cron, daily)

const https = require('https');

const BASE_ID         = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE     = 'Trips';
const TRIP_DAYS_TABLE = 'Trip Days';
const TRAVELER_TABLE  = 'Traveler';
const SIGHTINGS_TABLE = 'tblWOeO374dxfCgdC';  // Sightings
const JOURNAL_TABLE   = 'Journal Entries';

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

function computeDayNumber(startDate, tz) {
  if (!startDate) return null;
  try {
    const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(new Date());
    const diff = Math.round((new Date(localToday) - new Date(startDate)) / 86400000);
    return diff >= 0 ? diff + 1 : null;
  } catch(e) { return null; }
}

function totalDays(startDate, endDate) {
  if (!startDate || !endDate) return null;
  try {
    const diff = Math.round((new Date(endDate) - new Date(startDate)) / 86400000);
    return diff + 1;
  } catch(e) { return null; }
}

async function enrichTrip(trip) {
  const f = trip.fields || {};
  const tripId = trip.id;
  const tz = f['Time Zone'] || 'UTC';
  const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

  // Count today's sightings for this trip
  let sightingsToday = 0;
  try {
    const sFilter = `AND({Trip ID}="${tripId}",DATETIME_FORMAT({Date},"YYYY-MM-DD")="${localToday}")`;
    const r = await airtable(SIGHTINGS_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(sFilter)}&fields[]=Date`);
    sightingsToday = (r.body.records || []).length;
  } catch(e) { console.warn('[coach-digest] sightings count failed:', tripId, e.message); }

  // Check if traveler journaled today
  let journaledToday = false;
  try {
    const travEmail = (f['Traveler Email'] || '').toLowerCase();
    const jFilter = `AND({Trip ID}="${tripId}",{Entry Date}="${localToday}")`;
    const r = await airtable(JOURNAL_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(jFilter)}&maxRecords=1&fields[]=Entry%20Date`);
    journaledToday = (r.body.records || []).length > 0;
  } catch(e) { console.warn('[coach-digest] journal check failed:', tripId, e.message); }

  // Pull today's Trip Day for current place + coach comments + bumps
  let currentPlace = '';
  let currentPlaceCountry = '';
  let arrivingTo = '';
  let coachComments = '';
  let coachBumps    = '';
  try {
    const dFilter = `AND({Trip ID}="${tripId}",DATETIME_FORMAT({Date},"YYYY-MM-DD")="${localToday}")`;
    const r = await airtable(TRIP_DAYS_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(dFilter)}&maxRecords=1`);
    const day = (r.body.records || [])[0];
    if (day) {
      const df = day.fields || {};
      currentPlace        = df['Ending Location']  || df['Starting Location'] || '';
      currentPlaceCountry = df['Ending Country']   || df['Starting Country']  || '';
      // If they moved locations today, show it as arriving
      if (df['Ending Location'] && df['Starting Location'] && df['Ending Location'] !== df['Starting Location']) {
        arrivingTo = df['Ending Location'];
      }
      coachComments = df['Coach Comments'] || df['Coach Notes'] || '';  // fallback in case of rename lag
      coachBumps    = df['Coach Bumps']    || '';
    }
  } catch(e) { console.warn('[coach-digest] trip day fetch failed:', tripId, e.message); }

  return {
    id:            tripId,
    tripName:      f['Trip Name'] || f['Destination'] || 'Trip',
    destination:   f['Destination'] || '',
    country:       f['Country'] || '',
    startDate:     f['Start Date'] || '',
    endDate:       f['End Date'] || '',
    travelerEmail: (f['Traveler Email'] || '').toLowerCase(),
    dayNumber:     computeDayNumber(f['Start Date'], tz),
    totalDays:     totalDays(f['Start Date'], f['End Date']),
    sightingsToday,
    journaledToday,
    currentPlace,
    currentPlaceCountry,
    arrivingTo,
    coachComments,
    coachBumps,
  };
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function buildDigestHtml(coachName, trips) {
  const cards = trips.map(t => {
    const dayStr   = t.dayNumber && t.totalDays ? `Day ${t.dayNumber} of ${t.totalDays}` : (t.dayNumber ? `Day ${t.dayNumber}` : '');
    const journal  = t.journaledToday
      ? `<span style="color:#059669;">✓ Journaled today</span>`
      : `<span style="color:#94a3b8;">No journal yet today</span>`;
    const sighting = t.sightingsToday
      ? `<strong style="color:#0f172a;">${t.sightingsToday}</strong> sighting${t.sightingsToday === 1 ? '' : 's'}`
      : `<span style="color:#94a3b8;">0 sightings</span>`;
    const url = `https://app.transformedbytravels.com/portal.html?page=planning&tripId=${encodeURIComponent(t.id)}`;
    const dest = [t.destination, t.country].filter(Boolean).join(', ');

    // "Currently at" line — either "arriving at X" or just current place
    const placeLine = t.arrivingTo
      ? `<span style="color:#0d9488;">→ Arriving at <strong>${esc(t.arrivingTo)}</strong> today</span>`
      : t.currentPlace
        ? `<span style="color:#0f172a;">Currently at <strong>${esc(t.currentPlace)}</strong></span>`
        : '';

    // Comments block — amber, positive/observational
    const commentsBlock = t.coachComments ? `
      <div style="margin-top:12px;padding:12px 14px;background:#fefce8;border-left:3px solid #eab308;border-radius:4px;">
        <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#92400e;margin-bottom:6px;">Comments — what they saw &amp; experienced</div>
        <div style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#1a1a2e;white-space:pre-line;">${esc(t.coachComments)}</div>
      </div>` : '';

    // Bumps block — red, things to improve
    const bumpsBlock = t.coachBumps ? `
      <div style="margin-top:8px;padding:12px 14px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;">
        <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#991b1b;margin-bottom:6px;">⚠ Bumps — things that could be better</div>
        <div style="font-family:Georgia,serif;font-size:13px;line-height:1.55;color:#1a1a2e;white-space:pre-line;">${esc(t.coachBumps)}</div>
      </div>` : '';

    const notesBlock = (commentsBlock || bumpsBlock)
      ? commentsBlock + bumpsBlock
      : `<div style="margin-top:12px;font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;font-style:italic;">No coach notes for today yet.</div>`;

    return `
    <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <div style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#0f172a;margin-bottom:4px;">
        <a href="${url}" style="color:#0d9488;text-decoration:none;">${esc(t.tripName)}</a>
        ${dayStr ? `<span style="color:#94a3b8;font-weight:400;font-size:12px;margin-left:8px;">${dayStr}</span>` : ''}
      </div>
      <div style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;margin-bottom:8px;">
        ${esc(t.travelerEmail)}${dest ? ` · ${esc(dest)}` : ''}
      </div>
      ${placeLine ? `<div style="font-family:Arial,sans-serif;font-size:13px;margin-bottom:6px;">${placeLine}</div>` : ''}
      <div style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;">${sighting} · ${journal}</div>
      ${notesBlock}
    </td></tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td style="background:#0d1520;padding:24px 40px;text-align:center;border-bottom:3px solid #2dd4bf;">
    <img src="https://threerealmstravel.com/threerealms/realm-symbols/logo.png" height="44" alt="Three Realms Travel" style="display:block;margin:0 0 10px;" />
    <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 6px;">Three Realms Travel · Coach Digest</p>
    <p style="font-family:Georgia,serif;font-size:20px;color:#ffffff;margin:0;">Your active trips today</p>
  </td></tr>
  <tr><td style="padding:28px 40px 20px;">
    <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.6;margin:0 0 18px;">Hi ${coachName || 'Coach'}, here's a quick check-in on your <strong>${trips.length}</strong> active trip${trips.length===1?'':'s'}:</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;">
      <tbody>${cards}</tbody>
    </table>
    <table cellpadding="0" cellspacing="0" style="margin:24px auto 6px;"><tr><td align="center">
      <a href="https://app.transformedbytravels.com/portal.html?page=planner" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:13px 34px;border-radius:8px;">Open Your Coaching Dashboard →</a>
    </td></tr></table>
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:18px 0 0;">Open your dashboard to see your full roster, or click any trip name above to jump straight into that client's trip. Edit Coach Notes in Airtable Trip Days for tomorrow's digest.</p>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Three Realms Travel · All rights reserved</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

module.exports = async function handler(req, res) {
  try {
    // 1. Load all Active trips
    const filter = `{Status of Trip}="Active"`;
    const resp = await airtable(TRIPS_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(filter)}`);
    if (resp.body.error) return res.status(500).json({ error: resp.body.error.message || JSON.stringify(resp.body.error) });
    const trips = resp.body.records || [];
    if (!trips.length) return res.status(200).json({ ok: true, sent: 0, total: 0, note: 'No active trips' });

    // 2. For each trip, look up its Coach Email (from Traveler record)
    const travelerCache = {};
    async function lookupCoach(email) {
      if (!email) return null;
      if (travelerCache[email] !== undefined) return travelerCache[email];
      try {
        const r = await airtable(TRAVELER_TABLE, 'GET',
          `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${email}"`)}&maxRecords=1&fields[]=Coach%20Email&fields[]=Traveler%20Name`
        );
        const rec = (r.body.records || [])[0];
        const info = rec ? {
          coachEmail: (rec.fields['Coach Email'] || '').toLowerCase(),
          travelerName: rec.fields['Traveler Name'] || email,
        } : null;
        travelerCache[email] = info;
        return info;
      } catch(e) { return null; }
    }

    // 3. Enrich trips with today's stats + Coach lookup
    const enriched = [];
    for (const t of trips) {
      const tripInfo = await enrichTrip(t);
      const travInfo = await lookupCoach(tripInfo.travelerEmail);
      if (!travInfo || !travInfo.coachEmail) continue;
      tripInfo.coachEmail   = travInfo.coachEmail;
      tripInfo.travelerName = travInfo.travelerName;
      enriched.push(tripInfo);
    }

    // 4. Group by Coach
    const byCoach = {};
    for (const t of enriched) {
      if (!byCoach[t.coachEmail]) byCoach[t.coachEmail] = [];
      byCoach[t.coachEmail].push(t);
    }

    // 5. Look up each Coach's own name for the greeting
    const coachNames = {};
    for (const ce of Object.keys(byCoach)) {
      try {
        const r = await airtable(TRAVELER_TABLE, 'GET',
          `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${ce}"`)}&maxRecords=1&fields[]=Traveler%20Name`
        );
        const rec = (r.body.records || [])[0];
        coachNames[ce] = rec ? (rec.fields['Traveler Name'] || 'Coach').split(' ')[0] : 'Coach';
      } catch(e) { coachNames[ce] = 'Coach'; }
    }

    // 6. Send one digest per Coach
    let sent = 0;
    const results = [];
    for (const [coachEmail, coachTrips] of Object.entries(byCoach)) {
      try {
        const subject = coachTrips.length === 1
          ? `Coach digest: ${coachTrips[0].travelerName}'s trip`
          : `Coach digest: ${coachTrips.length} active trips`;
        const html = buildDigestHtml(coachNames[coachEmail], coachTrips);
        await sendEmail({ to: coachEmail, subject, html });
        sent++;
        results.push({ coach: coachEmail, trips: coachTrips.length });
      } catch(e) {
        console.error('[coach-digest]', coachEmail, e.message);
        results.push({ coach: coachEmail, error: e.message });
      }
    }

    return res.status(200).json({ ok: true, sent, coachesWithTrips: Object.keys(byCoach).length, totalActiveTrips: trips.length, results });
  } catch(e) {
    console.error('[coach-digest]', e);
    return res.status(500).json({ error: e.message });
  }
};
