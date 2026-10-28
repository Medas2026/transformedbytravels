// _schedule.js — turns a stay into the list of messages its guest will receive.
//
// Underscore-prefixed, so Vercel treats it as a module rather than a route.
//
// The whole schedule is computed once, when the stay is created, and written as rows.
// That is deliberate: a property can then SEE what a guest will receive, a date change
// rewrites the pending rows, and a cancellation voids them. An algorithm that only ever
// answers "is today a send day?" can do none of those things.
//
// Cadence (days before arrival), each snapped forward to the next Tuesday:
//   monthly    360 … 120
//   fortnightly 84 … 14
//   then nothing until the day before, which is deliberately quiet — a guest a week out
//   is packing, not reading.
//
// Post-stay tapers rather than running flat: the integration work is dense in the first
// month and reflective after it, and thirteen evenly spaced emails is how you teach
// someone to ignore you.

const MONTHLY_FROM = 360, MONTHLY_TO = 120, MONTHLY_STEP = 30;
const FORTNIGHT_FROM = 84, FORTNIGHT_TO = 14, FORTNIGHT_STEP = 14;
const QUIET_BEFORE_ARRIVAL = 7;          // no scheduled email inside the last week
const POST_STAY = [7, 14, 28, 60, 90, 120, 150, 180];
const GOODBYE_AFTER = 194;   // a fortnight past the last post-stay note

const DAY = 86400000;
const iso = d => new Date(d).toISOString().split('T')[0];
// Accepts a Date or a 'YYYY-MM-DD' string — these functions feed each other, so a
// string-only parse silently produced Invalid Date the moment one was chained.
// Midday UTC, so no timezone can shift a date across a day boundary.
const parse = v => (v instanceof Date ? new Date(v.getTime())
                                      : new Date(String(v).slice(0, 10) + 'T12:00:00Z'));
const addDays = (d, n) => new Date(parse(d).getTime() + n * DAY);

// "First Tuesday on or after" — the anchor Michael wanted, so a guest learns that
// anything from their lodge arrives on a Tuesday.
function nextTuesday(d) {
  const x = parse(d);
  const shift = (2 - x.getUTCDay() + 7) % 7;   // 2 = Tuesday
  return new Date(x.getTime() + shift * DAY);
}

function descending(from, to, step) {
  const out = [];
  for (let d = from; d >= to; d -= step) out.push(d);
  return out;
}

/**
 * @param {object} stay
 *   arrival    'YYYY-MM-DD'  required
 *   departure  'YYYY-MM-DD'  optional
 *   from       'YYYY-MM-DD'  when the stay entered the system (default: today)
 * @returns {Array<{key,phase,channel,date,label,offset}>} ordered by date
 */
function buildSchedule(stay) {
  const arrival = stay.arrival;
  if (!arrival) return [];
  const departure = stay.departure || arrival;
  const from = stay.from || iso(new Date());
  const out = [];

  // 1. Welcome — immediate, and deliberately NOT Tuesday-aligned. It is a reply to an
  //    action the guest just took; holding it for five days to fit a cadence is absurd.
  out.push({ key: 'welcome', phase: 'Welcome', channel: 'Email', date: from,
             label: 'Welcome + take the Travel Styles Assessment', offset: null });

  // 2. Pre-arrival ladder.
  const offsets = [...descending(MONTHLY_FROM, MONTHLY_TO, MONTHLY_STEP),
                   ...descending(FORTNIGHT_FROM, FORTNIGHT_TO, FORTNIGHT_STEP)];
  const lastAllowed = addDays(arrival, -QUIET_BEFORE_ARRIVAL);
  const used = new Set();
  offsets.sort((a, b) => b - a).forEach(offset => {
    const target = addDays(arrival, -offset);
    if (target <= parse(from)) return;                 // already past when the stay was booked
    const send = nextTuesday(target);
    if (send > lastAllowed) return;                    // snapped into the quiet week
    const key = iso(send);
    if (used.has(key)) return;                         // two offsets landing on one Tuesday
    used.add(key);
    out.push({ key: `pre-${offset}`, phase: 'Pre-arrival', channel: 'Email', date: key,
               label: `${offset} days out`, offset });
  });

  // 3. The day before. Not snapped — its whole value is that it lands the night before.
  const kickoff = addDays(arrival, -1);
  if (kickoff > parse(from)) {
    out.push({ key: 'kickoff', phase: 'Kickoff', channel: 'Email', date: iso(kickoff),
               label: 'Tomorrow — what to expect', offset: 1 });
  }

  // 4. In-stay, one per day. SMS, so these stay inert until consent is recorded —
  //    the row exists so the plan is visible, not because we may send it yet.
  for (let d = parse(arrival); d <= parse(departure); d = new Date(d.getTime() + DAY)) {
    const n = Math.round((d - parse(arrival)) / DAY) + 1;
    out.push({ key: `stay-day-${n}`, phase: 'In-Stay', channel: 'SMS', date: iso(d),
               label: `Day ${n} of the stay`, offset: null });
  }

  // 5. Checkout day — the last morning they are still on the property, which is a
  //    different moment from the morning after, when they are already somewhere else.
  out.push({ key: 'checkout', phase: 'In-Stay', channel: 'Email', date: iso(departure),
             label: 'Checking out', offset: null });

  // 6. The morning after.
  out.push({ key: 'closing', phase: 'In-Stay', channel: 'SMS', date: iso(addDays(departure, 1)),
             label: 'The morning after — closing note', offset: null });

  // 7. Post-stay, tapering.
  POST_STAY.forEach(n => {
    out.push({ key: `post-${n}`, phase: 'Post Stay', channel: 'Email',
               date: iso(nextTuesday(addDays(departure, n))),
               label: `${n} days after the stay`, offset: -n });
  });

  // 8. Goodbye — the stream ends deliberately rather than just stopping. A sequence that
  //    trails off leaves the guest unsure whether they are still on a list; one that says
  //    "this is the last one" is the better note to leave a relationship on.
  out.push({ key: 'goodbye', phase: 'Post Stay', channel: 'Email',
             date: iso(nextTuesday(addDays(departure, GOODBYE_AFTER))),
             label: 'Goodbye — last message in the sequence', offset: -GOODBYE_AFTER });

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// The pre-arrival rungs in order, exported so the sender can rotate content by POSITION
// rather than by offset value. Every offset is even, so `offset % poolSize` collapses to
// a constant for any pool of two — which silently showed one guest the same suggestion
// on all twelve emails.
const PRE_RUNGS = [...descending(MONTHLY_FROM, MONTHLY_TO, MONTHLY_STEP),
                   ...descending(FORTNIGHT_FROM, FORTNIGHT_TO, FORTNIGHT_STEP)];

module.exports = { buildSchedule, nextTuesday, PRE_RUNGS, POST_STAY };
