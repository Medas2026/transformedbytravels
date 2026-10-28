// Lodge content for a trip. Given a tripId, returns the coach's lodge branding
// and 6 content slots sorted by the guest's archetype match.
//
// Usage:  GET /api/lodge-content?tripId=recXXX

const BASE_ID       = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE   = 'Trips';
const PROPERTY_TABLE = 'Property';
const TRAVELER_TABLE = 'Traveler';

// Map full archetype names → codes used in slot tagging
// Two archetypes were renamed after the slot codes were set, so both the current and the
// former names have to resolve — otherwise a guest assessed today as a Growth Seeker or
// an Experience Seeker matches nothing and silently gets unsorted content.
//   TT  = The Growth Seeker      (was The Transformational Traveler)
//   EGT = The Experience Seeker  (was The Easy Going Traveler)
// The Property table drops the 'Lodge ' prefix its fields carried when they lived on a
// Traveler record. Rather than rewrite every reference below, map the names once here.
// The CSV import guessed a select type for one or two text columns, so a value can
// arrive as an array — and a title containing a comma arrives split in two. Rejoin it
// rather than take the first piece, which silently truncates the title. The real fix is
// changing the field to Long text in Airtable; this keeps the page right until then.
const str = v => (Array.isArray(v) ? v.join(', ') : v) || '';

function propertyToLodgeFields(f) {
  const out = {
    'Lodge Name': str(f['Name']),
    'Lodge Tagline': str(f['Tagline']),
    'Lodge Logo URL': str(f['Logo URL']),
    'Lodge Brand Color': str(f['Brand Color']),
    'Lodge Current Season': str(f['Current Season']),
  };
  for (let n = 1; n <= 6; n++) {
    ['Title', 'Body', 'Image URL', 'Video URL'].forEach(k => {
      out[`Lodge Slot ${n} ${k}`] = str(f[`Slot ${n} ${k}`]);
    });
    // Archetypes is genuinely multi-valued — leave it as the array the sorter wants.
    out[`Lodge Slot ${n} Archetypes`] = f[`Slot ${n} Archetypes`];
  }
  ['Spring', 'Summer', 'Fall', 'Winter'].forEach(s => {
    ['Title', 'Body', 'Image URL'].forEach(k => { out[`Lodge ${s} ${k}`] = str(f[`${s} ${k}`]); });
  });
  return out;
}

function archetypeCode(fullName) {
  const n = String(fullName || '').toLowerCase();
  if (n.includes('growth') || n.includes('transformational')) return 'TT';
  if (n.includes('experience') || n.includes('easy'))         return 'EGT';
  if (n.includes('adventure'))                                return 'AOT';
  if (n.includes('cultural'))                                 return 'CE';
  if (n.includes('purpose'))                                  return 'PDT';
  return '';
}

async function airtableGet(table, path) {
  const url  = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`;
  const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + process.env.AIRTABLE_API_KEY } });
  return resp.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const tripId = String(req.query.tripId || '').trim();
  if (!tripId) return res.status(400).json({ error: 'tripId required' });

  try {
    // 1. Fetch trip → which property, and which guest
    const trip = await airtableGet(TRIPS_TABLE, `/${tripId}`);
    if (trip.error) return res.status(404).json({ error: 'Trip not found' });
    const tf = trip.fields || {};
    const travelerEmail = (tf['Traveler Email'] || '').toLowerCase().trim();

    // A property is a record in its own right now. Trips link to it directly; the old
    // Coach Email path stays as a fallback so nothing breaks before every trip is linked.
    let cf = null;
    const linked = Array.isArray(tf['Property']) ? tf['Property'][0] : null;
    if (linked) {
      const prop = await airtableGet(PROPERTY_TABLE, `/${linked}`);
      if (!prop.error) cf = propertyToLodgeFields(prop.fields || {});
    }

    if (!cf) {
      let coachEmail = (tf['Coach Email'] || '').toLowerCase().trim();
      if (!coachEmail && travelerEmail) {
        const gFilter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${travelerEmail}"`)}&maxRecords=1`;
        const gData = await airtableGet(TRAVELER_TABLE, gFilter);
        const gRec  = (gData.records || [])[0];
        if (gRec) coachEmail = (gRec.fields['Coach Email'] || '').toLowerCase().trim();
      }
      if (!coachEmail) return res.status(200).json({ lodge: null, reason: 'no-property' });
      const pFilter = `?filterByFormula=${encodeURIComponent(`LOWER({Contact Email})="${coachEmail}"`)}&maxRecords=1`;
      const pData = await airtableGet(PROPERTY_TABLE, pFilter);
      const pRec = (pData.records || [])[0];
      if (pRec) cf = propertyToLodgeFields(pRec.fields || {});
    }

    if (!cf) return res.status(200).json({ lodge: null, reason: 'property-not-found' });

    // 3. A property with no name isn't set up yet — bail rather than render a blank header
    const lodgeName = (cf['Lodge Name'] || '').trim();
    if (!lodgeName) return res.status(200).json({ lodge: null, reason: 'no-lodge' });

    // 4. Guest archetype for THIS trip.
    //
    // An archetype is a read on the trip a guest is taking, not a fixed trait: the same
    // person may come to reflect one year and to be pulled out of themselves the next.
    // So the Trip's own Archetype wins when it is set, and the Traveler record — which
    // holds their most recent assessment — is the fallback for trips taken before this
    // existed, or where the guest has not re-assessed for this stay.
    let guestArchetype = archetypeCode(tf['Archetype']);
    if (!guestArchetype && travelerEmail) {
      const guestFilter = `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${travelerEmail}"`)}&maxRecords=1`;
      const guestData = await airtableGet(TRAVELER_TABLE, guestFilter);
      const guestRec  = (guestData.records || [])[0];
      if (guestRec) {
        guestArchetype = archetypeCode(guestRec.fields['Archetype']);
      }
    }

    // 5. Build slot list from coach's record
    const slots = [1,2,3,4,5,6].map(n => {
      const title = (cf[`Lodge Slot ${n} Title`] || '').trim();
      if (!title) return null;
      const rawTags = cf[`Lodge Slot ${n} Archetypes`];
      const tags = Array.isArray(rawTags) ? rawTags : (rawTags ? [rawTags] : []);
      return {
        n,
        title,
        body:     cf[`Lodge Slot ${n} Body`]      || '',
        imageUrl: cf[`Lodge Slot ${n} Image URL`] || '',
        videoUrl: cf[`Lodge Slot ${n} Video URL`] || '',
        archetypes: tags,
      };
    }).filter(Boolean);

    // 6. Sort by archetype match: matched slots first, then ALL, then others
    const priority = slot => {
      if (guestArchetype && slot.archetypes.includes(guestArchetype)) return 0;
      if (slot.archetypes.includes('ALL')) return 1;
      return 2;
    };
    const sorted = slots.slice().sort((a, b) => {
      const pa = priority(a), pb = priority(b);
      if (pa !== pb) return pa - pb;
      return a.n - b.n;
    });

    // 6b. Determine season — lodge's manual override wins, otherwise fall back
    // to month-based auto-detection from trip Start Date (or today if unset).
    // Auto-detection:
    //   Dec-Feb → Winter, Mar-May → Spring, Jun-Aug → Summer, Sep-Nov → Fall
    let seasonal = null;
    const manualSeason = String(cf['Lodge Current Season'] || '').trim();
    let seasonKey;
    if (['Spring','Summer','Fall','Winter'].includes(manualSeason)) {
      seasonKey = manualSeason;
    } else {
      const seasonDate = tf['Start Date'] ? new Date(tf['Start Date'] + 'T12:00:00') : new Date();
      const month = seasonDate.getMonth(); // 0-11
      seasonKey = (month >= 2 && month <= 4)  ? 'Spring'
                : (month >= 5 && month <= 7)  ? 'Summer'
                : (month >= 8 && month <= 10) ? 'Fall'
                : 'Winter';
    }
    const seasonalTitle = (cf[`Lodge ${seasonKey} Title`] || '').trim();
    if (seasonalTitle) {
      seasonal = {
        season:   seasonKey,
        title:    seasonalTitle,
        body:     cf[`Lodge ${seasonKey} Body`]      || '',
        imageUrl: cf[`Lodge ${seasonKey} Image URL`] || '',
      };
    }

    // 7. Determine this week's spotlight slot — rotates through archetype-matched
    // slots as the trip approaches. Same slot stays spotlighted all week.
    let spotlightIndex = null;
    if (sorted.length > 0 && tf['Start Date']) {
      const nowD = new Date(); nowD.setHours(0,0,0,0);
      const startD = new Date(tf['Start Date'] + 'T00:00:00');
      const weeksOut = Math.ceil((startD - nowD) / (7 * 24 * 60 * 60 * 1000));
      const TOTAL_WEEKS = 6;
      // weekIndex: 0 at booking week (weeksOut = TOTAL_WEEKS), grows as trip nears
      const weekIndex = Math.max(0, Math.min(TOTAL_WEEKS - weeksOut, TOTAL_WEEKS - 1));
      spotlightIndex = weekIndex % sorted.length;
    }
    const spotlight = spotlightIndex !== null ? sorted[spotlightIndex] : null;
    // Remove spotlight from the main slots list so it doesn't duplicate visually
    const remaining = spotlightIndex !== null
      ? sorted.filter((_, i) => i !== spotlightIndex)
      : sorted;

    // 8. Fetch this week's reflection tip from Daily Tips
    // Progression: tip 1 = first week after booking, climaxes as trip approaches.
    // For MVP formula: tipNum grows as weeks_until_trip decreases.
    //   weeks_until_trip = 6 → tip 1 (introductory)
    //   weeks_until_trip = 1 → tip 6 (arrival week, deepest)
    // If already in trip (weeks <= 0), skip — during-trip prompts come from the journal.
    let reflection = null;
    const startDate = tf['Start Date'];
    if (guestArchetype && startDate) {
      const today = new Date();
      today.setHours(0,0,0,0);
      const start = new Date(startDate + 'T00:00:00');
      const weeksUntilTrip = Math.ceil((start - today) / (7 * 24 * 60 * 60 * 1000));
      if (weeksUntilTrip > 0) {
        const TOTAL_PRE_TRIP_TIPS = 6;
        const tipNum = Math.max(1, Math.min(TOTAL_PRE_TRIP_TIPS - weeksUntilTrip + 1, TOTAL_PRE_TRIP_TIPS));
        // Daily Tips table uses archetype short name (no "The " prefix)
        const archShort = {
          TT:  'Growth Seeker',
          AOT: 'Adventure Traveler',
          CE:  'Cultural Explorer',
          PDT: 'Purpose-Driven Traveler',
          EGT: 'Easy-Going Traveler',
        }[guestArchetype];
        if (archShort) {
          const tipFilter = `?filterByFormula=${encodeURIComponent(`AND({Tip Number}=${tipNum},{Archetype}="${archShort}")`)}&maxRecords=1`;
          const tipData = await airtableGet('Daily Tips', tipFilter);
          const tipRec  = (tipData.records || [])[0];
          if (tipRec) {
            reflection = {
              tipNumber: tipNum,
              tipName:   tipRec.fields['Tip Name'] || '',
              tipText:   tipRec.fields['Tip Text'] || '',
              weeksUntilTrip,
            };
          }
        }
      }
    }

    return res.status(200).json({
      lodge: {
        name:       lodgeName,
        tagline:    cf['Lodge Tagline']     || '',
        logoUrl:    cf['Lodge Logo URL']    || '',
        brandColor: cf['Lodge Brand Color'] || '#0a1628',
      },
      guest: {
        archetype:     guestArchetype || null,
        archetypeName: (guestArchetype ? {
          TT:  'The Growth Seeker',
          AOT: 'The Adventure Traveler',
          CE:  'The Cultural Explorer',
          PDT: 'The Purpose-Driven Traveler',
          EGT: 'The Easy-Going Traveler',
        }[guestArchetype] : null),
      },
      seasonal,
      spotlight,
      slots:      remaining,
      reflection,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
