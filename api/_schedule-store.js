// _schedule-store.js — persists a stay's message plan, and keeps it true as the stay moves.
//
// buildSchedule() in _schedule.js is pure and knows nothing about Airtable. This is the
// half that writes, so the generator stays testable without a network.
//
// Two different events, two different treatments, deliberately:
//   dates change  → pending rows are DELETED and regenerated. The old plan was never seen
//                   by anyone; keeping it would just be clutter in the property's view.
//   stay cancelled → pending rows are marked Cancelled, not deleted. That IS something a
//                   property should see: "these eight messages stopped because she cancelled."
// Rows already Sent are never touched by either path. They are history.

const { buildSchedule } = require('./_schedule.js');

const BASE_ID = 'appdlxcWb45dIqNK2';
const TABLE   = 'Scheduled Messages';

async function at(path = '', method = 'GET', body = null) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE)}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}
const esc = s => String(s == null ? '' : s).replace(/"/g, '\\"');
const iso = d => new Date(d).toISOString().split('T')[0];

// A link field cannot be filtered by record id: Airtable compares it against the linked
// record's PRIMARY FIELD text. `{Trips}="recXXX"` therefore matches nothing, silently —
// which left stale rows behind on every reschedule and made cancellation a no-op.
// Narrow on Guest Email (a real scalar on the row), then match the link in JS.
async function rowsFor(tripId, guestEmail) {
  const out = [];
  let offset = '';
  do {
    const p = new URLSearchParams({ pageSize: '100' });
    if (guestEmail) p.set('filterByFormula', `LOWER({Guest Email})="${esc(String(guestEmail).toLowerCase())}"`);
    if (offset) p.set('offset', offset);
    const d = await at('?' + p.toString());
    if (d.error) throw new Error(d.error.message || 'could not read schedule');
    out.push(...(d.records || []));
    offset = d.offset || '';
  } while (offset);
  return out.filter(r => Array.isArray(r.fields['Trips']) && r.fields['Trips'].includes(tripId));
}

async function destroy(ids) {
  for (let i = 0; i < ids.length; i += 10) {
    await at('?' + ids.slice(i, i + 10).map(id => 'records[]=' + id).join('&'), 'DELETE');
  }
}

async function create(records) {
  for (let i = 0; i < records.length; i += 10) {
    const r = await at('', 'POST', { records: records.slice(i, i + 10).map(fields => ({ fields })) });
    if (r.error) throw new Error(r.error.message || 'could not write schedule');
  }
}

/**
 * Generate (or regenerate) the plan for one stay.
 * Safe to call repeatedly — already-sent messages are preserved and never duplicated.
 */
async function syncSchedule({ tripId, propertyId, guestEmail, guestName, arrival, departure }) {
  if (!tripId || !arrival) return { skipped: 'no trip or arrival date' };

  const existing = await rowsFor(tripId, guestEmail);
  const sentKeys = new Set(existing
    .filter(r => r.fields['Status'] === 'Sent')
    .map(r => r.fields['Message Key']));
  const pending = existing.filter(r => (r.fields['Status'] || 'Scheduled') === 'Scheduled');

  // Regenerate from today, not from the original booking date: a stay that moves should
  // not resurrect rungs the guest has already passed.
  const plan = buildSchedule({ arrival, departure, from: iso(new Date()) })
    .filter(m => !sentKeys.has(m.key));

  await destroy(pending.map(r => r.id));
  await create(plan.map(m => ({
    'Name': `${m.label}${guestName ? ' · ' + guestName : ''}`,
    'Trips': [tripId],
    ...(propertyId ? { 'Property': [propertyId] } : {}),
    ...(guestEmail ? { 'Guest Email': guestEmail } : {}),
    'Send Date': m.date,
    'Message Key': m.key,
    'Phase': m.phase,
    'Channel': m.channel,
    'Status': 'Scheduled',
  })));

  return { scheduled: plan.length, replaced: pending.length, kept: sentKeys.size };
}

/** A cancelled stay stops talking to the guest, but the plan stays visible. */
async function cancelSchedule(tripId, guestEmail) {
  const pending = (await rowsFor(tripId, guestEmail))
    .filter(r => (r.fields['Status'] || 'Scheduled') === 'Scheduled');
  for (let i = 0; i < pending.length; i += 10) {
    const r = await at('', 'PATCH', {
      records: pending.slice(i, i + 10).map(x => ({ id: x.id, fields: { 'Status': 'Cancelled' } })),
    });
    if (r.error) throw new Error(r.error.message || 'could not cancel schedule');
  }
  return { cancelled: pending.length };
}

// The schedule is a convenience layered on top of the reservation. Losing it must never
// cost us the stay itself, so callers use these and ignore the outcome.
const quietly = fn => async (...args) => {
  try { return await fn(...args); }
  catch (e) { console.warn('[schedule]', e.message); return { error: e.message }; }
};

module.exports = {
  syncSchedule: quietly(syncSchedule),
  cancelSchedule: quietly(cancelSchedule),
  _raw: { syncSchedule, cancelSchedule },
};
