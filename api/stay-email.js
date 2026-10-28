// api/stay-email.js — a property's reservation email becomes a stay.
//
// This is the OPPOSITE direction from parse-email.js. There, a guest forwards their own
// booking into a trip they already own, and the Traveler must already exist. Here the
// PROPERTY forwards a guest's reservation, and the guest usually does not exist yet.
// Two different senders, two different preconditions, two different failure modes — so
// they stay two endpoints rather than one with a mode flag.
//
// Three transactions, mirroring what the property's PMS already decided:
//   create  → Traveler (if new) + Trip, linked to the Property
//   change  → PATCH dates / name on the matched Trip, prior values recorded
//   cancel  → Status of Trip = Cancelled.  NEVER deletes a record.
//
// We are deliberately NOT the system of record. We store the property's own confirmation
// number as the join key and never mint our own, so their PMS stays authoritative and we
// can always be re-synced from it.
//
// POST  — Postmark inbound webhook
// GET ?action=retry&id=recXXX — re-run one logged transaction after fixing the data

const BASE_ID     = 'appdlxcWb45dIqNK2';
const TRIPS       = 'Trips';
const TRAVELER    = 'Traveler';
const PROPERTY    = 'Property';
const STAY_TX     = 'Stay Transactions';

const { syncSchedule, cancelSchedule } = require('./_schedule-store.js');

// Sonnet rather than Opus: this is bounded extraction, not reasoning, and Postmark gives
// an inbound webhook ~10s before it retries. Accuracy here comes from the forced tool
// schema below, not from model size.
const MODEL = 'claude-sonnet-5';

// Auto-apply unambiguous transactions; queue only genuine ambiguity. Holding every change
// for human approval would make us a second source of truth that drifts from the PMS,
// which is exactly what we are trying not to be. Flip to true to review everything.
const REVIEW_EVERYTHING = false;

// ── Airtable ─────────────────────────────────────────────────────────────────
async function at(table, path = '', method = 'GET', body = null) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`, {
    method,
    headers: {
      Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const esc = s => String(s == null ? '' : s).replace(/"/g, '\\"');          // Airtable formula literals
// Separate escaper for the notification email. These two were conflated, which both ate
// the "<property>" placeholder and left the email's own subject line — written by whoever
// sent it — injectable into mail we send to a property.
const h = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function sendEmail(to, subject, html) {
  if (!to) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'stays@transformedbytravels.com', to, subject, html }),
    });
  } catch (e) { console.error('[stay-email] resend:', e.message); }
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

const addrOf = s => {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '')).toLowerCase().trim();
};

const nights = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / 86400000) : null);

// Dates the model is confident about can still be nonsense. A bare day-of-month in a
// change email ("out on the 24th instead of the 23rd") gets resolved against today, so a
// November stay comes back ending in October. No prompt reliably prevents that; a check
// on the resulting stay does. Anything that fails here is parked, never written.
function dateProblem(arrival, departure) {
  if (!arrival) return null;
  const a = new Date(arrival + 'T00:00:00');
  if (isNaN(a)) return `Arrival "${arrival}" is not a readable date.`;
  if (departure) {
    const d = new Date(departure + 'T00:00:00');
    if (isNaN(d)) return `Departure "${departure}" is not a readable date.`;
    if (d <= a) return `Those dates do not make a stay: ${arrival} to ${departure}. A month was probably missing from the email.`;
    if ((d - a) / 86400000 > 120) return `That would be a ${Math.round((d - a) / 86400000)}-night stay — too long to apply without a look.`;
  }
  const yearOut = Math.abs(a - new Date()) / 86400000;
  if (yearOut > 730) return `Arrival ${arrival} is more than two years from today.`;
  return null;
}

// ── Extraction ───────────────────────────────────────────────────────────────
// A forced tool call rather than "return only JSON" — the model cannot answer with prose,
// a fence, or a near-miss shape, which is the failure the older parser handles by regex.
const STAY_SCHEMA = {
  name: 'record_stay_transaction',
  description: 'Record what this property reservation email is asking us to do.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'change', 'cancel', 'unknown'],
        description: 'create = a new booking. change = an existing booking was modified (dates, room, guest count). cancel = an existing booking was cancelled or the guest is a no-show. unknown = this is not a reservation email at all.',
      },
      confidence: { type: 'string', enum: ['high', 'low'], description: 'low if the action is a guess, if dates are inferred rather than stated, or if the email reads like a thread with several bookings in it.' },
      reservation_number: { type: ['string', 'null'], description: "The property's own confirmation / reservation / booking number. Null if not stated." },
      guest_name: { type: ['string', 'null'] },
      guest_email: { type: ['string', 'null'], description: "The GUEST's email address. Never the property's own address, and never the person who forwarded the mail." },
      guest_phone: { type: ['string', 'null'] },
      arrival: { type: ['string', 'null'], description: 'Check-in date, YYYY-MM-DD. For a change, the NEW arrival date.' },
      departure: { type: ['string', 'null'], description: 'Check-out date, YYYY-MM-DD. For a change, the NEW departure date.' },
      party_size: { type: ['number', 'null'] },
      room_type: { type: ['string', 'null'] },
      summary: { type: 'string', description: 'One plain sentence a front-desk manager would recognise, e.g. "Richard Hale moved his stay from 16-20 Oct to 18-22 Oct."' },
      notes: { type: ['string', 'null'], description: 'Anything a host should know: dietary needs, anniversary, late arrival, accessibility. Null if none stated.' },
    },
    required: ['action', 'confidence', 'summary'],
  },
};

async function extract(subject, body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      tools: [STAY_SCHEMA],
      tool_choice: { type: 'tool', name: 'record_stay_transaction' },
      messages: [{
        role: 'user',
        content: `A lodge forwarded this reservation email. Decide whether it creates, changes or cancels a stay, and pull out the details.

Today is ${new Date().toISOString().split('T')[0]}. Resolve any relative date against that.
If the email quotes an earlier message, the NEWEST booking state is the one that counts.

Subject: ${subject}

${body}`,
      }],
    }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || 'extraction failed');
  const use = (d.content || []).find(c => c.type === 'tool_use');
  if (!use) throw new Error('model did not return a transaction');
  return use.input;
}

// ── Which property sent this? ────────────────────────────────────────────────
// Order matters. The plus-address is the only signal that survives a staff member
// forwarding from their personal mailbox, so it wins. We never guess: an unresolved
// property is parked for review rather than attached to whoever looks closest.
async function resolveProperty(toAddrs, fromEmail) {
  const slug = (toAddrs.map(a => (a.match(/\+([^@]+)@/) || [])[1]).find(Boolean) || '').toLowerCase();
  const domainOf = e => String(e || '').split('@')[1] || '';
  const fromDomain = domainOf(fromEmail);
  const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Fetch whole records rather than naming fields: asking Airtable for a field that does
  // not exist yet is a hard error, and Allowed Senders may not have been created. Absent,
  // it simply reads as empty and the sender falls through to the checks below.
  const all = (await at(PROPERTY, '?pageSize=100')).records || [];
  const shape = (r, how, trusted) => ({ id: r.id, name: r.fields['Name'], how, trusted });

  // 1. The property's own contact address — identifies it AND vouches for the sender.
  const byContact = all.find(r => String(r.fields['Contact Email'] || '').toLowerCase().trim() === fromEmail);
  if (byContact) return shape(byContact, 'contact email', true);

  // 2. Staff forward from their own mailbox constantly. Follow the Traveler → Property link.
  const staff = ((await at(TRAVELER,
    `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${esc(fromEmail)}"`)}&maxRecords=1`)).records || [])[0];
  const link = staff && (staff.fields['Property'] || staff.fields['Properties 2']);
  if (Array.isArray(link) && link[0]) {
    const hit = all.find(r => r.id === link[0]);
    if (hit) return shape(hit, 'staff link', true);
  }

  // 3. Allowed Senders. A property's reservations almost never come FROM the property —
  // the PMS or the OTA sends them, so the From is cloudbeds.com or booking.com. The
  // property names those systems once, here, and we trust them on its behalf. An entry
  // is either a full address or a bare domain.
  const senderAllowed = f => {
    const raw = String(f['Allowed Senders'] || '');
    return raw.split(/[,\n;]/).map(x => x.trim().toLowerCase()).filter(Boolean).some(entry =>
      entry.includes('@') ? entry === fromEmail
                          : (fromDomain === entry || fromDomain.endsWith('.' + entry)));
  };
  const byAllowed = all.filter(r => senderAllowed(r.fields));
  // If two properties claim the same sender we cannot tell them apart — unless the
  // plus-address says which, in which case it breaks the tie.
  if (byAllowed.length === 1) return shape(byAllowed[0], 'allowed sender', true);
  if (byAllowed.length > 1 && slug) {
    const tie = byAllowed.find(r => norm(r.fields['Name']).startsWith(norm(slug)) || norm(slug).startsWith(norm(r.fields['Name'])));
    if (tie) return shape(tie, 'allowed sender + plus-address', true);
  }

  // 4. A plus-address only ROUTES. It is printed on every forwarded confirmation a guest
  // ever sees, so treating it as proof of identity would let anyone who read one create —
  // or cancel — a stay. It names the property; the sender still has to vouch for itself.
  if (slug) {
    const hit = all.find(r => norm(r.fields['Name']).startsWith(norm(slug)) || norm(slug).startsWith(norm(r.fields['Name'])));
    if (hit) {
      const site = String(hit.fields['Website'] || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
      const known = [domainOf(hit.fields['Contact Email']).toLowerCase(), site].filter(Boolean);
      const sameDomain = !!fromDomain && known.some(d => fromDomain === d || fromDomain.endsWith('.' + d));
      return shape(hit, sameDomain ? 'plus-address + domain' : 'plus-address only', sameDomain);
    }
  }
  return null;
}

// ── Find the stay a change/cancel refers to ──────────────────────────────────
async function findStay(propertyId, s) {
  const mine = t => Array.isArray(t.fields['Property']) && t.fields['Property'].includes(propertyId);

  // 1. The property's own number. This is the whole point of storing it.
  if (s.reservation_number) {
    const byNum = ((await at(TRIPS,
      `?filterByFormula=${encodeURIComponent(`{Reservation Number}="${esc(s.reservation_number)}"`)}`)).records || []).filter(mine);
    if (byNum.length === 1) return { trip: byNum[0], how: 'reservation number' };
    if (byNum.length > 1) return { ambiguous: byNum, how: 'reservation number' };
  }

  // 2. Guest email at this property, nearest arrival date.
  if (s.guest_email) {
    const byEmail = ((await at(TRIPS,
      `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${esc(String(s.guest_email).toLowerCase())}"`)}`)).records || [])
      .filter(mine)
      .filter(t => (t.fields['Status of Trip'] || '') !== 'Cancelled');
    if (byEmail.length === 1) return { trip: byEmail[0], how: 'guest email' };
    if (byEmail.length > 1) {
      if (s.arrival) {
        const near = byEmail.slice().sort((a, b) =>
          Math.abs(new Date(a.fields['Start Date']) - new Date(s.arrival)) -
          Math.abs(new Date(b.fields['Start Date']) - new Date(s.arrival)))[0];
        return { trip: near, how: 'guest email + nearest arrival' };
      }
      return { ambiguous: byEmail, how: 'guest email' };
    }
  }
  return null;
}

// ── Apply ────────────────────────────────────────────────────────────────────
async function applyTransaction(prop, s, meta) {
  const log = { action: s.action, propertyId: prop.id };

  if (s.action === 'create') {
    if (!s.guest_email) return { ...log, status: 'Needs Review', issue: 'No guest email in the reservation — nothing to send the welcome link to.' };
    if (!s.arrival)     return { ...log, status: 'Needs Review', issue: 'No arrival date could be read from the email.' };
    const bad = dateProblem(s.arrival, s.departure);
    if (bad) return { ...log, status: 'Needs Review', issue: bad };

    // A create for a number we already hold is a re-send, not a second booking.
    if (s.reservation_number) {
      const dupe = await findStay(prop.id, { reservation_number: s.reservation_number });
      if (dupe && dupe.trip) {
        return { ...log, status: 'Duplicate', tripId: dupe.trip.id,
                 issue: `Reservation ${s.reservation_number} already exists as a stay.` };
      }
    }

    const email = String(s.guest_email).toLowerCase().trim();
    let traveler = ((await at(TRAVELER,
      `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${esc(email)}"`)}&maxRecords=1`)).records || [])[0];
    let createdGuest = false;
    if (!traveler) {
      const made = await at(TRAVELER, '', 'POST', { records: [{ fields: {
        'Traveler Email': email,
        'Traveler Name': s.guest_name || '',
        ...(s.guest_phone ? { 'Phone Number': String(s.guest_phone) } : {}),
      } }] });
      if (made.error) return { ...log, status: 'Failed', issue: 'Could not create guest: ' + made.error.message };
      traveler = made.records[0];
      createdGuest = true;
    }

    const token = Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
    const made = await at(TRIPS, '', 'POST', { records: [{ fields: {
      'Traveler Email': email,
      'Trip Name': `${s.guest_name || 'Stay'} at ${prop.name}`,
      'Destination': prop.name,
      'Start Date': s.arrival,
      ...(s.departure ? { 'End Date': s.departure } : {}),
      'Status of Trip': 'Committed',
      'Property': [prop.id],
      'Share Token': token,
      ...(s.reservation_number ? { 'Reservation Number': String(s.reservation_number) } : {}),
      ...(s.notes ? { 'Notes': s.notes } : {}),
    } }] });
    if (made.error) return { ...log, status: 'Failed', issue: 'Could not create stay: ' + made.error.message };

    const tripId = made.records[0].id;
    const plan = await syncSchedule({ tripId, propertyId: prop.id, guestEmail: email,
                                      guestName: s.guest_name, arrival: s.arrival, departure: s.departure });
    return { ...log, status: 'Applied', tripId, token,
             changes: `New stay · ${s.arrival}${s.departure ? ' → ' + s.departure : ''}`
                    + `${createdGuest ? ' · guest record created' : ' · existing guest'}`
                    + `${plan && plan.scheduled ? ' · ' + plan.scheduled + ' messages scheduled' : ''}` };
  }

  // change / cancel both need an existing stay
  const found = await findStay(prop.id, s);
  if (!found) {
    return { ...log, status: 'Needs Review',
             issue: `No stay at ${prop.name} matches ${s.reservation_number ? 'reservation ' + s.reservation_number : s.guest_email || s.guest_name || 'this guest'}.` };
  }
  if (found.ambiguous) {
    return { ...log, status: 'Needs Review',
             issue: `${found.ambiguous.length} stays match on ${found.how} — cannot tell which one this refers to.` };
  }
  const trip = found.trip;
  const tf = trip.fields;

  if (s.action === 'cancel') {
    if ((tf['Status of Trip'] || '') === 'Cancelled') {
      return { ...log, status: 'Duplicate', tripId: trip.id, issue: 'That stay was already cancelled.' };
    }
    // Status only. The guest's journal, archetype and assessment all survive a cancellation —
    // they booked again at the same lodge last time, and that history is the point.
    const upd = await at(TRIPS, `/${trip.id}`, 'PATCH', { fields: { 'Status of Trip': 'Cancelled' } });
    if (upd.error) return { ...log, status: 'Failed', tripId: trip.id, issue: upd.error.message };
    const stopped = await cancelSchedule(trip.id, (tf['Traveler Email'] || '').toLowerCase());
    return { ...log, status: 'Applied', tripId: trip.id,
             changes: `Status: ${tf['Status of Trip'] || '(none)'} → Cancelled (matched on ${found.how})`
                    + `${stopped && stopped.cancelled ? `\n${stopped.cancelled} pending messages cancelled` : ''}` };
  }

  // change
  const fields = {}, diff = [];
  const set = (name, next) => {
    if (!next) return;
    const prev = tf[name] || '';
    if (String(prev) === String(next)) return;
    fields[name] = next;
    diff.push(`${name}: ${prev || '(empty)'} → ${next}`);
  };
  set('Start Date', s.arrival);
  set('End Date', s.departure);
  if (s.reservation_number) set('Reservation Number', String(s.reservation_number));
  if (s.notes && s.notes !== tf['Notes']) { fields['Notes'] = s.notes; diff.push('Notes updated'); }
  // A cancelled stay that gets changed is a reinstatement — say so rather than silently reviving it.
  if ((tf['Status of Trip'] || '') === 'Cancelled') {
    fields['Status of Trip'] = 'Committed';
    diff.push('Status: Cancelled → Committed (reinstated)');
  }

  if (!diff.length) {
    return { ...log, status: 'Duplicate', tripId: trip.id, issue: 'Nothing in that stay actually changed.' };
  }
  // Validate the stay as it would end up, not just the values that arrived — a change
  // that only moves the departure still has to make sense against the existing arrival.
  const badAfter = dateProblem(fields['Start Date'] || tf['Start Date'], fields['End Date'] || tf['End Date']);
  if (badAfter) {
    return { ...log, status: 'Needs Review', tripId: trip.id,
             issue: `${badAfter} Nothing was changed — the stay still reads ${tf['Start Date']} to ${tf['End Date'] || '(open)'}.` };
  }
  const upd = await at(TRIPS, `/${trip.id}`, 'PATCH', { fields });
  if (upd.error) return { ...log, status: 'Failed', tripId: trip.id, issue: upd.error.message };

  // Dates moving invalidates every unsent message. Rebuild rather than let a guest get
  // "14 days out" a week after they got home.
  let note = '';
  if (fields['Start Date'] || fields['End Date']) {
    const plan = await syncSchedule({
      tripId: trip.id, propertyId: prop.id,
      guestEmail: (tf['Traveler Email'] || '').toLowerCase(), guestName: s.guest_name,
      arrival: fields['Start Date'] || tf['Start Date'],
      departure: fields['End Date'] || tf['End Date'],
    });
    if (plan && plan.scheduled) note = `\nSchedule rebuilt: ${plan.scheduled} messages (${plan.kept} already sent, kept)`;
  }
  return { ...log, status: 'Applied', tripId: trip.id,
           changes: diff.join('\n') + `\n(matched on ${found.how})` + note };
}

// ── Log + notify ─────────────────────────────────────────────────────────────
async function writeLog(fields) {
  const f = { ...fields };
  for (let i = 0; i < 25; i++) {
    const r = await at(STAY_TX, '', 'POST', { records: [{ fields: f }] });
    if (!r.error) return r.records && r.records[0];
    // Two shapes of schema drift, both fatal to the whole row if left alone:
    //   Unknown field name: "Nights"            — the field was never created
    //   Field "Received At" cannot accept ...   — it exists with the wrong type
    // Drop the offender and keep the rest. An audit row missing one column is worth far
    // more than no audit row, which is what we had: every write failed on a date field
    // that had been created without a time component.
    const msg = r.error.message || '';
    const miss = msg.match(/Unknown field name: ?"?([^"]+)"?/) || msg.match(/Field "([^"]+)" cannot accept/);
    if (!miss || !(miss[1] in f)) {
      console.error('[stay-email] log write failed:', msg);
      return null;
    }
    console.warn('[stay-email] dropping field the base will not take:', miss[1], '—', msg.slice(0, 80));
    delete f[miss[1]];
  }
  return null;
}

async function notify(prop, result, s, meta) {
  // Applied transactions are not news — the property already knows, their PMS told them.
  // Only the ones needing a human get an email, or the notification becomes noise and
  // stops being read at exactly the moment it matters.
  if (result.status !== 'Needs Review' && result.status !== 'Failed') return;
  const admin = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)[0];
  const to = [prop && prop.contactEmail, admin].filter(Boolean).join(',');
  const html = `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px">
  <p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#8d9ca3;margin:0 0 6px">Transformed by Travels</p>
  <h2 style="font-family:Georgia,serif;font-size:19px;margin:0 0 14px;color:#18242c">A reservation email needs a look</h2>
  <p style="color:#5a6b74;line-height:1.6;margin:0 0 16px">${h(result.issue || 'Could not be applied automatically.')}</p>
  <table style="font-size:14px;color:#18242c;border-collapse:collapse">
    <tr><td style="padding:3px 14px 3px 0;color:#8d9ca3">Property</td><td>${h(prop ? prop.name : 'not identified')}</td></tr>
    <tr><td style="padding:3px 14px 3px 0;color:#8d9ca3">Action</td><td>${h(s.action || '—')}</td></tr>
    <tr><td style="padding:3px 14px 3px 0;color:#8d9ca3">Guest</td><td>${h(s.guest_name || s.guest_email || '—')}</td></tr>
    <tr><td style="padding:3px 14px 3px 0;color:#8d9ca3">Reservation</td><td>${h(s.reservation_number || '—')}</td></tr>
    <tr><td style="padding:3px 14px 3px 0;color:#8d9ca3">Subject</td><td>${h((meta.subject || '').slice(0, 90))}</td></tr>
  </table>
  <p style="margin:22px 0 0"><a href="https://app.transformedbytravels.com/stays.html" style="background:#2a7f73;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px;display:inline-block">Open the transaction log →</a></p>
  <p style="color:#8d9ca3;font-size:12px;line-height:1.6;margin:20px 0 0">Nothing was changed in your booking system. Transformed by Travels only mirrors what your reservations send us.</p>
</div>`;
  await sendEmail(to, 'Reservation needs review · ' + (prop ? prop.name : 'unidentified property'), html);
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const p = req.body || {};
  const fromEmail = addrOf(p.FromFull && p.FromFull.Email ? p.FromFull.Email : p.From);
  const toAddrs = []
    .concat(Array.isArray(p.ToFull) ? p.ToFull.map(t => t.Email) : [])
    .concat(String(p.To || '').split(','))
    .concat(String(p.OriginalRecipient || ''))
    .map(addrOf).filter(Boolean);
  const subject = p.Subject || '';
  const messageId = String(p.MessageID || p.MessageId || '').trim();
  const text = p.TextBody || '';
  const html = stripHtml(p.HtmlBody || '');
  const body = (html.length > text.length ? html : text).slice(0, 12000);

  // Always 200 to Postmark. A 4xx/5xx makes it retry for 45 minutes, and a message we
  // genuinely cannot use will never get better on the second attempt.
  const ok = (note, extra = {}) => res.status(200).json({ ok: true, note, ...extra });

  try {
    if (!body) return ok('empty body');

    // Idempotency. Postmark retries on timeout, and staff forward the same mail twice —
    // both must be no-ops, not a second stay.
    if (messageId) {
      const seen = await at(STAY_TX,
        `?filterByFormula=${encodeURIComponent(`{Message ID}="${esc(messageId)}"`)}&maxRecords=1`);
      if ((seen.records || []).length) return ok('already processed', { messageId });
    }

    const prop = await resolveProperty(toAddrs, fromEmail);
    let s;
    try {
      s = await extract(subject, body);
    } catch (e) {
      await writeLog({
        'Received At': new Date().toISOString(), 'Message ID': messageId, 'From Email': fromEmail,
        'Subject': subject, 'Summary': 'Could not read this email', 'Issue': e.message,
        'Raw Email': body.slice(0, 90000),
      });
      return ok('extraction failed: ' + e.message);
    }

    let result;
    if (!prop) {
      result = { status: 'Needs Review', action: s.action,
                 issue: `Could not tell which property sent this. Add ${fromEmail} as a property Contact Email, or have them send to stays+<property>@transformedbytravels.com.` };
    } else if (!prop.trusted) {
      // Identified the property but not the sender. Park it — a forged cancel would take
      // a real guest's stay off the board, and that is not recoverable by an apology.
      result = { status: 'Needs Review', action: s.action,
                 issue: `${fromEmail} is not a recognised sender for ${prop.name}. If that is their booking system, add it to Allowed Senders on the ${prop.name} record and forward this again.` };
    } else if (s.action === 'unknown') {
      result = { status: 'Needs Review', action: 'unknown', issue: 'This does not read as a reservation email.' };
    } else if (s.confidence === 'low' || REVIEW_EVERYTHING) {
      result = { status: 'Needs Review', action: s.action,
                 issue: 'Read with low confidence — dates or the action were inferred rather than stated.' };
    } else {
      // Property contact address, for the notification
      const full = await at(PROPERTY, `/${prop.id}`);
      prop.contactEmail = (full.fields && full.fields['Contact Email']) || '';
      result = await applyTransaction(prop, s, { subject });
    }

    const rec = await writeLog({
      'Received At': new Date().toISOString(),
      'Message ID': messageId,
      'From Email': fromEmail,
      'Subject': subject,
      'Guest Name': s.guest_name || '',
      'Guest Email': s.guest_email || '',
      'Reservation Number': s.reservation_number || '',
      ...(s.arrival ? { 'Arrival': s.arrival } : {}),
      ...(s.departure ? { 'Departure': s.departure } : {}),
      ...(nights(s.arrival, s.departure) != null ? { 'Nights': nights(s.arrival, s.departure) } : {}),
      'Name': (s.summary || '').slice(0, 250),
      'Changes': result.changes || '',
      'Issue': result.issue || '',
      'Action': { create: 'Create', change: 'Change', cancel: 'Cancel' }[s.action] || 'Unknown',
      'Status': result.status,
      ...(prop ? { 'Property': [prop.id] } : {}),
      ...(result.tripId ? { 'Trips': [result.tripId] } : {}),
      'Parsed Data': JSON.stringify(s, null, 2),
      'Raw Email': body.slice(0, 90000),
    });

    await notify(prop, result, s, { subject });
    return ok(result.status, { action: s.action, tripId: result.tripId || null, logId: rec && rec.id });
  } catch (e) {
    console.error('[stay-email] FATAL', e.message);
    return ok('error: ' + e.message);
  }
};

module.exports.config = { maxDuration: 60 };

// Exposed for local verification against sample emails.
module.exports.__internals = { extract, resolveProperty, findStay, applyTransaction };
