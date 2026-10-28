// Resolves a guest invite token into everything the welcome page needs.
// GET /api/welcome?t=<share token>
//
// The invite link deliberately carries ONLY an opaque token. The older pattern —
// trip.html?tripId=…&email=guest@example.com — puts a guest's email address into a URL
// that gets forwarded, screenshotted and pasted into group chats. A token resolves
// server-side and leaks nothing.
const BASE_ID      = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE  = 'Trips';
const TRAVELER     = 'Traveler';
const PROPERTY     = 'Property';

const at = async (table, qs = '') => {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${qs}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return r.json();
};

const firstName = full => String(full || '').trim().split(/\s+/)[0] || '';

// "12–17 November" / "28 November – 3 December" — short, human, no year unless it differs.
function stayDates(start, end) {
  if (!start) return '';
  const s = new Date(start + 'T12:00:00');
  const e = end ? new Date(end + 'T12:00:00') : null;
  const mon = d => d.toLocaleDateString('en-US', { month: 'long' });
  if (!e || isNaN(e)) return `${s.getDate()} ${mon(s)}`;
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  const yr = s.getFullYear() !== new Date().getFullYear() ? ` ${s.getFullYear()}` : '';
  return sameMonth
    ? `${s.getDate()}–${e.getDate()} ${mon(s)}${yr}`
    : `${s.getDate()} ${mon(s)} – ${e.getDate()} ${mon(e)}${yr}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');   // never cache a guest's invite
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.query.t || '').trim();
  if (!token) return res.status(400).json({ error: 'token required' });

  try {
    const filter = `?filterByFormula=${encodeURIComponent(`{Share Token}="${token.replace(/"/g, '\\"')}"`)}&maxRecords=1`;
    const trip = ((await at(TRIPS_TABLE, filter)).records || [])[0];
    // A wrong or retired token is simply "not found" — never hint that it was close.
    if (!trip) return res.status(404).json({ error: 'not found' });

    const f = trip.fields || {};
    const guestEmail = (f['Traveler Email'] || '').toLowerCase().trim();

    // Guest — for the greeting, and to know whether they have been assessed yet.
    let guestName = '', assessed = false;
    if (guestEmail) {
      const gf = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${guestEmail}"`)}&maxRecords=1`;
      const g = ((await at(TRAVELER, gf)).records || [])[0];
      if (g) {
        guestName = g.fields['Traveler Name'] || '';
        assessed = !!(f['Archetype'] || g.fields['Archetype']);
      }
    }

    // Property — the page must look like the property, not like us. The trip links to
    // its property directly; Coach Email stays as a fallback until every trip is linked.
    let lodge = null;
    const shape = pf => ({
      name:    pf['Name'],
      tagline: pf['Tagline'] || '',
      logoUrl: pf['Logo URL'] || '',
      color:   pf['Brand Color'] || '',
    });

    const linked = Array.isArray(f['Property']) ? f['Property'][0] : null;
    if (linked) {
      const prop = await at(PROPERTY, `/${linked}`);
      if (!prop.error && (prop.fields['Name'] || '').trim()) lodge = shape(prop.fields);
    }

    if (!lodge) {
      let coachEmail = (f['Coach Email'] || '').toLowerCase().trim();
      if (!coachEmail && guestEmail) {
        const gf = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${guestEmail}"`)}&maxRecords=1`;
        const g = ((await at(TRAVELER, gf)).records || [])[0];
        if (g) coachEmail = (g.fields['Coach Email'] || '').toLowerCase().trim();
      }
      if (coachEmail) {
        const pf = `?filterByFormula=${encodeURIComponent(`LOWER({Contact Email})="${coachEmail}"`)}&maxRecords=1`;
        const prop = ((await at(PROPERTY, pf)).records || [])[0];
        if (prop && (prop.fields['Name'] || '').trim()) lodge = shape(prop.fields);
      }
    }

    return res.status(200).json({
      guestFirstName: firstName(guestName),
      dates:          stayDates(f['Start Date'], f['End Date']),
      destination:    f['Destination'] || '',
      tripName:       f['Trip Name'] || '',
      assessed,
      lodge,
      // The page needs these to hand the guest onward; they are only ever returned
      // against a valid token, never put in the invite URL itself.
      tripId:         trip.id,
      email:          guestEmail,
    });
  } catch (e) {
    console.error('[welcome]', e.message);
    return res.status(500).json({ error: 'could not load invitation' });
  }
};

module.exports.config = { maxDuration: 15 };
