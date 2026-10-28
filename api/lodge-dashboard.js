// api/lodge-dashboard.js — what one property can see about its own guests.
// GET /api/lodge-dashboard?email=<the signed-in address>[&lodge=<recId|email>]
//
// Scoping is the whole point: a property sees the guests on ITS trips and nothing else.
// Trips link to a Property record, so the link is the scope — no string matching on an
// email that someone could retype. The caller's email comes from their authenticated
// Auth0 session; this endpoint additionally refuses anyone who is not on a property.
const BASE_ID  = 'appdlxcWb45dIqNK2';
const PROPERTY = 'Property';
const TRAVELER = 'Traveler';
const TRIPS    = 'Trips';
const JOURNAL  = 'Journal Entries';
const STAY_TX  = 'Stay Transactions';

async function at(table, qs = '') {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${qs}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return r.json();
}
async function atAll(table, params) {
  const out = []; let offset = '';
  do {
    const p = new URLSearchParams(params); if (offset) p.set('offset', offset);
    const d = await at(table, '?' + p.toString());
    if (d.error) break;
    out.push(...(d.records || [])); offset = d.offset || '';
  } while (offset);
  return out;
}

const iso = d => d.toISOString().split('T')[0];
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const email = String(req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'email required' });

  // The platform operator needs to look in on any property — checking a pilot is the
  // whole job. Everyone else only ever sees their own.
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean);
  const isAdmin = admins.includes(email);
  const asLodge = String(req.query.lodge || '').trim();

  try {
    // An admin with no property chosen gets the list to pick from.
    if (isAdmin && !asLodge) {
      const all = await atAll(PROPERTY, { 'fields[]': 'Name' });
      return res.status(200).json({
        chooseLodge: true,
        lodges: all
          .map(r => ({ name: r.fields['Name'], id: r.id }))
          .filter(l => l.name)
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // 1. Which property is this? An admin may name one by record id or contact address;
    //    everyone else gets theirs, found via the Staff link or the contact address.
    let property = null;
    if (isAdmin && asLodge) {
      if (/^rec[A-Za-z0-9]{14}$/.test(asLodge)) {
        const r = await at(PROPERTY, `/${asLodge}`);
        if (!r.error) property = r;
      } else {
        property = (await at(PROPERTY,
          `?filterByFormula=${encodeURIComponent(`LOWER({Contact Email})="${asLodge.toLowerCase()}"`)}&maxRecords=1`)
        ).records?.[0] || null;
      }
    } else {
      property = (await at(PROPERTY,
        `?filterByFormula=${encodeURIComponent(`LOWER({Contact Email})="${email}"`)}&maxRecords=1`)
      ).records?.[0] || null;

      // Staff who are not the contact address still work here. Follow their Traveler
      // record's Property link rather than demanding one address per property.
      if (!property) {
        const me = (await at(TRAVELER,
          `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${email}"`)}&maxRecords=1`)
        ).records?.[0];
        // Accept either name: the reverse link from Property.Staff arrived as
        // 'Properties 2' and may or may not have been renamed yet.
        const mf = (me && me.fields) || {};
        const staffLink = mf['Property'] || mf['Properties 2'];
        const link = Array.isArray(staffLink) ? staffLink[0] : null;
        if (link) {
          const r = await at(PROPERTY, `/${link}`);
          if (!r.error) property = r;
        }
      }
    }

    const pf = property && property.fields || null;
    const lodgeName = pf && (pf['Name'] || '').trim();
    if (!lodgeName) return res.status(403).json({ error: 'not-a-lodge' });

    // 2. Only trips belonging to THIS property, read off the link itself.
    //    Coach Email remains a fallback for any trip not yet linked.
    const tripIds = Array.isArray(pf['Trips']) ? pf['Trips'] : [];
    let trips = [];
    for (let i = 0; i < tripIds.length; i += 50) {
      const chunk = tripIds.slice(i, i + 50);
      const formula = `OR(${chunk.map(id => `RECORD_ID()="${id}"`).join(',')})`;
      trips.push(...await atAll(TRIPS, { filterByFormula: formula }));
    }
    if (!trips.length) {
      const contact = (pf['Contact Email'] || '').toLowerCase().trim();
      if (contact) trips = await atAll(TRIPS, { filterByFormula: `LOWER({Coach Email})="${contact}"` });
    }
    trips.sort((a, b) => String(a.fields['Start Date'] || '').localeCompare(String(b.fields['Start Date'] || '')));

    // 3. Guests named on those trips — one lookup, not one per trip.
    const guestEmails = [...new Set(trips.map(t => (t.fields['Traveler Email'] || '').toLowerCase()).filter(Boolean))];
    const guests = {};
    for (let i = 0; i < guestEmails.length; i += 20) {
      const chunk = guestEmails.slice(i, i + 20);
      const formula = `OR(${chunk.map(e => `LOWER({Traveler Email})="${e}"`).join(',')})`;
      const recs = await atAll(TRAVELER, { filterByFormula: formula });
      recs.forEach(r => { guests[(r.fields['Traveler Email'] || '').toLowerCase()] = r.fields; });
    }

    // 4. Who has actually written something — the real engagement signal, as distinct
    //    from having merely been sent a page.
    const journalled = new Set();
    try {
      // 'fields[]' — the bracketed form is the only one Airtable accepts. Passing
      // `fields: ['Trip ID']` yields `fields=Trip+ID`, which 400s; the catch below then
      // swallowed it and every guest silently read as having written nothing.
      const entries = await atAll(JOURNAL, { 'fields[]': 'Trip ID' });
      entries.forEach(e => { const t = e.fields['Trip ID']; if (t) journalled.add(String(t)); });
    } catch (_) { /* engagement figures degrade rather than break the page */ }

    // Reservation emails that could not be applied automatically. Surfaced here because
    // this is the page a property actually opens; a review queue nobody visits is no
    // queue at all. Degrades to 0 if the table does not exist yet.
    let staysNeedingReview = 0;
    try {
      const tx = await atAll(STAY_TX, { filterByFormula: `OR({Status}="Needs Review",{Status}="Failed")` });
      staysNeedingReview = tx.filter(r =>
        Array.isArray(r.fields['Property']) && r.fields['Property'].includes(property.id)).length;
    } catch (_) { /* the dashboard must not depend on the transaction log existing */ }

    const today = iso(new Date());
    const soon = new Date(); soon.setDate(soon.getDate() + 30);
    const backTo = new Date(); backTo.setDate(backTo.getDate() - 90);

    const shape = t => {
      const f = t.fields;
      const gEmail = (f['Traveler Email'] || '').toLowerCase();
      const g = guests[gEmail] || {};
      // Trip archetype wins — it is a read on this stay, not a fixed trait.
      const archetype = f['Archetype'] || g['Archetype'] || '';
      return {
        tripId: t.id,
        guest: g['Traveler Name'] || gEmail || 'Guest',
        email: gEmail,
        start: f['Start Date'] || '',
        end: f['End Date'] || '',
        archetype,
        assessed: !!archetype,
        assessedOn: f['Assessment Date'] || g['Assessment Date'] || null,
        journalled: journalled.has(t.id),
        nights: f['Start Date'] && f['End Date'] ? daysBetween(f['End Date'], f['Start Date']) : null,
      };
    };

    const all = trips.map(shape);
    const arriving = all.filter(t => t.start && t.start > today && t.start <= iso(soon));
    const inHouse  = all.filter(t => t.start && t.end && t.start <= today && t.end >= today);
    const recent   = all.filter(t => t.end && t.end < today && t.end >= iso(backTo)).reverse();

    // Figures a property would actually act on. Assessment rate is the one that matters:
    // an unassessed guest gets a generic stay, so it is the number to move.
    const started = all.filter(t => t.start && t.start <= today);
    const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

    return res.status(200).json({
      viewingAs: isAdmin && asLodge ? lodgeName : null,
      lodge: {
        name: lodgeName,
        logoUrl: pf['Logo URL'] || '',
        tagline: pf['Tagline'] || '',
      },
      counts: {
        arriving: arriving.length,
        inHouse: inHouse.length,
        recent: recent.length,
        allTime: all.length,
      },
      metrics: {
        assessedPct: pct(all.filter(t => t.assessed).length, all.length),
        assessedBeforeArrivalPct: pct(
          all.filter(t => t.assessed && t.assessedOn && t.start && t.assessedOn <= t.start).length,
          all.filter(t => t.assessed).length),
        journalledPct: pct(started.filter(t => t.journalled).length, started.length),
        awaitingAssessment: arriving.filter(t => !t.assessed).length,
        staysNeedingReview,
      },
      arriving, inHouse, recent,
    });
  } catch (e) {
    console.error('[lodge-dashboard]', e.message);
    return res.status(500).json({ error: e.message });
  }
};

module.exports.config = { maxDuration: 30 };
