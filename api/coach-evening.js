// Coach Evening Prompt — hourly cron.
// Emails a trip's coach in the evening (at the trip's Journal Time) to add coach notes.
// Forward-looking: fires the EVENING BEFORE the trip begins, then each evening while Active.
//   GET /api/coach-evening                      → cron (hour-gated per trip's Journal Time)
//   GET /api/coach-evening?preview=<travelerEmail> → send now for that traveler's trip (bypass hour gate)

const https = require('https');

const BASE_ID        = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE    = 'Trips';
const TRAVELER_TABLE = 'Traveler';
const JOURNAL_TABLE  = 'Journal Entries';
const MEMBERS_TABLE  = 'Trip Members';
const PORTAL_URL     = 'https://app.transformedbytravels.com';
const LOGO           = 'https://threerealmstravel.com/threerealms/realm-symbols/logo.png';

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
    const req = https.request(opts, r => { let raw=''; r.on('data',c=>raw+=c); r.on('end',()=>{ try{resolve({status:r.statusCode,body:JSON.parse(raw||'{}')});}catch(e){reject(new Error('parse: '+raw.slice(0,200)));} }); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sendEmail({ to, subject, html }) {
  const payload = JSON.stringify({ from: 'Michael at Three Realms Travel <michael@transformedbytravels.com>', to, subject, html });
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
    const req = https.request(opts, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(d)); });
    req.on('error', reject); req.write(payload); req.end();
  });
}

const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function localParts(tz) {
  const now = new Date();
  return {
    date: new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC' }).format(now),
    hour: Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', hour12: false }).format(now)),
  };
}
const addDay = (dateStr, n) => { const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayNum = (start, localDate) => { const diff = Math.round((new Date(localDate) - new Date(start)) / 86400000); return diff >= 0 ? diff + 1 : null; };

function wrap(heading, bodyHtml, btnText, btnUrl) {
  return `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;background:#0a1628;padding:0;">
    <div style="text-align:center;padding:22px 0 6px;"><img src="${LOGO}" alt="Three Realms Travel" style="height:60px;width:auto;"></div>
    <div style="background:#111f37;border:1px solid rgba(255,255,255,0.08);border-radius:14px;margin:8px 16px 22px;padding:26px;color:#e6edf6;">
      <h1 style="font-family:Georgia,serif;font-size:20px;color:#fff;margin:0 0 14px;">${esc(heading)}</h1>
      ${bodyHtml}
      ${btnText ? `<div style="text-align:center;margin-top:22px;"><a href="${btnUrl}" style="display:inline-block;background:#2dd4bf;color:#06231f;font-weight:bold;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:8px;">${esc(btnText)}</a></div>` : ''}
    </div>
  </div>`;
}

// Decide the phase for a trip; returns 'before' | 'during' | null.
function phaseFor(f, localDate, ignoreDates) {
  const start = f['Start Date'], end = f['End Date'], status = f['Status of Trip'];
  if (ignoreDates) return status === 'Active' ? 'during' : 'before';
  if (status === 'Active' && start && localDate >= start && (!end || localDate <= end)) return 'during';
  if (start && start === addDay(localDate, 1)) return 'before';
  return null;
}

async function processTrip(trip, { ignoreHour = false } = {}) {
  const f  = trip.fields || {};
  const tz = f['Time Zone'] || 'UTC';
  const { date: localDate, hour: localHour } = localParts(tz);
  const journalHour = Number(f['Journal Time'] || 19);
  if (!ignoreHour && localHour !== journalHour) return null;

  const phase = phaseFor(f, localDate, ignoreHour);
  if (!phase) return null;

  const travEmail = (f['Traveler Email'] || '').toLowerCase();
  if (!travEmail) return null;
  const tr = await airtable(TRAVELER_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${travEmail}"`)}&maxRecords=1`);
  const travRec = (tr.body.records || [])[0];
  const travelerName  = (travRec && travRec.fields['Traveler Name']) || travEmail;
  const travelerFirst = String(travelerName).split(' ')[0];
  const tripName   = f['Trip Name'] || [f['Destination'], f['Country']].filter(Boolean).join(', ') || 'their trip';
  const destStr    = [f['Destination'], f['Country']].filter(Boolean).join(', ');
  const destSuffix = (destStr && destStr !== tripName) ? ` (${destStr})` : '';
  const n = dayNum(f['Start Date'], localDate);
  const done = [];

  // ── Coach: evening notes prompt (night-before + each day) ──
  const coachEmail = ((travRec && travRec.fields['Coach Email']) || '').toLowerCase().trim();
  if (coachEmail) {
    let coachName = coachEmail;
    try {
      const cr = await airtable(TRAVELER_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${coachEmail}"`)}&maxRecords=1&fields%5B%5D=Traveler%20Name`);
      coachName = ((cr.body.records || [])[0]?.fields?.['Traveler Name']) || coachEmail;
    } catch(e) {}
    const coachFirst = String(coachName).split(' ')[0];
    const dashUrl = `${PORTAL_URL}/portal.html?page=planner&coachTripId=${trip.id}`;
    let subject, html;
    if (phase === 'before') {
      subject = `${tripName} starts tomorrow`;
      html = wrap(`${tripName} begins tomorrow`,
        `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;">Hi ${esc(coachFirst)}, <strong style="color:#fff;">${esc(travelerName)}</strong>'s trip — <strong style="color:#fff;">${esc(tripName)}</strong>${esc(destSuffix)} — starts <strong>tomorrow</strong>.</p>
         <p style="font-size:15px;line-height:1.6;margin:0;color:#c3cfdf;">Take a moment tonight to set the tone — jot any kickoff notes, intentions, or things to watch for in your coach journal before day one.</p>`,
        'Add your kickoff notes →', dashUrl);
    } else {
      let journaled = false;
      try {
        const jr = await airtable(JOURNAL_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${trip.id}",{Entry Date}="${localDate}")`)}&maxRecords=1&fields%5B%5D=Entry%20Date`);
        journaled = (jr.body.records || []).length > 0;
      } catch(e) {}
      subject = `${tripName} · Day ${n || ''} — add your coach notes`.replace(/\s+/g, ' ').trim();
      html = wrap(`Day ${n || ''} — ${tripName}`,
        `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;"><strong style="color:#fff;">${esc(travelerName)}</strong> is on <strong>Day ${n || '?'}</strong> of <strong style="color:#fff;">${esc(tripName)}</strong>${esc(destSuffix)}.</p>
         <p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#c3cfdf;">${journaled ? '✓ They\'ve journaled today.' : 'They haven\'t journaled yet today.'}</p>
         <p style="font-size:15px;line-height:1.6;margin:0;color:#c3cfdf;">Take a moment to reflect on their day and add your coach notes.</p>`,
        'Open your coach journal →', `${dashUrl}&cjDay=${n || ''}`);
    }
    await sendEmail({ to: coachEmail, subject, html });
    console.log('[coach-evening] coach', phase, '→', coachEmail);
    done.push('coach');
  }

  // ── Tour Guide: "log today's sightings" (during the trip only) ──
  if (phase === 'during') {
    try {
      const gm = await airtable(MEMBERS_TABLE, 'GET', `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${trip.id}",{Role}="Tour Guide",{Status}="Accepted")`)}`);
      const guides = [...new Set((gm.body.records || []).map(r => (r.fields['Email'] || '').toLowerCase()).filter(Boolean))];
      const pin = f['PIN'] || '';
      for (const gEmail of guides) {
        const trackerUrl = pin
          ? `${PORTAL_URL}/wildlife-tracker.html?pin=${encodeURIComponent(pin)}&loggedByEmail=${encodeURIComponent(gEmail)}&loggedByRole=Tour%20Guide`
          : `${PORTAL_URL}/portal.html?page=tour-guide-home`;
        const subject = `${tripName} · Day ${n || ''} — log today's sightings`.replace(/\s+/g, ' ').trim();
        const html = wrap(`Day ${n || ''} — log the day's sightings`,
          `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;">You're guiding <strong style="color:#fff;">${esc(travelerName)}</strong>'s trip — <strong style="color:#fff;">${esc(tripName)}</strong>${esc(destSuffix)}.</p>
           <p style="font-size:15px;line-height:1.6;margin:0;color:#c3cfdf;">It's the evening of <strong>Day ${n || '?'}</strong> — a good moment to log today's sightings so nothing's lost from ${esc(travelerFirst)}'s Journey Book.</p>`,
          'Log sightings →', trackerUrl);
        await sendEmail({ to: gEmail, subject, html });
        console.log('[coach-evening] guide →', gEmail, trip.id);
        done.push('guide');
      }
    } catch(e) { console.error('[coach-evening] guide error', trip.id, e.message); }
  }

  return done.length ? { phase, done } : null;
}

module.exports = async function handler(req, res) {
  try {
    const preview = (req.query && req.query.preview || '').toLowerCase().trim();
    const tripIdParam = (req.query && req.query.tripId || '').trim();

    if (tripIdParam) {
      const r = await airtable(TRIPS_TABLE, 'GET', `/${tripIdParam}`);
      if (!r.body || !r.body.id) return res.status(404).json({ error: 'trip not found' });
      const out = await processTrip({ id: r.body.id, fields: r.body.fields }, { ignoreHour: true });
      return res.status(200).json({ ok: true, preview: true, tripId: tripIdParam, result: out || 'skipped (no coach/guide?)' });
    }

    if (preview) {
      const r = await airtable(TRIPS_TABLE, 'GET',
        `?filterByFormula=${encodeURIComponent(`AND(LOWER({Traveler Email})="${preview}",OR({Status of Trip}="Active",{Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"))`)}&maxRecords=1`);
      const trip = (r.body.records || [])[0];
      if (!trip) return res.status(404).json({ error: 'No active/upcoming trip for ' + preview });
      const out = await processTrip(trip, { ignoreHour: true });
      return res.status(200).json({ ok: true, preview: true, result: out || 'skipped (no coach?)' });
    }

    const r = await airtable(TRIPS_TABLE, 'GET',
      `?filterByFormula=${encodeURIComponent('OR({Status of Trip}="Active",{Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research")')}&pageSize=100`);
    const trips = r.body.records || [];
    let sent = 0;
    for (const trip of trips) {
      try { if (await processTrip(trip)) sent++; }
      catch(e) { console.error('[coach-evening] trip error', trip.id, e.message); }
    }
    return res.status(200).json({ ok: true, sent, scanned: trips.length });
  } catch(e) {
    console.error('[coach-evening]', e.message);
    return res.status(500).json({ error: e.message });
  }
};
