const https = require('https');

const BASE_ID       = 'appdlxcWb45dIqNK2';
const TRIPS_TABLE   = 'Trips';
const TRAVEL_TABLE  = 'Traveler';
const EMAILS_TABLE  = 'Emails';
const MEMBERS_TABLE = 'Trip Members';
const PORTAL_URL    = 'https://app.transformedbytravels.com';

const TIMEZONE_MAP = {
  'Eastern Time (ET)':           'America/New_York',
  'Central Time (CT)':           'America/Chicago',
  'Mountain Time (MT)':          'America/Denver',
  'Pacific Time (PT)':           'America/Los_Angeles',
  'Alaska Time (AKT)':           'America/Anchorage',
  'Hawaii Time (HT)':            'Pacific/Honolulu',
  'London (GMT/BST)':            'Europe/London',
  'Central European (CET/CEST)': 'Europe/Paris'
};

// ── Helpers ──────────────────────────────────────────────────────

function localDateStr(tzName) {
  const tz = TIMEZONE_MAP[tzName] || 'UTC';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

function dateOffsetStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

async function fetchTripPlaces(tripId) {
  try {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const filter = encodeURIComponent(`({Trip ID}="${tripId}")`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Trip Places')}?filterByFormula=${filter}&sort[0][field]=Day&sort[0][direction]=asc`;
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + apiKey } });
    const data = await resp.json();
    return (data.records || []).map(r => r.fields['Place'] || '').filter(Boolean);
  } catch(e) {
    console.error('[fetchTripPlaces]', e.message);
    return [];
  }
}

async function generatePostTripSummary(name, tripName, entriesText) {
  try {
    const prompt = `You are a warm travel coach for Transformed by Travels. A traveler named ${name} has just returned from their trip to ${tripName}. Below are their daily journal entries. Write a warm, personal 3-paragraph summary of their journey — what they experienced, what they noticed about themselves, and a forward-looking thought about how this trip may continue to shape them. Speak directly to "${name}" as "you". Be specific to what they actually wrote — never generic.

Journal entries:
${entriesText}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages:   [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    return (data.content && data.content[0] && data.content[0].text) || '';
  } catch(e) {
    console.error('[generatePostTripSummary]', e.message);
    return '';
  }
}

async function generateTripSummary(destination, country, places, startDate, endDate) {
  try {
    const loc      = [destination, country].filter(Boolean).join(', ');
    const placeStr = places.length ? places.join(', ') : loc;
    const dateStr  = (startDate && endDate) ? `from ${startDate} to ${endDate}` : (startDate ? `starting ${startDate}` : '');
    const prompt   = `You are a warm travel coach for Transformed by Travels. Write exactly 2 inspiring, personal sentences about an upcoming trip to ${loc} ${dateStr}, visiting ${placeStr}. Focus on the transformational potential and excitement of the journey. Speak directly to "you". No bullet points or headers.`;
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages:   [{ role: 'user', content: prompt }]
      })
    });
    const data = await resp.json();
    return (data.content && data.content[0] && data.content[0].text) || '';
  } catch(e) {
    console.error('[generateTripSummary]', e.message);
    return '';
  }
}

async function buildPendingInvitesBlock(tripId, headers) {
  try {
    const filter = encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Invited")`);
    const resp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Trip Members')}?filterByFormula=${filter}`, { headers });
    const data = await resp.json();
    const pending = (data.records || []);
    if (!pending.length) return '';
    const list = pending.map(m => {
      const email = m.fields['Email'] || '';
      const role  = m.fields['Role']  || 'Invited';
      return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:5px 0;">· ${email} <span style="color:#94a3b8;font-size:12px;">(${role})</span></div>`;
    }).join('');
    return `<div style="background:#f8fafc;border-radius:12px;padding:20px 24px;margin:20px 0 8px;">
      <div style="font-family:Georgia,serif;font-size:15px;font-weight:bold;color:#0f172a;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #2dd4bf;">Pending Invitations</div>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:#475569;margin:0 0 10px;">These travelers haven't responded to their invitation yet. You may want to follow up:</p>
      ${list}
    </div>`;
  } catch(e) {
    console.error('[pendingInvites]', e.message);
    return '';
  }
}

function tripDetailsBlock(destination, country, startDate, endDate, places) {
  const loc  = [destination, country].filter(Boolean).join(', ');
  const rows = [
    ['Destination', loc],
    ['Start Date',  startDate],
    ['End Date',    endDate]
  ].filter(([, v]) => v).map(([label, value]) =>
    `<tr>
      <td style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;padding:8px 20px 8px 0;vertical-align:top;white-space:nowrap;">${label}</td>
      <td style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:8px 0;line-height:1.5;">${value}</td>
    </tr>`
  ).join('');

  const placesHtml = places.length
    ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;">
        <div style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Places</div>
        ${places.map((p, i) => `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a;padding:3px 0;">${i + 1}. ${p}</div>`).join('')}
      </div>`
    : '';

  return `<div style="background:#f8fafc;border-radius:12px;padding:24px 28px;margin:8px 0 24px;">
    <div style="font-family:Georgia,serif;font-size:16px;font-weight:bold;color:#0f172a;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #2dd4bf;">Your Trip Details</div>
    <table cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>
    ${placesHtml}
  </div>`;
}

function fetchTemplate(code, callback) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const filter = `?filterByFormula=${encodeURIComponent(`({Code}="${code}")`)}`;
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(EMAILS_TABLE)}${filter}`,
    method:   'GET',
    headers:  { 'Authorization': 'Bearer ' + apiKey }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        const record = (parsed.records || [])[0];
        if (!record) return callback(new Error('Template not found: ' + code));
        const f = record.fields;
        callback(null, { subject: f['Subject'] || '', p1: f['Paragraph 1'] || '', p2: f['Paragraph 2'] || '', p3: f['Paragraph 3'] || '', coTraveler: !!f['Co-Traveler'] });
      } catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

function substitute(text, vars) {
  if (!text) return '';
  const lowerVars = {};
  Object.keys(vars).forEach(k => { lowerVars[k.toLowerCase()] = vars[k]; });
  return text.replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key] !== undefined ? vars[key] : lowerVars[key.toLowerCase()];
    return val !== undefined ? val : '{' + key + '}';
  });
}

function airtableRequest(method, table, path, body, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = body ? JSON.stringify(body) : '';
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`,
    method:   method,
    headers: {
      'Authorization':  'Bearer ' + apiKey,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data), res.statusCode); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  if (bodyStr) req.write(bodyStr);
  req.end();
}

// Fetch accepted trip members and send email to each
// Check for members on THIS trip who are also on OTHER trips currently Active.
// Coach role is exempt — coaches can run multiple concurrent trips.
// Returns array of { email, role, otherTripId, otherTripName }.
async function checkConflictingActiveTrips(tripId) {
  const NON_COACH_ROLES = new Set(['Traveler', 'Co-traveler', 'Tour Guide', 'Family', 'Partner', 'Trip Planner']);
  // 1. Get this trip's accepted, non-Coach members
  const thisFilter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Accepted")`)}`;
  const thisResp = await new Promise(resolve =>
    airtableRequest('GET', MEMBERS_TABLE, thisFilter, null, (err, d) => resolve(err || !d ? { records: [] } : d))
  );
  const members = (thisResp.records || []).filter(m => NON_COACH_ROLES.has(m.fields['Role']));
  if (!members.length) return [];
  const emails = [...new Set(members.map(m => (m.fields['Email'] || '').toLowerCase()).filter(Boolean))];
  if (!emails.length) return [];

  // 2. Find any OTHER Trip Members rows for these emails (Accepted)
  const orTerms = emails.map(e => `LOWER({Email})="${e}"`).join(',');
  const otherFilter = `?filterByFormula=${encodeURIComponent(`AND(OR(${orTerms}),{Status}="Accepted",NOT({Trip ID}="${tripId}"))`)}`;
  const otherResp = await new Promise(resolve =>
    airtableRequest('GET', MEMBERS_TABLE, otherFilter, null, (err, d) => resolve(err || !d ? { records: [] } : d))
  );
  const otherMembers = (otherResp.records || []).filter(m => NON_COACH_ROLES.has(m.fields['Role']));
  if (!otherMembers.length) return [];

  // 3. Check which of those other trips are currently Active
  const otherTripIds = [...new Set(otherMembers.map(m => m.fields['Trip ID']).filter(Boolean))];
  const conflicts = [];
  for (const otherTripId of otherTripIds) {
    const tripResp = await new Promise(resolve =>
      airtableRequest('GET', TRIPS_TABLE, '/' + otherTripId, null, (err, d) => resolve(err || !d ? {} : d))
    );
    if (tripResp.fields && tripResp.fields['Status of Trip'] === 'Active') {
      const otherTripName = tripResp.fields['Trip Name'] || tripResp.fields['Destination'] || 'another trip';
      otherMembers
        .filter(m => m.fields['Trip ID'] === otherTripId)
        .forEach(m => {
          conflicts.push({
            email:          (m.fields['Email'] || '').toLowerCase(),
            role:           m.fields['Role']  || '',
            otherTripId,
            otherTripName,
          });
        });
    }
  }
  return conflicts;
}

async function sendToTripMembers(tripId, primaryEmail, subject, html) {
  if (!tripId) return;
  try {
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Accepted")`)}`;
    await new Promise(resolve => {
      airtableRequest('GET', MEMBERS_TABLE, filter, null, (err, data) => {
        if (err || !data || !data.records) return resolve();
        const members = data.records
          .map(r => (r.fields['Email'] || '').trim().toLowerCase())
          .filter(e => e && e !== primaryEmail.toLowerCase());
        members.forEach(memberEmail => {
          sendEmail(memberEmail, '', subject, html, () => {});
        });
        resolve();
      });
    });
  } catch(e) {
    console.error('[trip-action] sendToTripMembers error:', e.message);
  }
}

// Like sendToTripMembers but ONLY co-travelers/partners (not coach/guide/family) —
// used for keepsake emails (Journey Book) that a companion should get their own copy of.
async function sendToPartners(tripId, primaryEmail, subject, html) {
  if (!tripId) return;
  try {
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Accepted")`)}`;
    await new Promise(resolve => {
      airtableRequest('GET', MEMBERS_TABLE, filter, null, (err, data) => {
        if (err || !data || !data.records) return resolve();
        const partners = data.records
          .filter(r => ['Co-traveler', 'Partner'].includes(r.fields['Role']))
          .map(r => (r.fields['Email'] || '').trim().toLowerCase())
          .filter(e => e && e !== (primaryEmail || '').toLowerCase());
        partners.forEach(p => sendEmail(p, '', subject, html, () => {}));
        resolve();
      });
    });
  } catch(e) {
    console.error('[trip-action] sendToPartners error:', e.message);
  }
}

// Role-tailored trip-start emails. Sends to every accepted member (except
// the primary traveler, who already got the rich Bon Voyage email).
// Includes the PIN + quick-scan URL so recipients can jump into the tracker.
async function sendRoleTailoredStartEmails(tripId, primaryEmail, ctx) {
  if (!tripId) return;
  try {
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Accepted")`)}`;
    const membersData = await new Promise(resolve =>
      airtableRequest('GET', MEMBERS_TABLE, filter, null, (err, data) =>
        resolve(err || !data ? { records: [] } : data)
      )
    );
    const members = (membersData.records || [])
      .map(r => ({
        email: (r.fields['Email'] || '').trim().toLowerCase(),
        role:  r.fields['Role'] || 'Co-traveler',
      }))
      .filter(m => m.email && m.email !== (primaryEmail || '').toLowerCase());

    console.log(`[start] role emails to ${members.length} members`);
    await Promise.all(members.map(m => {
      const { subject, html } = buildRoleStartEmail(m.role, ctx, m.email);
      return new Promise(resolve => sendEmail(m.email, '', subject, html, (err) => {
        if (err) console.error(`[start] member email fail ${m.email}:`, err.message);
        else     console.log(`[start] member email sent ${m.email} (${m.role})`);
        resolve();
      }));
    }));

    // Always notify the traveler's coach at trip start — even if they aren't a Trip Member.
    // (The coach may be linked only via the traveler's Coach Email field.)
    try {
      const emailed = new Set(members.map(m => m.email).concat([(primaryEmail || '').toLowerCase()]));
      const travEmail = (primaryEmail || '').toLowerCase();
      if (travEmail) {
        const trav = await new Promise(resolve =>
          airtableRequest('GET', TRAVEL_TABLE,
            `?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${travEmail}"`)}&maxRecords=1`,
            null, (err, data) => resolve(err || !data ? { records: [] } : data)));
        const coachEmail = ((trav.records || [])[0]?.fields?.['Coach Email'] || '').trim().toLowerCase();
        if (coachEmail && !emailed.has(coachEmail)) {
          const { subject, html } = buildRoleStartEmail('Coach', ctx, coachEmail);
          await new Promise(resolve => sendEmail(coachEmail, '', subject, html, (err) => {
            if (err) console.error('[start] coach email fail', coachEmail, err.message);
            else     console.log('[start] coach email sent', coachEmail);
            resolve();
          }));
        }
      }
    } catch(e) { console.error('[start] coach notify error:', e.message); }
  } catch(e) {
    console.error('[trip-action] sendRoleTailoredStartEmails error:', e.message);
  }
}

// Role-tailored end-of-trip emails to each Trip Member.
async function sendRoleTailoredEndEmails(tripId, primaryEmail, ctx) {
  if (!tripId) return;
  try {
    const filter = `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Accepted")`)}`;
    const membersData = await new Promise(resolve =>
      airtableRequest('GET', MEMBERS_TABLE, filter, null, (err, data) =>
        resolve(err || !data ? { records: [] } : data)
      )
    );
    const members = (membersData.records || [])
      .map(r => ({
        email: (r.fields['Email'] || '').trim().toLowerCase(),
        role:  r.fields['Role'] || 'Co-traveler',
      }))
      .filter(m => m.email && m.email !== (primaryEmail || '').toLowerCase());

    console.log(`[end] role emails to ${members.length} members`);
    await Promise.all(members.map(m => {
      const { subject, html } = buildRoleEndEmail(m.role, ctx);
      return new Promise(resolve => sendEmail(m.email, '', subject, html, (err) => {
        if (err) console.error(`[end] member email fail ${m.email}:`, err.message);
        else     console.log(`[end] member email sent ${m.email} (${m.role})`);
        resolve();
      }));
    }));
  } catch(e) {
    console.error('[trip-action] sendRoleTailoredEndEmails error:', e.message);
  }
}

function buildRoleEndEmail(role, ctx) {
  const { tripName, destination, country, travelerName, tripPhotoUrl } = ctx;
  const destStr = destination + (country ? ', ' + country : '');
  const cleanupBlock = `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:13px;color:#475569;line-height:1.55;">
      <strong style="color:#0f172a;">📱 One more thing:</strong> your phone's wildlife tracker has cached data for this trip. Open the tracker once more while online — it'll offer to clear it and free up space on your device.
    </div>`;

  let subject, body;
  switch (role) {
    case 'Coach':
      subject = `${travelerName || 'Your client'}'s trip is complete: ${tripName}`;
      body = `
        <p><strong>${travelerName || 'Your client'}</strong>'s trip to <strong>${destStr}</strong> is now marked complete.</p>
        <p>They'll receive their welcome-home email with next steps for the Integration Workshop. All Trip Members have been notified.</p>`;
      break;

    case 'Tour Guide':
      subject = `Thanks for guiding ${travelerName || 'this traveler'}'s trip`;
      body = `
        <p>The trip to <strong>${destStr}</strong> is now complete. Thanks for your work in the field.</p>
        <p>Any final notes to add to your Guide Journal? Head to <a href="https://app.transformedbytravels.com/portal.html?page=tour-guide-home" style="color:#0d9488;">My Guided Trips</a> to wrap up.</p>
        ${cleanupBlock}`;
      break;

    case 'Co-traveler':
      subject = `Welcome home from ${tripName}!`;
      body = `
        <p>Your trip to <strong>${destStr}</strong> is now complete. Welcome home!</p>
        <p>Take a look at your Integration Workshop in the portal to capture what you learned while it's still fresh.</p>
        ${cleanupBlock}`;
      break;

    case 'Family':
      subject = `${travelerName || 'Your family member'} is home from ${tripName}`;
      body = `
        <p><strong>${travelerName || 'Your family member'}</strong>'s trip to <strong>${destStr}</strong> is now complete. They're safely home.</p>`;
      break;

    default:
      subject = `${tripName} is complete`;
      body = `<p>The trip to <strong>${destStr}</strong> is now complete.</p>`;
  }
  const html = emailHTML(subject, tripName, body, null, null, tripPhotoUrl);
  return { subject, html };
}

function buildRoleStartEmail(role, ctx, recipientEmail) {
  const { tripId, tripName, destination, country, startDate, endDate, travelerName, pin, tripPhotoUrl, specialVersion } = ctx;
  const destStr = destination + (country ? ', ' + country : '');
  const isWildlife = specialVersion === 'Animals';

  // Wildlife tracker PIN block — only include for Animals-type trips.
  // Non-wildlife trips (Arizona road trips, cultural travel, etc.) don't need
  // the wildlife tracker in the kickoff email.
  const attribution = recipientEmail && role
    ? `&loggedByEmail=${encodeURIComponent(recipientEmail)}&loggedByRole=${encodeURIComponent(role)}`
    : '';
  const trackerUrl = pin ? `https://app.transformedbytravels.com/wildlife-tracker.html?pin=${encodeURIComponent(pin)}${attribution}` : '';
  const pinBlock = (isWildlife && pin) ? `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin:16px 0;text-align:center;">
      <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Trip PIN</div>
      <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:0.15em;color:#0f172a;">${pin}</div>
      ${trackerUrl ? `<a href="${trackerUrl}" style="display:inline-block;margin-top:10px;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-weight:700;font-size:13px;text-decoration:none;padding:9px 20px;border-radius:6px;">Open Wildlife Tracker →</a>` : ''}
    </div>` : '';

  // Day-by-day schedule view — trip.html scoped to this recipient's email
  const scheduleUrl = (tripId && recipientEmail)
    ? `${PORTAL_URL}/trip.html?tripId=${encodeURIComponent(tripId)}&email=${encodeURIComponent(recipientEmail)}`
    : '';
  const scheduleBlock = scheduleUrl ? `
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 18px;margin:16px 0;text-align:center;">
      <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#0284c7;margin-bottom:8px;">Your Day-by-Day Schedule</div>
      <a href="${scheduleUrl}" style="display:inline-block;background:#0284c7;color:#fff;font-family:Arial,sans-serif;font-weight:700;font-size:13px;text-decoration:none;padding:9px 20px;border-radius:6px;">View My Trip →</a>
    </div>` : '';

  const datesLine = startDate ? `${startDate}${endDate ? ' – ' + endDate : ''}` : '';

  // Wildlife-related helper copy only shown for Animals trips
  const wildlifeIntro       = isWildlife ? '<p>Use the PIN below to check in on their wildlife sightings whenever you\'d like.</p>' : '';
  const wildlifeGuideIntro  = isWildlife ? '<p>Log sightings on their behalf using the tracker below — your entries will be attributed to you as Tour Guide.</p>' : '';
  const wildlifeCoIntro     = isWildlife ? '<p>Use the PIN below to log wildlife sightings during the trip.</p>' : '';
  const wildlifeFamilyIntro = isWildlife ? '<p>Follow along using the PIN below — you\'ll see their wildlife sightings and photos as they add them.</p>' : '';

  let subject, body;
  switch (role) {
    case 'Coach':
      subject = `${travelerName || 'Your client'}'s trip to ${tripName} has started`;
      body = `
        <p><strong>${travelerName || 'Your client'}</strong> has begun their trip to <strong>${destStr}</strong>${datesLine ? ` (${datesLine})` : ''}. Their daily journal is now active.</p>
        ${scheduleBlock}
        ${wildlifeIntro}
        ${pinBlock}
        <p style="color:#64748b;font-size:13px;">You're not on any daily reminder cadence — just here if they need you.</p>`;
      break;

    case 'Tour Guide':
      subject = `You're now guiding ${travelerName || 'a traveler'}'s trip: ${tripName}`;
      body = `
        <p>You're now on assignment for <strong>${travelerName || 'the traveler'}</strong>'s trip to <strong>${destStr}</strong>${datesLine ? ` (${datesLine})` : ''}.</p>
        ${scheduleBlock}
        ${wildlifeGuideIntro}
        ${pinBlock}
        <p style="color:#64748b;font-size:13px;">Your Tour Guide portal shows all trips you're guiding: <a href="https://app.transformedbytravels.com/portal.html?page=tour-guide-home" style="color:#0d9488;">My Guided Trips</a>.</p>`;
      break;

    case 'Co-traveler':
      subject = `Your trip to ${tripName} has begun!`;
      body = `
        <p>Your trip to <strong>${destStr}</strong>${datesLine ? ` (${datesLine})` : ''} is now underway. Daily journal support is active for the group.</p>
        ${scheduleBlock}
        ${wildlifeCoIntro}
        ${pinBlock}`;
      break;

    case 'Family':
      subject = `${travelerName || 'Your family member'}'s trip has begun`;
      body = `
        <p><strong>${travelerName || 'Your family member'}</strong> has begun their trip to <strong>${destStr}</strong>${datesLine ? ` (${datesLine})` : ''}.</p>
        ${scheduleBlock}
        ${wildlifeFamilyIntro}
        ${pinBlock}`;
      break;

    default:
      subject = `${tripName} has begun`;
      body = `
        <p>The trip to <strong>${destStr}</strong>${datesLine ? ` (${datesLine})` : ''} is now underway.</p>
        ${scheduleBlock}
        ${pinBlock}`;
  }
  const html = emailHTML(subject, tripName, body, null, null, tripPhotoUrl);
  return { subject, html };
}

function sendEmail(to, name, subject, html, callback) {
  const apiKey  = process.env.RESEND_API_KEY;
  const body    = JSON.stringify({ from: 'Michael at Three Realms Travel <michael@transformedbytravels.com>', to, subject, html });
  const options = {
    hostname: 'api.resend.com',
    path:     '/emails',
    method:   'POST',
    headers: {
      'Authorization':  'Bearer ' + apiKey,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  const req = https.request(options, (resend) => {
    let data = '';
    resend.on('data', chunk => { data += chunk; });
    resend.on('end', () => {
      console.log('[sendEmail] Resend status:', resend.statusCode, 'body:', data);
      callback(null);
    });
  });
  req.on('error', e => { console.error('[sendEmail] HTTPS error:', e.message); callback(e); });
  req.write(body);
  req.end();
}

function emailHTML(title, heading, body, btnText, btnUrl, photoUrl) {
  const btn = btnText && btnUrl
    ? `<tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="${btnUrl}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">${btnText}</a>
      </td></tr>`
    : `<tr><td style="padding:0 40px 36px;text-align:center;">
        <a href="${PORTAL_URL}/portal.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Go to My Portal</a>
      </td></tr>`;
  const photoRow = photoUrl
    ? `<tr><td style="padding:0;"><img src="${photoUrl}" alt="" style="width:100%;max-height:220px;object-fit:cover;display:block;" /></td></tr>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
${photoRow}
${!photoUrl ? `<tr><td style="background:#ffffff;padding:30px;text-align:center;border-bottom:3px solid #2dd4bf;">
<img src="https://threerealmstravel.com/threerealms/realm-symbols/logo.png" height="72" alt="Three Realms Travel" /></td></tr>` : ''}
<tr><td style="padding:36px 40px;">
<h2 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 16px;">${heading}</h2>
<div style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;">${body}</div>
</td></tr>
${btn}
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr></table></td></tr></table></body></html>`;
}

// ── Handler ───────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET ?action=reminders — daily cron: 3-day, 1-day, same-day activation nudges
  // GET ?action=debug-reminders — returns what trips the cron would find, without sending emails
  if (req.method === 'GET' && req.query.action === 'debug-reminders') {
    const todayStr     = dateOffsetStr(0);
    const tomorrowStr  = dateOffsetStr(1);
    const threeDayStr  = dateOffsetStr(3);
    const yesterdayStr = dateOffsetStr(-1);
    const results = { dates: { today: todayStr, tomorrow: tomorrowStr, threeDays: threeDayStr, yesterday: yesterdayStr }, sameDay: [], oneDay: [], threeDay: [], postTrip: [] };
    let pending = 4;
    const finish = () => { if (--pending === 0) res.status(200).json(results); };
    const f1 = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${todayStr}")`);
    const f2 = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${tomorrowStr}")`);
    const f3 = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${threeDayStr}")`);
    const f4 = encodeURIComponent(`AND(OR({Status of Trip}="Active",{Status of Trip}="Completed"),DATESTR({End Date})="${yesterdayStr}")`);
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${f1}`, null, (e, d) => { results.sameDay  = d || { error: e && e.message }; finish(); });
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${f2}`, null, (e, d) => { results.oneDay   = d || { error: e && e.message }; finish(); });
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${f3}`, null, (e, d) => { results.threeDay = d || { error: e && e.message }; finish(); });
    airtableRequest('GET', TRIPS_TABLE, `?filterByFormula=${f4}`, null, (e, d) => { results.postTrip = d || { error: e && e.message }; finish(); });
    return;
  }

  if (req.method === 'GET' && req.query.action === 'reminders') {
    const todayStr      = dateOffsetStr(0);
    const tomorrowStr   = dateOffsetStr(1);
    const threeDayStr   = dateOffsetStr(3);
    const yesterdayStr  = dateOffsetStr(-1);

    let completed = 0;
    const done = () => { if (++completed === 4) res.status(200).json({ success: true }); };

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const headers = { 'Authorization': 'Bearer ' + apiKey };

    async function fetchTravelerName(email) {
      try {
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRAVEL_TABLE)}?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`, { headers });
        const d = await r.json();
        const rec = (d.records || [])[0];
        return rec ? (rec.fields['Traveler Name'] || 'Traveler') : 'Traveler';
      } catch(e) { return 'Traveler'; }
    }

    function sendEmailAsync(to, name, subject, html) {
      return new Promise(resolve => sendEmail(to, name, subject, html, resolve));
    }

    async function fetchTemplateAsync(code) {
      try {
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(EMAILS_TABLE)}?filterByFormula=${encodeURIComponent(`({Code}="${code}")`)}`, { headers });
        const d = await r.json();
        const rec = (d.records || [])[0];
        if (!rec) return null;
        const f = rec.fields;
        return { subject: f['Subject'] || '', p1: f['Paragraph 1'] || '', p2: f['Paragraph 2'] || '', p3: f['Paragraph 3'] || '' };
      } catch(e) { return null; }
    }

    // Email the trip's coach a "start the trip" prompt (links to the kickoff modal).
    async function notifyCoachKickoff(rec, f, whenLabel) {
      try {
        const travelerEmail = (f['Traveler Email'] || '').toLowerCase().trim();
        if (!travelerEmail) return;
        const tr   = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRAVEL_TABLE)}?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${travelerEmail}"`)}&maxRecords=1`, { headers });
        const td   = await tr.json();
        const trav = (td.records || [])[0];
        const coachEmail = (trav && trav.fields && trav.fields['Coach Email'] || '').toLowerCase().trim();
        if (!coachEmail) return;
        const travelerName = (trav && trav.fields && trav.fields['Traveler Name']) || travelerEmail;
        const coachName    = await fetchTravelerName(coachEmail);
        const tripName     = f['Trip Name'] || f['Destination'] || 'the trip';
        const kickoffUrl   = `${PORTAL_URL}/portal.html?kickoffTripId=${rec.id}`;
        const subject      = `Time to start ${travelerName}'s trip — ${tripName}`;
        const html = emailHTML(subject, `${tripName} starts ${whenLabel}`,
          `<p>Hi ${String(coachName).split(' ')[0]}, <strong>${travelerName}</strong>'s trip to <strong>${tripName}</strong> starts ${whenLabel}. When you're ready, start it to kick off their daily journal, live sighting tracking, and trip support — everyone on the trip gets notified.</p>`,
          'Start the Trip →', kickoffUrl);
        await sendEmailAsync(coachEmail, coachName, subject, html);
        console.log('[coach-kickoff] sent to', coachEmail, tripName, whenLabel);
      } catch(e) { console.error('[coach-kickoff]', e.message); }
    }

    // Email the trip's Tour Guide(s) a pre-trip brief: who's coming + their Top 5.
    async function notifyTourGuideBrief(rec, f) {
      try {
        const tripId = rec.id;
        const gm = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MEMBERS_TABLE)}?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Role}="Tour Guide",{Status}="Accepted")`)}`, { headers });
        const gd = await gm.json();
        const guides = [...new Set((gd.records || []).map(r => (r.fields['Email'] || '').toLowerCase()).filter(Boolean))];
        if (!guides.length) return;
        const travelerEmail = (f['Traveler Email'] || '').toLowerCase();
        const travelerName  = await fetchTravelerName(travelerEmail) || travelerEmail;
        const destStr  = [f['Destination'], f['Country']].filter(Boolean).join(', ');
        const tripName = f['Trip Name'] || destStr || 'the trip';
        const dates    = [f['Start Date'], f['End Date']].filter(Boolean).join(' → ');
        const top5     = Array.isArray(f['Species Name (from Wishlist Species)']) ? f['Species Name (from Wishlist Species)'] : [];
        const top5Html = top5.length
          ? `<ul style="margin:8px 0 0;padding-left:20px;">${top5.map(s => `<li style="font-size:14px;color:#0f172a;margin:3px 0;">${s}</li>`).join('')}</ul>`
          : `<p style="font-size:14px;color:#64748b;margin:6px 0 0;">No Top 5 wishlist set yet — worth asking them.</p>`;
        const guideUrl = `${PORTAL_URL}/portal.html?page=tour-guide-home`;
        const subject  = `Trip brief — you're guiding ${travelerName} soon`;
        const body = `<p>You're guiding <strong>${travelerName}</strong>'s trip to <strong>${destStr || tripName}</strong>${dates ? `, <strong>${dates}</strong>` : ''} — just 3 days away.</p>
          <p style="margin-top:14px;"><strong>Their Top 5 target animals:</strong></p>${top5Html}
          <p style="margin-top:16px;">Have a look so you can plan where and when to find them. Your guided trips are all in the portal.</p>`;
        const html = emailHTML(subject, `Trip brief: ${tripName}`, body, 'Open My Guided Trips →', guideUrl, f['Trip Photo URL'] || '');
        for (const g of guides) await sendEmailAsync(g, '', subject, html);
        console.log('[guide-brief] sent to', guides.join(','), tripName);
      } catch(e) { console.error('[guide-brief]', e.message); }
    }

    // Own-voiced pre-trip reminder to co-travelers/partners (NOT the traveler-voiced
    // copy). Coach + Tour Guide are intentionally excluded — they get dedicated emails.
    async function notifyPartnerReminder(rec, f, whenLabel) {
      try {
        const tripId = rec.id;
        const mResp = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MEMBERS_TABLE)}?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Status}="Accepted")`)}`, { headers });
        const md = await mResp.json();
        const partners = [...new Set((md.records || [])
          .filter(r => ['Co-traveler', 'Partner'].includes(r.fields['Role']))
          .map(r => (r.fields['Email'] || '').toLowerCase()).filter(Boolean))];
        if (!partners.length) return;
        const travelerName = await fetchTravelerName((f['Traveler Email'] || '').toLowerCase());
        const destStr  = [f['Destination'], f['Country']].filter(Boolean).join(', ');
        const tripName = f['Trip Name'] || destStr || 'the trip';
        const dates    = [f['Start Date'], f['End Date']].filter(Boolean).join(' → ');
        const portalUrl = `${PORTAL_URL}/portal.html`;
        const subject = `${travelerName}'s trip to ${tripName} is ${whenLabel}`;
        const prep = whenLabel === 'in 3 days'
          ? 'A good moment to make sure your details are set and download anything you\'ll want offline.'
          : 'Get ready — it\'s almost time.';
        const body = `<p>You're joining <strong>${travelerName}</strong> on the trip to <strong>${destStr || tripName}</strong>${dates ? `, <strong>${dates}</strong>` : ''} — it's <strong>${whenLabel}</strong>!</p>
          <p>${prep} Everything's in your portal.</p>`;
        const html = emailHTML(subject, subject, body, 'Open My Portal →', portalUrl, f['Trip Photo URL'] || '');
        for (const p of partners) await sendEmailAsync(p, '', subject, html);
        console.log('[partner-reminder]', whenLabel, '→', partners.join(','));
      } catch(e) { console.error('[partner-reminder]', e.message); }
    }

    // ── 1. Same-day nudge: trip starts today, not yet activated ───────
    (async () => {
      try {
        const formula = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${todayStr}")`);
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}?filterByFormula=${formula}`, { headers });
        const data = await r.json();
        for (const rec of (data.records || [])) {
          const f = rec.fields;
          const email = f['Traveler Email'];
          if (!email) continue;
          const tripName    = f['Trip Name'] || f['Destination'] || 'your trip';
          const activateUrl = `${PORTAL_URL}/portal.html?page=my-trip`;
          const name        = await fetchTravelerName(email);
          const subject     = `Today is the day — activate your trip to ${tripName}!`;
          const html        = emailHTML(subject, `Your trip starts today, ${name}!`,
            `<p>Your trip to <strong>${tripName}</strong> begins today. Don't forget to activate it in your portal so your daily journal reminders and trip support can begin.</p>`,
            'Activate My Trip →', activateUrl);
          await sendEmailAsync(email, name, subject, html);
          await notifyPartnerReminder(rec, f, 'today');
          console.log('[same-day] sent to', email, tripName);
        }
      } catch(e) { console.error('[same-day]', e.message); }
      done();
    })();

    // ── 2. One-day reminder: starts tomorrow ──────────────────────────
    (async () => {
      try {
        const formula = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${tomorrowStr}")`);
        const [tripsResp, tmpl] = await Promise.all([
          fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}?filterByFormula=${formula}`, { headers }),
          fetchTemplateAsync('TRIP_REMINDER_1DAY')
        ]);
        const data = await tripsResp.json();
        for (const rec of (data.records || [])) {
          const f           = rec.fields;
          const email       = f['Traveler Email'];
          if (!email) continue;
          const destination = f['Destination'] || '';
          const country     = f['Country']     || '';
          const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
          const startDate   = f['Start Date']  || tomorrowStr;
          const photoUrl    = f['Trip Photo URL'] || '';
          const activateUrl = `${PORTAL_URL}/portal.html?page=my-trip`;
          const name        = await fetchTravelerName(email);
          const vars        = { name, tripName, destination, country, startDate };
          const para        = text => text ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${substitute(text, vars).replace(/\n/g, '<br>')}</p>` : '';
          let subject, bodyContent;
          if (tmpl) {
            subject     = substitute(tmpl.subject, vars) || `Your trip to ${tripName} starts tomorrow!`;
            bodyContent = para(tmpl.p1) + para(tmpl.p2) + para(tmpl.p3);
          } else {
            subject     = `Your trip to ${tripName} starts tomorrow!`;
            bodyContent = `<p>Just a reminder — your trip to <strong>${tripName}</strong> begins tomorrow. Activate it in your portal to start your daily journal reminders.</p>`;
          }
          const pendingBlock1 = await buildPendingInvitesBlock(rec.id, headers);
          const html = emailHTML(subject, subject, bodyContent + pendingBlock1, 'Start My Trip →', activateUrl, photoUrl);
          await sendEmailAsync(email, name, subject, html);
          await notifyPartnerReminder(rec, f, 'tomorrow');
          console.log('[1-day] sent to', email, tripName);
        }
      } catch(e) { console.error('[1-day]', e.message); }
      done();
    })();

    // ── 3. Three-day notice ───────────────────────────────────────────
    (async () => {
      try {
        const formula = encodeURIComponent(`AND(OR({Status of Trip}="Committed",{Status of Trip}="Planned",{Status of Trip}="Research"),DATESTR({Start Date})="${threeDayStr}")`);
        const [tripsResp, tmpl] = await Promise.all([
          fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}?filterByFormula=${formula}`, { headers }),
          fetchTemplateAsync('TRIP_REMINDER_3DAY')
        ]);
        const data = await tripsResp.json();
        for (const rec of (data.records || [])) {
          const f           = rec.fields;
          const email       = f['Traveler Email'];
          if (!email) continue;
          const destination = f['Destination'] || '';
          const country     = f['Country']     || '';
          const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
          const startDate   = f['Start Date']  || threeDayStr;
          const photoUrl    = f['Trip Photo URL'] || '';
          const activateUrl = `${PORTAL_URL}/portal.html?page=my-trip&tripId=${rec.id}&action=prepare-offline`;
          const name        = await fetchTravelerName(email);
          const vars        = { name, tripName, destination, country, startDate };
          const para        = text => text ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${substitute(text, vars).replace(/\n/g, '<br>')}</p>` : '';
          let subject, bodyContent;
          if (tmpl) {
            subject     = substitute(tmpl.subject, vars) || `Your trip to ${tripName} is in 3 days!`;
            bodyContent = para(tmpl.p1) + para(tmpl.p2) + para(tmpl.p3);
          } else {
            subject     = `Your trip to ${tripName} is in 3 days — prepare your wildlife guide`;
            bodyContent = `<p>Your trip to <strong>${tripName}</strong> starts on <strong>${startDate}</strong> — just 3 days away!</p>
                           <p>While you're still at home on good wifi, tap the button below to download your <strong>offline wildlife guide</strong>. It bundles the species catalog and photos for every stop on your itinerary, so you can identify what you're seeing even when there's no signal in the field.</p>`;
          }
          const pendingBlock3 = await buildPendingInvitesBlock(rec.id, headers);
          const html = emailHTML(subject, subject, bodyContent + pendingBlock3, '📥 Download Wildlife Guide →', activateUrl, photoUrl);
          await sendEmailAsync(email, name, subject, html);
          await notifyPartnerReminder(rec, f, 'in 3 days');
          await notifyTourGuideBrief(rec, f);
          console.log('[3-day] sent to', email, tripName);
        }
      } catch(e) { console.error('[3-day]', e.message); }
      done();
    })();

    // ── 4. Post-trip summary: trip ended yesterday ────────────────────
    const postTripFormula = encodeURIComponent(
      `AND(OR({Status of Trip}="Active",{Status of Trip}="Completed"),DATESTR({End Date})="${yesterdayStr}")`
    );
    (async () => {
      try {
        const apiKey  = process.env.AIRTABLE_API_KEY;
        const headers = { 'Authorization': 'Bearer ' + apiKey };

        const tripsResp = await fetch(
          `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}?filterByFormula=${postTripFormula}`,
          { headers }
        );
        const tripsData = await tripsResp.json();

        for (const r of (tripsData.records || [])) {
          const f     = r.fields;
          const email = f['Traveler Email'];
          if (!email) continue;

          const destination = f['Destination'] || '';
          const country     = f['Country']     || '';
          const tripName    = f['Trip Name']   || (destination + (country ? ', ' + country : ''));
          const startDate   = f['Start Date']  || '';
          const endDate     = f['End Date']    || yesterdayStr;

          const travFilter    = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
          const journalFilter = `?filterByFormula=${encodeURIComponent(`({Trip ID}="${r.id}")`)}` +
                                `&sort[0][field]=Entry%20Date&sort[0][direction]=asc`;

          const [travResp, journalResp] = await Promise.all([
            fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRAVEL_TABLE)}${travFilter}`, { headers }),
            fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent('Journal Entries')}${journalFilter}`, { headers })
          ]);
          const [travData, journalData] = await Promise.all([travResp.json(), journalResp.json()]);

          const travRec = (travData.records || [])[0];
          const name    = travRec ? (travRec.fields['Traveler Name'] || 'Traveler') : 'Traveler';
          const entries = (journalData.records || []).filter(e => e.fields['Reflection'] || e.fields['Best Memory']);

          let summaryHtml = '';
          if (entries.length > 0) {
            const entriesText = entries.map((e, i) => {
              const ef    = e.fields;
              const parts = [];
              if (ef['Reflection'])   parts.push(`Reflection: ${ef['Reflection']}`);
              if (ef['Barriers'])     parts.push(`Barriers: ${ef['Barriers']}`);
              if (ef['Best Memory'])  parts.push(`Best memory: ${ef['Best Memory']}`);
              return `Day ${ef['Day Number'] || (i + 1)}:\n${parts.join('\n')}`;
            }).join('\n\n');

            const summaryText = await generatePostTripSummary(name, tripName, entriesText);
            summaryHtml = summaryText.split('\n').filter(l => l.trim()).map(line =>
              `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${line.trim()}</p>`
            ).join('');
          }

          const subject = `Your journey to ${tripName} — a reflection`;
          const portalUrl = `${PORTAL_URL}/portal.html`;
          const html = emailHTML(subject, `Welcome home, ${name}!`,
            `<p>Your trip to <strong>${tripName}</strong>${startDate ? ` (${startDate} – ${endDate})` : ''} is now complete. Here's a reflection on your journey:</p>
             ${summaryHtml || `<p>What an incredible journey — we hope it was everything you imagined and more.</p>`}
             <p>Now is the perfect time to complete your <strong>Integration Workshop</strong> to capture the lasting insights from your travels.</p>`,
            'Start Integration Workshop →', portalUrl + '?page=integration'
          );

          sendEmail(email, name, subject, html, async () => {
            await sendToTripMembers(r.id, email, subject, html);
          });
          console.log('[post-trip summary] sent to', email, tripName);

          // Coach post-trip wrap-up — the traveler's reflection + a debrief prompt.
          try {
            const cTrav = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRAVEL_TABLE)}?filterByFormula=${encodeURIComponent(`LOWER({Traveler Email})="${email.toLowerCase()}"`)}&maxRecords=1`, { headers });
            const cData = await cTrav.json();
            const coachEmail = ((cData.records || [])[0]?.fields?.['Coach Email'] || '').toLowerCase().trim();
            if (coachEmail) {
              const coachName = await fetchTravelerName(coachEmail);
              const cSubject  = `${name}'s journey is complete — a coach debrief`;
              const cHtml = emailHTML(cSubject, `${name}'s trip is complete`,
                `<p>Hi ${String(coachName).split(' ')[0]}, <strong>${name}</strong>'s trip to <strong>${tripName}</strong>${startDate ? ` (${startDate} – ${endDate})` : ''} has wrapped up. Here's the reflection they received:</p>
                 ${summaryHtml || `<p>They completed their journey — a great moment to reach out.</p>`}
                 <p>A good time to follow up, celebrate what they experienced, and note anything for their next journey in your coach journal.</p>`,
                'Open your coach journal →', `${PORTAL_URL}/portal.html?page=planner&coachTripId=${r.id}`);
              await sendEmailAsync(coachEmail, coachName, cSubject, cHtml);
              console.log('[coach-wrapup] sent to', coachEmail, tripName);
            }
          } catch(e) { console.error('[coach-wrapup]', e.message); }

          // Auto-flip the trip to Completed so daily/last-day reminders stop.
          if ((f['Status of Trip'] || '') !== 'Completed') {
            try {
              const patchResp = await fetch(
                `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}/${r.id}`,
                {
                  method: 'PATCH',
                  headers: { ...headers, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fields: { 'Status of Trip': 'Completed' } })
                }
              );
              if (!patchResp.ok) {
                console.error('[post-trip summary] status flip failed for', r.id, await patchResp.text());
              } else {
                console.log('[post-trip summary] status → Completed for', r.id, tripName);
              }
            } catch(e) {
              console.error('[post-trip summary] status flip error for', r.id, e.message);
            }
          }
        }
      } catch(e) {
        console.error('[post-trip summary]', e.message);
      }
      done();
    })();

    return;
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b      = req.body || {};
  const action = (b.action || '').slice(0, 50);
  const tripId = (b.tripId || '').slice(0, 100);
  const email  = (b.email  || '').toLowerCase().trim().slice(0, 200);

  // ── Resend Kickoff — send the role-tailored start email to one member ──
  // For members who missed the original kickoff. If the member is still Pending,
  // includes an "accept your invite" callout above the kickoff content.
  if (action === 'resend-kickoff') {
    const memberId = (b.memberId || '').slice(0, 100);
    if (!tripId || !memberId) return res.status(400).json({ error: 'tripId and memberId required' });
    try {
      const apiKey = process.env.AIRTABLE_API_KEY;
      const headers = { 'Authorization': 'Bearer ' + apiKey };

      const memberRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(MEMBERS_TABLE)}/${memberId}`, { headers });
      const memberData = await memberRes.json();
      if (memberData.error) return res.status(404).json({ error: 'Member not found' });
      const mf = memberData.fields || {};
      const memberEmail  = (mf['Email'] || '').toLowerCase().trim();
      const memberRole   = mf['Role'] || 'Co-traveler';
      const memberStatus = mf['Status'] || 'Invited';
      const inviteToken  = mf['Invite Token'];
      if (!memberEmail) return res.status(400).json({ error: 'Member has no email' });

      const tripRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TRIPS_TABLE)}/${tripId}`, { headers });
      const tripData = await tripRes.json();
      if (tripData.error) return res.status(404).json({ error: 'Trip not found' });
      const tf = tripData.fields || {};

      const ctx = {
        tripId,
        tripName:       tf['Trip Name'] || 'your trip',
        destination:    tf['Destination'] || '',
        country:        tf['Country'] || '',
        startDate:      tf['Start Date'] || '',
        endDate:        tf['End Date'] || '',
        travelerName:   tf['Traveler Name'] || '',
        pin:            tf['PIN'] || '',
        tripPhotoUrl:   tf['Trip Photo URL'] || null,
        specialVersion: tf['Special Version'] || '',
      };

      const { subject, html } = buildRoleStartEmail(memberRole, ctx, memberEmail);

      let finalHtml = html;
      if (memberStatus !== 'Accepted' && inviteToken) {
        const acceptUrl = `${PORTAL_URL}/portal.html?accept-trip=${inviteToken}&email=${encodeURIComponent(memberEmail)}`;
        const banner = `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;margin:0 0 18px;border-radius:6px;">
          <div style="font-family:Arial,sans-serif;font-weight:700;color:#92400e;margin-bottom:6px;">You haven't accepted your invite yet</div>
          <div style="font-family:Arial,sans-serif;font-size:14px;color:#78350f;line-height:1.55;margin-bottom:10px;">The trip has already started. Accept your invite to join in and use the trip PIN below:</div>
          <a href="${acceptUrl}" style="display:inline-block;background:#f59e0b;color:#fff;font-family:Arial,sans-serif;font-weight:700;font-size:13px;text-decoration:none;padding:10px 20px;border-radius:6px;">Accept invite →</a>
        </div>`;
        finalHtml = /<body[^>]*>/i.test(finalHtml)
          ? finalHtml.replace(/<body([^>]*)>/i, `<body$1>${banner}`)
          : banner + finalHtml;
      }

      return new Promise(resolve => {
        sendEmail(memberEmail, '', subject, finalHtml, (err) => {
          if (err) { res.status(500).json({ error: err.message }); }
          else     { res.status(200).json({ success: true, email: memberEmail, status: memberStatus }); }
          resolve();
        });
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (!action || !tripId || !email) return res.status(400).json({ error: 'action, tripId, email required' });

  // ── Journey Book — photo upload QR email ────────────────────────────────
  if (action === 'journey-book-photos') {
    const photosUrl = `${PORTAL_URL}/journey-book.html?tripId=${tripId}&photos=1`;
    const qrSrc     = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(photosUrl)}&margin=12`;
    const subject   = 'Upload your trip photos to your Journey Book';
    let tripPhotoUrl = null;
    try {
      const apiKey = process.env.AIRTABLE_API_KEY;
      const tr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Trips/${tripId}`, { headers: { 'Authorization': 'Bearer ' + apiKey } });
      const td = await tr.json();
      tripPhotoUrl = td.fields?.['Trip Photo URL'] || null;
    } catch(e) {}
    const html = emailHTML(
      subject,
      'Add Your Trip Photos',
      `<p>Your Journey Book has been set up and is ready for your photos.</p>
       <p>Scan the QR code below on your iPhone to open the photo uploader — then tap each slot to add photos straight from your camera roll.</p>
       <div style="text-align:center;margin:28px 0 20px;">
         <img src="${qrSrc}" width="200" height="200" alt="Scan to upload photos" style="border-radius:10px;display:inline-block;" />
         <div style="font-size:12px;color:#94a3b8;margin-top:10px;">Scan with your iPhone camera</div>
       </div>
       <p style="font-size:13px;color:#94a3b8;text-align:center;">Or tap the button below to open on any device.</p>`,
      'Open Photo Uploader →',
      photosUrl,
      tripPhotoUrl
    );
    await sendToPartners(tripId, email, subject, html);
    return new Promise(resolve => {
      sendEmail(email, email, subject, html, (err) => {
        if (err) { res.status(500).json({ error: err.message }); }
        else     { res.status(200).json({ ok: true }); }
        resolve();
      });
    });
  }

  // ── Journey Book — build link ────────────────────────────────────────────
  if (action === 'journey-book' || action === 'journey-book-view') {
    const isView   = action === 'journey-book-view';
    const bookUrl  = `${PORTAL_URL}/journey-book.html?tripId=${tripId}${isView ? '&view=1' : ''}`;
    const subject  = isView ? 'Your Journey Book is ready to view' : 'Your Journey Book is ready to build';
    let tripPhotoUrl = null;
    try {
      const apiKey = process.env.AIRTABLE_API_KEY;
      const tr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Trips/${tripId}`, { headers: { 'Authorization': 'Bearer ' + apiKey } });
      const td = await tr.json();
      tripPhotoUrl = td.fields?.['Trip Photo URL'] || null;
    } catch(e) {}
    const html = isView
      ? emailHTML(
          subject,
          'Your Journey Book is Ready',
          `<p>Your Journey Book has been finished — relive every moment of your trip through photos, maps, and your own words.</p>
           <p>Click the button below to open your personal digital book. You can page through it, share it, and download a PDF copy to keep forever.</p>`,
          'Open My Journey Book →',
          bookUrl,
          tripPhotoUrl
        )
      : emailHTML(
          subject,
          'Build Your Journey Book',
          `<p>We will turn your trip photos and memories into a beautiful digital book that will forever remind you of your time on travel.</p>
           <p>Click the button below to start building — add your photos, adjust the layout, and let AI help you capture your story in words. It only takes a few minutes per day.</p>
           <p style="font-size:13px;color:#94a3b8;">You can return to this link anytime — your progress is saved automatically.</p>`,
          'Build My Journey Book →',
          bookUrl,
          tripPhotoUrl
        );
    await sendToPartners(tripId, email, subject, html);
    return new Promise(resolve => {
      sendEmail(email, email, subject, html, (err) => {
        if (err) { res.status(500).json({ error: err.message }); }
        else     { res.status(200).json({ ok: true }); }
        resolve();
      });
    });
  }

  const today  = new Date().toISOString().split('T')[0];
  const status = action === 'start' ? 'Active' : 'Completed';

  const fields = { 'Status of Trip': status };
  if (action === 'start') {
    // Guard: block activation more than 1 day before the planned Start Date.
    // Activating early causes journal prompts to fire for days before the
    // trip actually happens ("1st day in Kanab" 30 days out).
    try {
      const check = await new Promise(resolve => {
        airtableRequest('GET', TRIPS_TABLE, `/${tripId}`, null, (err, data) => resolve(err || !data ? {} : data));
      });
      const plannedStart = (check.fields || {})['Start Date'];
      if (plannedStart) {
        const todayD = new Date(today + 'T00:00:00Z');
        const startD = new Date(plannedStart + 'T00:00:00Z');
        const daysUntil = Math.round((startD - todayD) / 86400000);
        if (daysUntil > 1) {
          const dayBefore = new Date(startD);
          dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
          const canActivateOn = dayBefore.toISOString().split('T')[0];
          return res.status(400).json({
            error: `This trip is scheduled to start on ${plannedStart}. You can activate it starting ${canActivateOn} (one day before). Activating earlier causes daily journal prompts to fire on the wrong days.`,
            plannedStart,
            canActivateOn,
          });
        }
      }
    } catch(e) {
      console.warn('[trip-action start] start-date guard threw, allowing:', e.message);
    }

    // Activation Date = when the trip was actually kicked off.
    // Start Date = planned trip start; must NOT be overwritten on kickoff,
    // or the banner will show today→end instead of the planned range.
    fields['Activation Date']  = today;
    fields['Journal Enabled']  = b.journalEnabled !== false;
    if (b.journalEnabled !== false) {
      if (b.journalTime) fields['Journal Time'] = String(b.journalTime);
      if (b.timezone)    fields['Time Zone']    = b.timezone;
    }
    if (b.coachNotes) fields['Coach Kickoff Notes'] = b.coachNotes;

    // Rule: only Coach can be on multiple concurrent Active trips.
    // For all other roles, block Kickoff if any member is already on another Active trip.
    try {
      const conflicts = await checkConflictingActiveTrips(tripId);
      if (conflicts.length) {
        const detail = conflicts.map(c =>
          `${c.email} (${c.role}) is on active trip "${c.otherTripName}"`
        ).join('; ');
        return res.status(409).json({
          error: 'One or more members are already on another Active trip: ' + detail + '. Complete or reassign those trips first, or remove the members from this trip.',
          conflicts,
        });
      }
    } catch(e) {
      console.warn('[trip-action start] conflict check threw, allowing kickoff:', e.message);
    }
  }
  if (action === 'end') {
    fields['End Date']       = today;
    fields['Trip Closed At'] = new Date().toISOString();
    if (b.tripRating) fields['Trip Rating'] = b.tripRating;
    // Coach's end-of-trip notes are dropped for now — add a Post-Trip Notes
    // field to Trips if you want to store them.
  }

  console.log('[trip-action start] fields being patched:', JSON.stringify(fields));
  // typecast:true so Airtable coerces e.g. string "19" → number for a Number field
  airtableRequest('PATCH', TRIPS_TABLE, `/${tripId}`, { fields, typecast: true }, (err, tripData) => {
    if (err) return res.status(500).json({ error: err.message });
    if (tripData.error) return res.status(500).json({ error: tripData.error.message || JSON.stringify(tripData.error) });

    const f               = tripData.fields || {};
    const destination     = f['Destination']       || 'your destination';
    const country         = f['Country']           || '';
    const tripName        = f['Trip Name']         || (destination + (country ? ', ' + country : ''));
    const startDate       = f['Start Date']        || today;
    const endDate         = f['End Date']          || '';
    const coTravelerEmail = (f['Co-Traveler Email'] || '').trim();
    const tripPhotoUrl    = f['Trip Photo URL'] || '';
    const specialVersion  = f['Special Version'] || '';

    const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
    airtableRequest('GET', TRAVEL_TABLE, filter, null, (err2, travelerData) => {
      const travelerRecord = travelerData && travelerData.records && travelerData.records[0];
      const name = travelerRecord ? (travelerRecord.fields['Traveler Name'] || 'Traveler') : 'Traveler';

      if (action === 'start' && b.phone && travelerRecord) {
        airtableRequest('PATCH', TRAVEL_TABLE, `/${travelerRecord.id}`, { fields: { 'Phone Number': b.phone } }, () => {});
      }

      if (action === 'end' && b.tripSummary) {
        const summaryFields = {
          'Traveler Email': email,
          'Entry Date':     today,
          'Entry Time':     new Date().toISOString().split('T')[1].substring(0, 5) + ' UTC',
          'Reflection':     b.tripSummary,
          'Entry Type':     'Trip Summary'
        };
        if (tripId) summaryFields['Trip ID'] = tripId;
        airtableRequest('POST', 'Journal Entries', '', { fields: summaryFields }, () => {});
      }

      if (action === 'start') {
        // Fetch places + generate Claude summary, then send rich activation email
        (async () => {
          const places  = await fetchTripPlaces(tripId);
          const summary = await generateTripSummary(destination, country, places, startDate, endDate);
          const details = tripDetailsBlock(destination, country, startDate, endDate, places);
          const pin = ((f['PIN'] || '') + '').trim();
          const summaryHtml = summary
            ? summary.split('\n').map(line => {
                const h = line.match(/^#+\s*(.+)/);
                if (h) return `<h3 style="font-family:Georgia,serif;font-size:16px;font-weight:bold;color:#0f172a;margin:0 0 8px;">${h[1]}</h3>`;
                return line.trim() ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;line-height:1.75;margin:0 0 18px;">${line.trim()}</p>` : '';
              }).join('')
            : '';
          const trackerUrl = pin ? `https://app.transformedbytravels.com/wildlife-tracker.html?pin=${encodeURIComponent(pin)}` : '';
          const pinBlock = pin ? `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin:16px 0;text-align:center;">
              <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Your Trip PIN</div>
              <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:0.15em;color:#0f172a;">${pin}</div>
              ${trackerUrl ? `<a href="${trackerUrl}" style="display:inline-block;margin-top:10px;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-weight:700;font-size:13px;text-decoration:none;padding:9px 20px;border-radius:6px;">Open My Trip →</a>` : ''}
            </div>` : '';
          const subject = `Your trip to ${tripName} has begun!`;
          const html = emailHTML(subject, `Bon Voyage, ${name}!`,
            `<p>Your trip to <strong>${tripName}</strong> is now underway. Your daily journal support has started — look for your first reflection prompt.</p>
             ${pinBlock}${details}${summaryHtml}
             <p>Safe travels — we hope this journey transforms you!</p>`,
            null, null, tripPhotoUrl);
          sendEmail(email, name, subject, html, async () => {
            // Send role-tailored emails to all Trip Members FIRST, then respond.
            // Vercel kills the function after res.json(), so any pending async
            // sends would be dropped.
            try {
              await sendRoleTailoredStartEmails(tripId, email, {
                tripId, tripName, destination, country, startDate, endDate,
                travelerName: name, pin, tripPhotoUrl, specialVersion,
              });
            } catch(e) {
              console.error('[start] role emails error:', e.message);
            }
            res.status(200).json({ success: true, action, tripName });
          });
        })().catch(err => {
          console.error('[start email]', err.message);
          res.status(200).json({ success: true, action, tripName });
        });

      } else {
        // End trip email — traveler first, then role-tailored to all members.
        const subject = `Welcome home from ${tripName}!`;
        const html = emailHTML(subject, `Welcome Home, ${name}!`,
          `<p>Your trip to <strong>${tripName}</strong> is now complete.</p>
           <p>We hope it was everything you imagined and more. Head to your portal to begin your Integration Workshop and capture the insights from your journey while they're still fresh.</p>
           <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin:16px 0;font-size:13px;color:#475569;line-height:1.55;">
             <strong style="color:#0f172a;">📱 One more thing:</strong> your phone's wildlife tracker has cached data for this trip. Open the tracker once more while online — it'll offer to clear it and free up space on your device.
           </div>`);
        sendEmail(email, name, subject, html, async () => {
          try {
            await sendRoleTailoredEndEmails(tripId, email, {
              tripName, destination, country, travelerName: name, tripPhotoUrl,
            });
          } catch(e) {
            console.error('[end] role emails error:', e.message);
          }
          res.status(200).json({ success: true, action, tripName });
        });
      }
    });
  });
};
