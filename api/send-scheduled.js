// send-scheduled.js — sends whatever the message plan says is due today.
// GET /api/send-scheduled   (Vercel cron, daily)
//
// The schedule says WHEN; the Emails table says WHAT. A due message with no copy written
// is skipped and said so — never sent blank. That matters more than usual here because
// the guest sees the property's name on it, not ours.
//
// Copy lookup, most specific first:
//   STAY_PRE_84   exact rung
//   STAY_PRE      phase fallback, so one template can cover a whole band early on
//
// SMS is generated into the plan but never sent: a guest whose reservation a lodge
// forwarded has not consented to texts from us, and TCPA damages are per message. Rows
// are skipped with that reason until there is a consent flag to check.

const BASE_ID  = 'appdlxcWb45dIqNK2';
const SCHED    = 'Scheduled Messages';
const TRIPS    = 'Trips';
const TRAVELER = 'Traveler';
const PROPERTY = 'Property';
const EMAILS   = 'Emails';
const ARCHETYPES = 'Archetype Table';
const DAILY_TIPS = 'Daily Tips';
const { PRE_RUNGS, POST_STAY } = require('./_schedule.js');

// The ladder in order. Used as a tiebreak when two messages share a send date — without
// it the ordinal depends on whatever order Airtable returned, so a guest's tip number
// could differ between two runs of the same day.
const LADDER = ['welcome', ...PRE_RUNGS.map(n => `pre-${n}`), 'kickoff',
                ...Array.from({ length: 31 }, (_, i) => `stay-day-${i + 1}`),
                'checkout', 'closing', ...POST_STAY.map(n => `post-${n}`), 'goodbye'];
const ladderPos = key => { const i = LADDER.indexOf(String(key)); return i < 0 ? 999 : i; };

const SENDING_DOMAIN = 'stays.transformedbytravels.com';
const MAX_PER_RUN = 200;

async function at(table, path = '', method = 'GET', body = null) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const esc = s => String(s == null ? '' : s).replace(/"/g, '\\"');
const h = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const iso = d => new Date(d).toISOString().split('T')[0];

// 'pre-84' → ['STAY_PRE_84', 'STAY_PRE'];  'welcome' → ['STAY_WELCOME']
function codesFor(key) {
  const k = String(key || '');
  const m = k.match(/^(pre|post|stay-day)-(\d+)$/);
  if (m) {
    const band = { pre: 'PRE', post: 'POST', 'stay-day': 'DAY' }[m[1]];
    return [`STAY_${band}_${m[2]}`, `STAY_${band}`];
  }
  return [`STAY_${k.toUpperCase().replace(/-/g, '_')}`];
}

// Both the current and former names have to resolve — two archetypes were renamed after
// the slot codes were set, and a guest assessed today as a Growth Seeker would otherwise
// match nothing and silently get unsorted content.
function archetypeCode(fullName) {
  const n = String(fullName || '').toLowerCase();
  if (n.includes('growth') || n.includes('transformational')) return 'TT';
  if (n.includes('experience') || n.includes('easy'))         return 'EGT';
  if (n.includes('adventure'))                                return 'AOT';
  if (n.includes('cultural'))                                 return 'CE';
  if (n.includes('purpose'))                                  return 'PDT';
  return '';
}

// The property has already written six archetype-tagged blocks for the guest's page.
// Rather than ask anyone to write a seventh thing, surface the best-matching one — and
// rotate it by rung, so twelve pre-arrival emails cite twelve different suggestions
// instead of repeating one.
function suggestionFor(pf, code, messageKey) {
  const slots = [];
  for (let n = 1; n <= 6; n++) {
    const title = String((Array.isArray(pf[`Slot ${n} Title`]) ? pf[`Slot ${n} Title`].join(', ') : pf[`Slot ${n} Title`]) || '').trim();
    const body  = String(pf[`Slot ${n} Body`] || '').trim();
    if (!title && !body) continue;
    const raw = pf[`Slot ${n} Archetypes`];
    const tags = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    slots.push({ n, title, body, tags });
  }
  if (!slots.length) return { title: '', body: '' };
  const matched = code ? slots.filter(s => s.tags.includes(code)) : [];
  const pool = matched.length ? matched : slots.filter(s => s.tags.includes('ALL'));
  const use = pool.length ? pool : slots;
  // Rotate by POSITION in the ladder, not by the offset's value — the offsets are all
  // even, so modulo on them lands on the same slot every time for any even-sized pool.
  // Deterministic, so a retry of the same message picks the same suggestion.
  const m = String(messageKey).match(/^(pre|post)-(\d+)$/);
  let position = 0;
  if (m) {
    const list = m[1] === 'pre' ? PRE_RUNGS : POST_STAY;
    const at = list.indexOf(Number(m[2]));
    position = at >= 0 ? at : 0;
  }
  return use[position % use.length];
}

// Daily Tips still files tips under the archetypes' former names. A guest assessed today
// as a Growth Seeker would match nothing without this.
const TIP_ARCHETYPE = {
  TT:  'Transformational Traveler',
  EGT: 'Easygoing Traveler',
  AOT: 'Adventure-Oriented Traveler',
  CE:  'Cultural Explorer',
  PDT: 'Purpose-Driven Traveler',
};

function fill(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, name) =>
    vars[name] == null ? '' : String(vars[name]));
}

function buildHtml({ subject, paragraphs, property, vars, unsubUrl }) {
  const body = paragraphs.filter(Boolean)
    .map(p => `<p style="margin:0 0 17px;font-size:15px;line-height:1.72;color:#3d4d55">${h(fill(p, vars))}</p>`)
    .join('');
  return `<div style="font-family:Georgia,'Times New Roman',serif;max-width:560px;margin:0 auto;padding:8px 4px">
  <p style="font-family:system-ui,Arial,sans-serif;font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:#8d9ca3;margin:0 0 20px">${h(property.name)}</p>
  <h1 style="font-size:21px;line-height:1.35;color:#18242c;margin:0 0 20px;font-weight:normal">${h(fill(subject, vars))}</h1>
  ${body}
  ${vars.trip_url ? `<p style="margin:26px 0 0"><a href="${h(vars.trip_url)}" style="font-family:system-ui,Arial,sans-serif;background:#2a7f73;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px;display:inline-block">Open your page →</a></p>` : ''}
  <p style="font-family:system-ui,Arial,sans-serif;font-size:11.5px;color:#9aa8ae;line-height:1.7;margin:34px 0 0;border-top:1px solid #e2eae7;padding-top:14px">
    Sent by ${h(property.name)} through Transformed by Travels.
    <a href="${h(unsubUrl)}" style="color:#9aa8ae">Unsubscribe</a>
  </p>
</div>`;
}

async function sendEmail({ to, from, replyTo, subject, html, unsubUrl }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to, subject, html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      // One-click unsubscribe. Gmail and Yahoo expect it on bulk mail, and a list that
      // is easy to leave is a list that stays out of spam folders.
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error((d.error && d.error.message) || d.message || `send failed (${r.status})`);
  return d.id || '';
}

// A link field cannot be filtered by record id — Airtable compares it to the linked
// record's primary-field text. Narrow on a real scalar, then match the link in JS.
async function rowsForTrip(tripId, guestEmail) {
  const out = [];
  let offset = '';
  do {
    const p = new URLSearchParams({ pageSize: '100' });
    if (guestEmail) p.set('filterByFormula', `LOWER({Guest Email})="${esc(String(guestEmail).toLowerCase())}"`);
    if (offset) p.set('offset', offset);
    const d = await at(SCHED, '?' + p.toString());
    if (d.error) return out;
    out.push(...(d.records || []));
    offset = d.offset || '';
  } while (offset);
  return out.filter(r => Array.isArray(r.fields['Trips']) && r.fields['Trips'].includes(tripId));
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const dryRun = String((req.query || {}).dry || '') === '1';
  const today = iso(new Date());
  const out = { date: today, dryRun, sent: 0, skipped: 0, failed: 0, detail: [] };

  try {
    // Two Airtable traps in one query, both of which fail by returning nothing rather
    // than erroring once `.records || []` has swallowed the response:
    //   · a date field cannot be compared to a string literal. {Send Date}<="2026-10-06"
    //     matches rows strictly earlier but never the same day — exactly the rows a
    //     "due today" cron exists to find. Date functions are the only reliable form.
    //   · pageSize caps at 100. Ask for more and the whole request is rejected.
    const due = [];
    let offset = '';
    do {
      const p = new URLSearchParams({
        filterByFormula: 'AND({Status}="Scheduled",NOT(IS_AFTER({Send Date},TODAY())))',
        'sort[0][field]': 'Send Date',
        pageSize: '100',
      });
      if (offset) p.set('offset', offset);
      const d = await at(SCHED, '?' + p.toString());
      if (d.error) throw new Error('could not read the schedule: ' + d.error.message);
      due.push(...(d.records || []));
      offset = d.offset || '';
    } while (offset && due.length < MAX_PER_RUN);
    due.length = Math.min(due.length, MAX_PER_RUN);

    // 120 tips — 24 per archetype. Loaded once and indexed, not re-fetched per message.
    const tips = {};
    {
      let offset = '';
      do {
        const p = new URLSearchParams({ pageSize: '100' });
        if (offset) p.set('offset', offset);
        const d = await at(DAILY_TIPS, '?' + p.toString());
        if (d.error) break;
        (d.records || []).forEach(r => {
          const a = String(r.fields['Archetype'] || '').trim();
          const n = Number(r.fields['Tip Number']);
          if (a && n) (tips[a] = tips[a] || {})[n] = r.fields;
        });
        offset = d.offset || '';
      } while (offset);
    }

    // Archetype guidance is the same for every guest of a given archetype, so load it once.
    const arche = {};
    ((await at(ARCHETYPES, '?pageSize=100')).records || []).forEach(r => {
      const f = r.fields;
      if (f['Archetype Name']) arche[String(f['Archetype Name']).trim().toLowerCase()] = f;
    });

    // Templates once, not once per message.
    const templates = {};
    ((await at(EMAILS, '?pageSize=100')).records || []).forEach(r => {
      if (r.fields['Code']) templates[String(r.fields['Code']).trim().toUpperCase()] = r.fields;
    });

    // ?preview=1 — render every STAY_* template against a sample guest, with no stay and
    // no schedule row needed. Writing this copy means checking that the tokens resolved,
    // and waiting for a real message to fall due is a poor way to do that.
    //   &archetype=The Growth Seeker   &property=recXXX   &arrival=2027-05-10
    if (String((req.query || {}).preview || '') === '1') {
      const q = req.query || {};
      const props = (await at(PROPERTY, '?pageSize=100')).records || [];
      const prop = (q.property ? props.find(r => r.id === q.property) : null) || props[0];
      const pf = (prop && prop.fields) || {};
      const propertyName = pf['Sender Name'] || pf['Name'] || 'Your host';
      const archeFull = q.archetype || 'The Growth Seeker';
      const code = archetypeCode(archeFull);
      const af = arche[String(archeFull).trim().toLowerCase()] || {};

      const arrival = q.arrival || iso(new Date(Date.now() + 120 * 86400000));
      const departure = q.departure || iso(new Date(new Date(arrival + 'T12:00:00Z').getTime() + 4 * 86400000));
      const pretty = v => { const d = new Date(v + 'T12:00:00Z');
        return isNaN(d) ? '' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }); };
      const mOf = v => new Date(v + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
      const sOf = v => { const m = new Date(v + 'T12:00:00Z').getUTCMonth();
        return (m >= 2 && m <= 4) ? 'spring' : (m >= 5 && m <= 7) ? 'summer' : (m >= 8 && m <= 10) ? 'fall' : 'winter'; };
      const daysOut = Math.max(0, Math.round((new Date(arrival + 'T12:00:00Z') - new Date()) / 86400000));

      const sample = {
        first_name: q.first_name || 'Clara', full_name: (q.first_name || 'Clara') + ' Nilsen',
        property: propertyName, tagline: pf['Tagline'] || '',
        property_city: pf['City'] || '', property_state: pf['State/Region'] || '',
        property_website: pf['Website'] || '', getting_here: pf['Getting Here'] || '',
        arrival, departure, arrival_pretty: pretty(arrival), departure_pretty: pretty(departure),
        month: mOf(arrival), season: sOf(arrival),
        nights: String(Math.round((new Date(departure) - new Date(arrival)) / 86400000)),
        days_until: String(daysOut), weeks_until: String(Math.max(1, Math.round(daysOut / 7))),
        archetype: String(archeFull).replace(/^The /, ''),
        archetype_guidance: af['Traveler Guidance'] || '',
        archetype_priorities: af['Personal Priorities'] || '',
        archetype_description: af['Description'] || '',
        trip_url: 'https://app.transformedbytravels.com/welcome?t=SAMPLE',
        assessment_url: 'https://app.transformedbytravels.com/Assessment?ref=' + encodeURIComponent('lodge-' + propertyName),
      };

      // Walk the EMAIL ladder only. The stay-day rungs are SMS and carry no tip, so
      // counting them here would restart the tip sequence after checkout and show numbers
      // the real sender would never produce.
      const pool = tips[TIP_ARCHETYPE[code]] || {};
      const rendered = LADDER.filter(key => !/^stay-day-/.test(key) && key !== 'closing').map((key, i) => {
        const codes = codesFor(key);
        const tpl = codes.map(c => templates[c]).find(t => t && String(t['Subject'] || '').trim() &&
          ['Paragraph 1', 'Paragraph 2', 'Paragraph 3'].some(k2 => String(t[k2] || '').trim()));
        if (!tpl) return null;
        const tip = pool[((i % 24)) + 1] || {};
        const sug = suggestionFor(pf, code, key);
        const v = { ...sample, tip: tip['Tip Text'] || '', tip_name: tip['Tip Name'] || '',
                    tip_number: tip['Tip Number'] ? String(tip['Tip Number']) : '',
                    suggestion: sug.body || '', suggestion_title: sug.title || '' };
        const leftover = [...String(tpl['Subject'] + ' ' + ['Paragraph 1','Paragraph 2','Paragraph 3'].map(k2 => tpl[k2] || '').join(' ')).matchAll(/\{\{(\w+)\}\}/g)]
          .map(m => m[1]).filter(t => v[t] == null);
        return {
          message: key, template: codes.find(c => templates[c]) || codes[0],
          subject: fill(tpl['Subject'], v),
          body: ['Paragraph 1', 'Paragraph 2', 'Paragraph 3'].map(k2 => fill(tpl[k2] || '', v)).filter(x => x.trim()),
          tip: tip['Tip Name'] ? `#${tip['Tip Number']} ${tip['Tip Name']}` : '(none)',
          suggestion: sug.title || '(none)',
          ...(leftover.length ? { unknownTokens: [...new Set(leftover)] } : {}),
        };
      }).filter(Boolean);

      return res.status(200).json({
        preview: true, property: propertyName, archetype: archeFull, arrival, departure,
        messages: rendered,
      });
    }

    const mark = (id, fields) => dryRun ? null : at(SCHED, `/${id}`, 'PATCH', { fields });

    for (const row of due) {
      const f = row.fields;
      const key = f['Message Key'] || '';
      const note = (status, why) => {
        out[status === 'Sent' ? 'sent' : status === 'Failed' ? 'failed' : 'skipped']++;
        out.detail.push(`${status.padEnd(8)} ${key.padEnd(14)} ${why}`);
      };

      try {
        const tripId = Array.isArray(f['Trips']) ? f['Trips'][0] : null;
        if (!tripId) { await mark(row.id, { 'Status': 'Skipped', 'Error': 'no trip linked' }); note('Skipped', 'no trip linked'); continue; }

        const trip = await at(TRIPS, `/${tripId}`);
        if (trip.error) { await mark(row.id, { 'Status': 'Failed', 'Error': trip.error.message }); note('Failed', trip.error.message); continue; }

        // A stay cancelled by any route — not only through the reservation pipeline —
        // stops here too. The schedule should never outlive the booking.
        if ((trip.fields['Status of Trip'] || '') === 'Cancelled') {
          await mark(row.id, { 'Status': 'Cancelled', 'Error': 'stay is cancelled' });
          note('Skipped', 'stay cancelled'); continue;
        }

        if (f['Channel'] === 'SMS') {
          await mark(row.id, { 'Status': 'Skipped', 'Error': 'SMS consent not recorded for this guest' });
          note('Skipped', 'SMS held — no consent'); continue;
        }

        // "Exists" is not the same as "written". A placeholder row with no subject and no
        // paragraphs must be treated as missing, or the first run sends blank mail under
        // the property's name — the one failure that costs them rather than us.
        // BOTH a subject and a body, not either. Half-written is the normal state of a
        // template while someone is authoring it, and a subject-only email is worse than
        // no email — it arrives, under the property's name, saying nothing.
        const written = t => t && String(t['Subject'] || '').trim() &&
          ['Paragraph 1', 'Paragraph 2', 'Paragraph 3'].some(k2 => String(t[k2] || '').trim());
        const tpl = codesFor(key).map(c => templates[c]).find(written);
        if (!tpl) {
          const code = codesFor(key)[0];
          const t = templates[code];
          const blank = !t ? `no copy written — add ${code} to the Emails table`
            : !String(t['Subject'] || '').trim() ? `${code} has no Subject yet`
            : `${code} has a Subject but no Paragraph text yet`;
          await mark(row.id, { 'Status': 'Skipped', 'Error': blank });
          note('Skipped', blank); continue;
        }

        const propId = Array.isArray(f['Property']) ? f['Property'][0] : null;
        const prop = propId ? await at(PROPERTY, `/${propId}`) : null;
        const pf = (prop && prop.fields) || {};
        const property = { name: pf['Sender Name'] || pf['Name'] || 'Your host' };

        // A date reads as 2027-06-15 unless something formats it, and no one writes
        // "see you on 2027-06-15" on purpose.
        const pretty = v => { if (!v) return ''; const d = new Date(v + 'T12:00:00Z');
          return isNaN(d) ? '' : d.toLocaleDateString('en-US',
            { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }); };
        const monthOf = v => { if (!v) return ''; const d = new Date(v + 'T12:00:00Z');
          return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }); };
        const seasonOf = v => { if (!v) return ''; const m = new Date(v + 'T12:00:00Z').getUTCMonth();
          return (m >= 2 && m <= 4) ? 'spring' : (m >= 5 && m <= 7) ? 'summer'
               : (m >= 8 && m <= 10) ? 'fall' : 'winter'; };

        const to = (f['Guest Email'] || trip.fields['Traveler Email'] || '').toLowerCase();
        if (!to) { await mark(row.id, { 'Status': 'Skipped', 'Error': 'no guest email' }); note('Skipped', 'no guest email'); continue; }

        const guest = ((await at(TRAVELER,
          `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${esc(to)}"`)}&maxRecords=1`)).records || [])[0];
        const fullName = (guest && guest.fields['Traveler Name']) || '';

        const unsubUrl = `https://app.transformedbytravels.com/api/unsubscribe?email=${encodeURIComponent(to)}`;
        // How far out the stay is, so copy can say "in 6 weeks" without someone having
        // to write a separate template per rung.
        const start = trip.fields['Start Date'];
        const daysOut = start ? Math.max(0, Math.round((new Date(start + 'T12:00:00Z') - new Date()) / 86400000)) : null;
        const weeksOut = daysOut == null ? null : Math.max(1, Math.round(daysOut / 7));
        const stayNights = (trip.fields['Start Date'] && trip.fields['End Date'])
          ? Math.round((new Date(trip.fields['End Date']) - new Date(trip.fields['Start Date'])) / 86400000) : null;

        const vars = {
          first_name: fullName.trim().split(/\s+/)[0] || 'there',
          days_until:  daysOut == null ? '' : String(daysOut),
          weeks_until: weeksOut == null ? '' : String(weeksOut),
          nights:      stayNights == null ? '' : String(stayNights),
          full_name:  fullName,
          property:   property.name,
          arrival:    trip.fields['Start Date'] || '',
          departure:  trip.fields['End Date'] || '',
          archetype:  (trip.fields['Archetype'] || (guest && guest.fields['Archetype']) || '').replace(/^The /, ''),
          trip_url:   trip.fields['Share Token']
            ? `https://app.transformedbytravels.com/welcome?t=${encodeURIComponent(trip.fields['Share Token'])}`
            : '',
          // The welcome email's whole job is to get the assessment taken, so it needs a
          // link straight to it — carrying the trip, so the result lands on THIS stay.
          assessment_url: `https://app.transformedbytravels.com/Assessment?ref=${encodeURIComponent('lodge-' + property.name)}&tripId=${encodeURIComponent(tripId)}`,
          arrival_pretty:   pretty(trip.fields['Start Date']),
          departure_pretty: pretty(trip.fields['End Date']),
          month:            monthOf(trip.fields['Start Date']),
          season:           seasonOf(trip.fields['Start Date']),
          tagline:          pf['Tagline'] || '',
          property_city:    pf['City'] || '',
          property_state:   pf['State/Region'] || '',
          property_website: pf['Website'] || '',
          getting_here:     pf['Getting Here'] || '',
        };

        // "For a Purpose-Driven Traveler like you, you might want to…"
        const archeFull = trip.fields['Archetype'] || (guest && guest.fields['Archetype']) || '';
        const af = arche[String(archeFull).trim().toLowerCase()] || {};
        vars.archetype_guidance    = af['Traveler Guidance'] || '';
        vars.archetype_priorities  = af['Personal Priorities'] || '';
        vars.archetype_description = af['Description'] || '';
        const code = archetypeCode(archeFull);
        const sug = suggestionFor(pf, code, key);
        vars.suggestion       = sug.body || '';
        vars.suggestion_title = sug.title || '';

        // One tip per message, walked in order across the whole relationship. The ordinal
        // is this guest's own position in their own plan — not a position in the full
        // ladder — so someone who books ten days out starts at tip 1 like everyone else
        // rather than being dropped in at tip 16.
        const mine = (await rowsForTrip(tripId, to))
          .filter(r => r.fields['Channel'] === 'Email' && r.fields['Send Date'])
          .sort((a, b) => String(a.fields['Send Date']).localeCompare(String(b.fields['Send Date']))
                       || ladderPos(a.fields['Message Key']) - ladderPos(b.fields['Message Key']));
        const ordinal = Math.max(1, mine.findIndex(r => r.id === row.id) + 1);
        const pool = tips[TIP_ARCHETYPE[code]] || {};
        const tip = pool[((ordinal - 1) % 24) + 1] || {};
        vars.tip        = tip['Tip Text'] || '';
        vars.tip_name   = tip['Tip Name'] || '';
        vars.tip_number = tip['Tip Number'] ? String(tip['Tip Number']) : '';

        const html = buildHtml({
          subject: tpl['Subject'] || property.name,
          paragraphs: [tpl['Paragraph 1'], tpl['Paragraph 2'], tpl['Paragraph 3']],
          property, vars, unsubUrl,
        });

        if (dryRun) {
          // ?dry=1&full=1 renders the message as the guest would read it. Checking that
          // the tokens resolved is most of the job of writing copy, and a subject line
          // alone does not tell you whether the tip or the suggestion landed.
          if (String((req.query || {}).full || '') === '1') {
            out.preview = out.preview || [];
            out.preview.push({
              key, to, sendDate: f['Send Date'],
              subject: fill(tpl['Subject'] || '', vars),
              body: ['Paragraph 1', 'Paragraph 2', 'Paragraph 3']
                .map(k2 => fill(tpl[k2] || '', vars)).filter(x => x.trim()),
              tip: vars.tip_name ? `#${vars.tip_number} ${vars.tip_name}` : '(none)',
              suggestion: vars.suggestion_title || '(none)',
            });
          }
          note('Sent', `would send "${fill(tpl['Subject'], vars)}" to ${to}`); continue;
        }

        await sendEmail({
          to,
          // Display name is the property, address is ours — all of the brand, none of the
          // per-property DNS work. Replies go to the lodge, which is what matters.
          from: `${property.name.replace(/[<>"]/g, '')} <stays@${SENDING_DOMAIN}>`,
          replyTo: pf['Reply-To Email'] || pf['Contact Email'] || '',
          subject: fill(tpl['Subject'] || property.name, vars),
          html, unsubUrl,
        });
        await mark(row.id, { 'Status': 'Sent', 'Sent At': new Date().toISOString(), 'Error': '' });
        note('Sent', `${to} · ${fill(tpl['Subject'], vars)}`);
      } catch (e) {
        await mark(row.id, { 'Status': 'Failed', 'Error': e.message });
        note('Failed', e.message);
      }
    }

    return res.status(200).json(out);
  } catch (e) {
    console.error('[send-scheduled]', e.message);
    return res.status(500).json({ error: e.message, ...out });
  }
};

module.exports.config = { maxDuration: 300 };
