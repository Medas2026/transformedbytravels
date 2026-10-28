#!/usr/bin/env node
// Regression suite for api/stay-email.js — the create / change / cancel reservation path.
//
//   node scripts/test-stay-email.js --parse      extraction only, writes nothing
//   node scripts/test-stay-email.js --run        full end-to-end against Airtable
//   node scripts/test-stay-email.js --cleanup    delete everything the suite created
//
// Everything runs against a throwaway property so the Wild Rice and Northgate demo data
// is never touched. --cleanup removes the property, its stays, its guests and its log
// rows; run it before showing the dashboard to anyone.

// No dotenv in this project — read .env.local directly, quotes and all.
(() => {
  const fs = require('fs'), path = require('path');
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
})();

const handler = require('../api/stay-email.js');
const { extract } = handler.__internals;

const BASE_ID = 'appdlxcWb45dIqNK2';
const TEST_PROPERTY = 'ZZ Test Lodge (delete me)';
const TEST_CONTACT = 'test-lodge@transformedbytravels.com';

async function at(table, path = '', method = 'GET', body = null) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Shapes drawn from how different systems actually write: a PMS table, a plain-text
// confirmation from a small lodge, an OTA with a masked guest address, and the messy
// human forwards that are the real failure mode.
const RES_A = 'ZZ-10041';
const RES_B = 'ZZ-10042';
const RES_C = 'BK-7781203';

const F = [
  { id: 'create-pms', expect: { action: 'Create', status: 'Applied' },
    subject: `Reservation Confirmed — ${RES_A}`, body: `
ZZ Test Lodge — Reservation Confirmation

Confirmation #        ${RES_A}
Guest                 Eleanor Vance
Email                 eleanor.vance@example.com
Phone                 (715) 555-0188
Check-in              Monday, November 9, 2026
Check-out             Friday, November 13, 2026
Accommodation         Lakeside Suite · 2 adults
Rate                  $412.00 / night
Special requests      Gluten-free throughout. Quiet room if possible.` },

  { id: 'create-plaintext', expect: { action: 'Create', status: 'Applied' },
    subject: 'new booking - Okafor', body: `
Hi all - taking a booking over the phone just now.

Daniel Okafor, dokafor@example.com, 612-555-0133.
Coming in Nov 20 out Nov 23. Two of them. Booking number ${RES_B}.
He asked about the sauna hours.

Thanks
Jen` },

  { id: 'create-ota-masked', expect: { action: 'Create', status: 'Applied' },
    subject: `New booking from Booking.com — ${RES_C}`, body: `
You have a new reservation.

Reservation number: ${RES_C}
Guest name: Priya Raman
Guest email: ${RES_C.toLowerCase()}@guest.booking.com
Check-in: 2026-11-27
Check-out: 2026-11-30
Guests: 2 adults
Room: Forest Cabin` },

  { id: 'create-no-guest-email', expect: { action: 'Create', status: 'Needs Review' },
    subject: 'Booking - Lindqvist', body: `
Walk-in booking taken at the desk.
Guest: Astrid Lindqvist. Arriving Dec 3, leaving Dec 6. One guest, Garden Room.
No email on file - she'll call with it.
Confirmation ZZ-10055` },

  { id: 'change-dates', expect: { action: 'Change', status: 'Applied' },
    subject: `MODIFIED — ${RES_A}`, body: `
ZZ Test Lodge — Reservation Modified

Confirmation #  ${RES_A}
Guest           Eleanor Vance

  Was:  Nov 9 - Nov 13, 2026
  Now:  Nov 11 - Nov 16, 2026

Accommodation unchanged (Lakeside Suite).` },

  // "out on the 24th" with no month — the model resolves it against today and produces a
  // stay that ends before it starts. Must be caught, not written.
  { id: 'change-bare-day-of-month', expect: { action: 'Change', status: 'Needs Review' },
    subject: `Re: new booking - Okafor`, body: `
Daniel called back, wants to stay one more night - so out on the 24th
instead of the 23rd. Booking ${RES_B}. Everything else the same.` },

  { id: 'cancel-guest', expect: { action: 'Cancel', status: 'Applied' },
    subject: `CANCELLED — ${RES_C}`, body: `
Reservation ${RES_C} (Priya Raman, Nov 27-30) has been cancelled by the guest
through Booking.com. No charge applies under the flexible rate.` },

  { id: 'cancel-already-cancelled', expect: { action: 'Cancel', status: 'Duplicate' },
    subject: `Fwd: CANCELLED — ${RES_C}`, body: `
Resending in case the first didn't come through.
Reservation ${RES_C} (Priya Raman, Nov 27-30) cancelled by guest.` },

  { id: 'duplicate-create', expect: { action: 'Create', status: 'Duplicate' },
    subject: `Fwd: Reservation Confirmed — ${RES_A}`, body: `
Forwarding again, not sure the first one went.

Confirmation #  ${RES_A}
Guest           Eleanor Vance
Email           eleanor.vance@example.com
Check-in        November 9, 2026
Check-out       November 13, 2026` },

  { id: 'cancel-unknown-reservation', expect: { action: 'Cancel', status: 'Needs Review' },
    subject: 'Cancellation ZZ-99999', body: `
Reservation ZZ-99999 for Marcus Webb (Jan 4-8) has been cancelled.` },

  { id: 'not-a-reservation', expect: { action: 'Unknown', status: 'Needs Review' },
    subject: 'November newsletter is out', body: `
Hi team - the November newsletter went out this morning to 2,400 subscribers.
Open rate looks healthy so far. Let me know if you want the numbers broken down.` },

  { id: 'ambiguous-thread', expect: { status: 'Needs Review' },
    subject: 'Fwd: Re: Fwd: this week', body: `
> think Vance moved again? and someone needs to call the Okafor party back
> also the Dolans want to add a night
ok will sort tomorrow` },

  { id: 'unknown-sender', from: 'random.person@nowhere-at-all.example', expect: { status: 'Needs Review' },
    subject: 'Booking for next week', body: `
Hello, I'd like to book a room for two people, arriving November 14 and
leaving November 17. My name is Tomas Reyes, tomas@example.com.` },

  // A stranger who has seen a forwarded confirmation knows the plus-address. Knowing it
  // must not be enough to cancel a real guest's stay.
  { id: 'forged-cancel-via-plus-address', from: 'mischief@nowhere-at-all.example', plus: true,
    expect: { action: 'Cancel', status: 'Needs Review' },
    subject: `Cancellation — ${RES_A}`, body: `
Please cancel reservation ${RES_A} for Eleanor Vance, Nov 11-16. Thanks.` },
];

// ── Harness ──────────────────────────────────────────────────────────────────
const mkres = () => ({ _code: 200, setHeader() {}, status(c) { this._code = c; return this; },
                       json(b) { this.body = b; return this; }, end() { return this; } });

function payload(f, i, propertyUsesPlusAddress) {
  const from = f.from || TEST_CONTACT;
  const usePlus = f.plus || propertyUsesPlusAddress;
  const to = usePlus ? 'stays+zztestlodge@transformedbytravels.com' : 'stays@transformedbytravels.com';
  return {
    From: from, FromFull: { Email: from },
    To: to, ToFull: [{ Email: to }],
    Subject: f.subject,
    TextBody: f.body,
    MessageID: `zz-test-${f.id}-${i}`,
    OriginalRecipient: to,
  };
}

async function ensureProperty() {
  const found = ((await at('Property',
    `?filterByFormula=${encodeURIComponent(`{Name}="${TEST_PROPERTY}"`)}&maxRecords=1`)).records || [])[0];
  if (found) return found.id;
  const made = await at('Property', '', 'POST', { records: [{ fields: {
    'Name': TEST_PROPERTY, 'Contact Email': TEST_CONTACT,
    'Tagline': 'Throwaway property for the reservation test suite',
  } }] });
  if (made.error) throw new Error('could not create test property: ' + made.error.message);
  console.log('  created test property', made.records[0].id);
  return made.records[0].id;
}

async function cleanup() {
  const prop = ((await at('Property',
    `?filterByFormula=${encodeURIComponent(`{Name}="${TEST_PROPERTY}"`)}&maxRecords=1`)).records || [])[0];
  let n = 0;
  const del = async (table, ids) => {
    for (let i = 0; i < ids.length; i += 10) {
      const q = ids.slice(i, i + 10).map(id => 'records[]=' + id).join('&');
      await at(table, '?' + q, 'DELETE');
      n += Math.min(10, ids.length - i);
    }
  };
  // Log rows first — they link to the trips we are about to remove.
  const tx = ((await at('Stay Transactions', '?maxRecords=500')).records || [])
    .filter(r => String(r.fields['Message ID'] || '').startsWith('zz-test-')
              || (prop && Array.isArray(r.fields['Property']) && r.fields['Property'].includes(prop.id)));
  await del('Stay Transactions', tx.map(r => r.id));

  if (prop) {
    const trips = ((await at('Trips', '?maxRecords=500')).records || [])
      .filter(r => Array.isArray(r.fields['Property']) && r.fields['Property'].includes(prop.id));
    await del('Trips', trips.map(r => r.id));
  }
  const guests = ((await at('Traveler',
    `?filterByFormula=${encodeURIComponent('OR(FIND("@example.com",{Traveler Email}),FIND("@guest.booking.com",{Traveler Email}))')}&maxRecords=200`)).records || []);
  await del('Traveler', guests.map(r => r.id));
  if (prop) await del('Property', [prop.id]);
  console.log(`cleaned up ${n} records`);
}

async function run({ parseOnly }) {
  if (!parseOnly) {
    console.log('setup');
    await ensureProperty();
  }
  const results = [];
  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    const t0 = Date.now();
    try {
      if (parseOnly) {
        const s = await extract(f.subject, f.body);
        const action = { create: 'Create', change: 'Change', cancel: 'Cancel', unknown: 'Unknown' }[s.action];
        const okAction = !f.expect.action || action === f.expect.action;
        results.push({ id: f.id, got: `${action}/${s.confidence}`, want: f.expect.action || '—',
                       pass: okAction, ms: Date.now() - t0, note: s.summary });
      } else {
        const res = mkres();
        await handler({ method: 'POST', body: payload(f, i, i % 3 === 0) }, res);
        const b = res.body || {};
        // note is the Status the handler reports back
        const got = b.note || '';
        const okStatus = !f.expect.status || got === f.expect.status;
        const okAction = !f.expect.action || !b.action ||
          ({ create: 'Create', change: 'Change', cancel: 'Cancel', unknown: 'Unknown' }[b.action] === f.expect.action);
        results.push({ id: f.id, got: `${b.action || '—'}/${got}`,
                       want: `${f.expect.action || '—'}/${f.expect.status || '—'}`,
                       pass: okStatus && okAction, ms: Date.now() - t0, note: b.tripId || '' });
      }
    } catch (e) {
      results.push({ id: f.id, got: 'ERROR', want: f.expect.status || '—', pass: false, ms: Date.now() - t0, note: e.message });
    }
  }

  // Idempotency: re-send the first fixture under its original MessageID.
  if (!parseOnly) {
    const res = mkres();
    await handler({ method: 'POST', body: payload(F[0], 0, true) }, res);
    const got = (res.body || {}).note || '';
    results.push({ id: 'idempotent-resend', got, want: 'already processed',
                   pass: got === 'already processed', ms: 0, note: 'same MessageID twice' });
  }

  const w = Math.max(...results.map(r => r.id.length));
  console.log('');
  results.forEach(r => console.log(
    `${r.pass ? ' ok ' : 'FAIL'}  ${r.id.padEnd(w)}  got ${String(r.got).padEnd(26)} want ${String(r.want).padEnd(22)} ${String(r.ms).padStart(5)}ms  ${String(r.note).slice(0, 70)}`));
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (!parseOnly) console.log('\nrun with --cleanup to remove the test property and its records');
  process.exit(failed ? 1 : 0);
}

const arg = process.argv[2] || '--parse';
if (arg === '--cleanup') cleanup().catch(e => { console.error(e.message); process.exit(1); });
else run({ parseOnly: arg === '--parse' }).catch(e => { console.error(e.message); process.exit(1); });
