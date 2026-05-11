/**
 * Creates a realistic Uganda/Rwanda test trip in Airtable
 * and prints the wildlife-tracker URL.
 *
 * Usage:
 *   AIRTABLE_API_KEY=pat... node scripts/setup-test-trip.js
 *   AIRTABLE_API_KEY=pat... node scripts/setup-test-trip.js --delete TRIP_ID
 */

const https = require('https');

const BASE_ID      = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE  = 'Trips';
const DAYS_TABLE   = 'Trip Days';

const EMAIL        = 'michaele@transformedbytravels.com';
const START_DATE   = '2026-05-10';  // today — tracker shows correct "today" tab
const END_DATE     = '2026-05-18';

// 9-day itinerary — realistic Uganda/Rwanda safari
const ITINERARY = [
  { location: 'Entebbe',              country: 'Uganda',        morning: 'International arrival, transfer to hotel',         afternoon: 'Rest and orientation',                 evening: 'Welcome dinner' },
  { location: 'Bwindi Impenetrable',  country: 'Uganda',        morning: 'Mountain Gorilla tracking — Rushaga sector',       afternoon: 'Gorilla habituation debrief',           evening: 'Camp dinner with ranger talk' },
  { location: 'Bwindi Impenetrable',  country: 'Uganda',        morning: 'Golden Monkey tracking',                           afternoon: 'Village walk — Batwa community',        evening: 'Night sounds walk' },
  { location: 'Queen Elizabeth NP',   country: 'Uganda',        morning: 'Transfer — Bwindi to Queen Elizabeth NP',          afternoon: 'Afternoon game drive — Kasenyi Plains', evening: 'Sundowner at crater rim' },
  { location: 'Queen Elizabeth NP',   country: 'Uganda',        morning: 'Kazinga Channel boat cruise',                      afternoon: 'Tree-climbing lions drive — Ishasha',   evening: 'Lodge dinner and stargazing' },
  { location: 'Queen Elizabeth NP',   country: 'Uganda',        morning: 'Chimp tracking — Kyambura Gorge',                  afternoon: 'Maramagambo Forest walk',               evening: 'Transfer to border lodge' },
  { location: 'Volcanoes NP',         country: 'Rwanda',        morning: 'Cross Rwanda border, transfer to Volcanoes NP',    afternoon: 'Golden Monkey tracking',                evening: 'Camp welcome dinner' },
  { location: 'Volcanoes NP',         country: 'Rwanda',        morning: 'Mountain Gorilla tracking — Sabyinyo group',       afternoon: 'Conservation center visit',             evening: 'Farewell dinner' },
  { location: 'Kigali',               country: 'Rwanda',        morning: 'Transfer to Kigali, Genocide Memorial',            afternoon: 'City craft market',                     evening: 'Departure from Kigali' },
];

function request(method, table, path, body) {
  return new Promise((resolve, reject) => {
    const apiKey  = process.env.AIRTABLE_API_KEY;
    if (!apiKey) { reject(new Error('AIRTABLE_API_KEY not set')); return; }
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function createTrip() {
  const tripName = 'Uganda & Rwanda Safari (Test)';
  console.log(`\nCreating trip: "${tripName}" ...`);

  const r = await request('POST', TRIPS_TABLE, '', {
    fields: {
      'Traveler Email':   EMAIL,
      'Trip Name':        tripName,
      'Destination':      'Bwindi / Queen Elizabeth / Volcanoes',
      'Country':          'Uganda/Rwanda',
      'Start Date':       START_DATE,
      'End Date':         END_DATE,
      'Status of Trip':   'Active',
    }
  });

  if (r.body.error) throw new Error('Trip create failed: ' + JSON.stringify(r.body.error));
  const tripId = r.body.id;
  console.log(`  ✓ Trip created: ${tripId}`);
  return tripId;
}

async function createDays(tripId) {
  console.log('\nCreating trip days ...');

  const start = new Date(START_DATE + 'T00:00:00Z');
  const records = ITINERARY.map((day, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const fields = {
      'Trip ID':           tripId,
      'Day Number':        i + 1,
      'Date':              d.toISOString().split('T')[0],
      'Starting Location': day.location,
      'Starting Country':  day.country,
      'Ending Location':   day.location,
      'Ending Country':    day.country,
    };
    // Store activities as JSON in Slot fields (Morning=1, Midday=2, Afternoon=3, Evening=4)
    if (day.morning)   fields['Slot 1'] = JSON.stringify({ name: day.morning });
    if (day.afternoon) fields['Slot 3'] = JSON.stringify({ name: day.afternoon });
    if (day.evening)   fields['Slot 4'] = JSON.stringify({ name: day.evening });
    return fields;
  });

  // Batch in chunks of 10 (Airtable limit)
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const r = await request('POST', DAYS_TABLE, '', { records: chunk.map(f => ({ fields: f })) });
    if (r.body.error) throw new Error('Days create failed: ' + JSON.stringify(r.body.error));
    console.log(`  ✓ Days ${i + 1}–${i + chunk.length} created`);
  }
}

async function deleteTrip(tripId) {
  console.log(`\nDeleting trip ${tripId} and its days ...`);

  // Find and delete all day records for this trip
  const filter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${tripId}")`)}`;
  const r = await request('GET', DAYS_TABLE, filter, null);
  const dayIds = (r.body.records || []).map(rec => rec.id);

  for (let i = 0; i < dayIds.length; i += 10) {
    const ids = dayIds.slice(i, i + 10);
    const qs  = ids.map(id => `records[]=${id}`).join('&');
    await request('DELETE', DAYS_TABLE, `?${qs}`, null);
    console.log(`  ✓ Deleted days ${i + 1}–${i + ids.length}`);
  }

  // Delete the trip record itself
  await request('DELETE', TRIPS_TABLE, `/${tripId}`, null);
  console.log(`  ✓ Trip ${tripId} deleted`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--delete') {
    const tripId = args[1];
    if (!tripId) { console.error('Usage: --delete TRIP_ID'); process.exit(1); }
    await deleteTrip(tripId);
    return;
  }

  const tripId = await createTrip();
  await createDays(tripId);

  const base   = 'https://transformedbytravels.vercel.app';
  const params = new URLSearchParams({ tripId, email: EMAIL, country: 'Uganda/Rwanda' });
  const url    = `${base}/wildlife-tracker.html?${params}`;

  console.log('\n─────────────────────────────────────────────────────────');
  console.log('Trip ID:  ' + tripId);
  console.log('Email:    ' + EMAIL);
  console.log('');
  console.log('Wildlife Tracker URL (open in Safari on iPhone):');
  console.log(url);
  console.log('');
  console.log('To clean up: node scripts/setup-test-trip.js --delete ' + tripId);
  console.log('─────────────────────────────────────────────────────────\n');
}

main().catch(e => { console.error('\n✗ Error:', e.message); process.exit(1); });
