const https = require('https');

const BASE_ID = 'appdlxcWb45dIqNK2';

// ── Helpers ──────────────────────────────────────────────────────────────────

function airtableFetch(table, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const bodyStr = body ? JSON.stringify(body) : '';
    const options = {
      hostname: 'api.airtable.com',
      path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${path}`,
      method,
      headers: {
        'Authorization':  'Bearer ' + apiKey,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sendResend(to, subject, html) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.RESEND_API_KEY;
    const body   = JSON.stringify({ from: 'itinerary@transformedbytravels.com', to, subject, html });
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
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
    .slice(0, 6000); // cap at 6k chars for Claude
}

async function callClaude(prompt) {
  const body = JSON.stringify({
    model:      'claude-sonnet-4-6',
    max_tokens: 1000,
    messages:   [{ role: 'user', content: prompt }]
  });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(JSON.stringify(parsed.error)));
          resolve(parsed.content?.[0]?.text || '');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseClaudeJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch(e) { return null; }
}

// ── Confirmation email HTML ───────────────────────────────────────────────────

function buildConfirmationHtml(travelerName, tripName, parsed) {
  const typeLabel = parsed.type === 'flight' ? '✈️ Flight' : parsed.type === 'hotel' ? '🏨 Hotel' : parsed.type === 'car_rental' ? '🚗 Car Rental' : '📋 Reservation';
  const detailRows = [];

  if (parsed.type === 'flight') {
    if (parsed.airline)         detailRows.push(['Airline',    parsed.airline]);
    if (parsed.flight_number)   detailRows.push(['Flight',     parsed.flight_number]);
    if (parsed.from_airport)    detailRows.push(['From',       parsed.from_airport]);
    if (parsed.to_airport)      detailRows.push(['To',         parsed.to_airport]);
    if (parsed.departure_date)  detailRows.push(['Departure',  parsed.departure_date + (parsed.departure_time ? ' at ' + parsed.departure_time : '')]);
    if (parsed.arrival_date)    detailRows.push(['Arrival',    parsed.arrival_date   + (parsed.arrival_time   ? ' at ' + parsed.arrival_time   : '')]);
  } else if (parsed.type === 'hotel') {
    if (parsed.hotel_name)      detailRows.push(['Property',   parsed.hotel_name]);
    if (parsed.hotel_location)  detailRows.push(['Location',   parsed.hotel_location]);
    if (parsed.check_in_date)   detailRows.push(['Check-in',   parsed.check_in_date]);
    if (parsed.check_out_date)  detailRows.push(['Check-out',  parsed.check_out_date]);
    if (parsed.room_type)       detailRows.push(['Room',       parsed.room_type]);
  } else if (parsed.type === 'car_rental') {
    if (parsed.rental_company) detailRows.push(['Company',    parsed.rental_company]);
    if (parsed.car_type)       detailRows.push(['Vehicle',    parsed.car_type]);
    if (parsed.pickup_date)    detailRows.push(['Pickup',     parsed.pickup_date + (parsed.pickup_time ? ' at ' + parsed.pickup_time : '')]);
    if (parsed.pickup_location)detailRows.push(['Location',   parsed.pickup_location]);
    if (parsed.dropoff_date)   detailRows.push(['Return',     parsed.dropoff_date]);
  }
  if (parsed.confirmation_number) detailRows.push(['Confirmation #', parsed.confirmation_number]);

  const rows = detailRows.map(([label, val]) =>
    `<tr><td style="padding:6px 0;font-family:Arial,sans-serif;font-size:13px;color:#64748b;width:140px;">${label}</td>` +
    `<td style="padding:6px 0;font-family:Arial,sans-serif;font-size:13px;color:#0f172a;font-weight:bold;">${val}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0f172a;padding:28px 40px;">
  <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 6px;">Transformed by Travels</p>
  <h1 style="font-family:Georgia,serif;font-size:22px;color:#ffffff;margin:0;">${typeLabel} Added to Your Trip</h1>
</td></tr>
<tr><td style="padding:32px 40px;">
  <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 20px;">
    Hi ${travelerName || 'Traveler'}, we received your forwarded confirmation and added it to your <strong>${tripName || 'upcoming trip'}</strong>.
  </p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;padding:20px;margin-bottom:24px;">
    <tr><td style="padding:20px;">${rows ? `<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>` : `<p style="font-family:Arial,sans-serif;font-size:14px;color:#64748b;margin:0;">${parsed.summary || 'Details added to your trip.'}</p>`}</td></tr>
  </table>
  <p style="font-family:Arial,sans-serif;font-size:14px;color:#64748b;line-height:1.7;margin:0 0 24px;">
    Log in to your portal to review the details. If anything looks wrong, you can edit it there or reply to this email.
  </p>
  <a href="https://app.transformedbytravels.com/portal.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 28px;border-radius:8px;">View Your Trip →</a>
</td></tr>
<tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
  <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body || {};

    // Postmark webhook fields
    const fromEmail = ((payload.From || payload.FromFull?.Email || '')).toLowerCase().trim();
    const subject   = payload.Subject || '';
    const textBody  = payload.TextBody || '';
    const htmlBody  = payload.HtmlBody || '';
    const emailBody = textBody || stripHtml(htmlBody);

    console.log('parse-email: from=', fromEmail, 'subject=', subject.slice(0, 80));

    if (!fromEmail || !emailBody) {
      return res.status(400).json({ error: 'Missing from or body' });
    }

    // 1. Look up traveler by email
    const travelerData = await airtableFetch('Traveler',
      `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${fromEmail}")`)}`, 'GET');
    const travelerRec = (travelerData.records || [])[0];
    if (!travelerRec) {
      // Send a friendly "account not found" reply
      await sendResend(fromEmail, 'We couldn\'t find your account',
        `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;">We received your forwarded email but couldn't find a Transformed by Travels account for <strong>${fromEmail}</strong>. Please forward from your registered email address or log in to check your account email.</p>`);
      return res.status(200).json({ ok: true, note: 'traveler not found, reply sent' });
    }
    const travelerName = travelerRec.fields['First Name'] || travelerRec.fields['Name'] || '';

    // 2. Parse the reservation with Claude
    const prompt = `You are a travel reservation parser. Extract details from this forwarded email and return ONLY valid JSON — no explanation, no markdown fences.

Email Subject: ${subject}
Email Body:
${emailBody}

Return JSON in this exact format (use null for any field you cannot determine):
{
  "type": "flight or hotel or car_rental or other",
  "confirmation_number": "...",
  "passenger_name": "...",
  "airline": "...",
  "flight_number": "...",
  "from_airport": "...",
  "to_airport": "...",
  "departure_date": "YYYY-MM-DD",
  "departure_time": "HH:MM",
  "arrival_date": "YYYY-MM-DD",
  "arrival_time": "HH:MM",
  "hotel_name": "...",
  "hotel_location": "...",
  "check_in_date": "YYYY-MM-DD",
  "check_out_date": "YYYY-MM-DD",
  "room_type": "...",
  "rental_company": "...",
  "car_type": "...",
  "pickup_date": "YYYY-MM-DD",
  "pickup_time": "HH:MM",
  "dropoff_date": "YYYY-MM-DD",
  "pickup_location": "...",
  "summary": "One sentence summary of this reservation"
}`;

    const claudeText = await callClaude(prompt);
    const parsed     = parseClaudeJson(claudeText);
    console.log('parse-email: parsed=', JSON.stringify(parsed).slice(0, 300));

    if (!parsed || !parsed.type) {
      await sendResend(fromEmail, 'We couldn\'t read your confirmation',
        `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;">We received your email but had trouble reading the reservation details. Please try forwarding again, or log in to add the details manually.</p>`);
      return res.status(200).json({ ok: true, note: 'parse failed' });
    }

    // 3. Find the matching trip by date
    const keyDate = parsed.departure_date || parsed.check_in_date || parsed.pickup_date || null;
    let tripRec = null;
    if (keyDate) {
      const tripsData = await airtableFetch('Trips',
        `?filterByFormula=${encodeURIComponent(`AND({Traveler Email}="${fromEmail}",{Start Date}<="${keyDate}",{End Date}>="${keyDate}")`)}`, 'GET');
      tripRec = (tripsData.records || [])[0];

      // Fallback: nearest future trip if date match fails
      if (!tripRec) {
        const futureData = await airtableFetch('Trips',
          `?filterByFormula=${encodeURIComponent(`AND({Traveler Email}="${fromEmail}",{End Date}>="${new Date().toISOString().split('T')[0]}")`)}` +
          `&sort[0][field]=Start%20Date&sort[0][direction]=asc`, 'GET');
        tripRec = (futureData.records || [])[0];
      }
    }

    const tripName = tripRec?.fields?.['Trip Name'] || tripRec?.fields?.['Destination'] || 'your upcoming trip';
    const tripId   = tripRec?.id || null;

    // 4. Store the reservation
    if (tripId) {
      if (parsed.type === 'hotel' && parsed.hotel_name && parsed.check_in_date) {
        // Create a Lodging record
        await airtableFetch('Lodging', '', 'POST', {
          fields: {
            'Trip ID':        tripId,
            'Name':           parsed.hotel_name,
            'Location':       parsed.hotel_location || '',
            'Confirmation #': parsed.confirmation_number || '',
            'Check-in Date':  parsed.check_in_date  || '',
            'Check-out Date': parsed.check_out_date || ''
          }
        });
      } else if (parsed.type === 'flight' && parsed.departure_date) {
        const daysData = await airtableFetch('Trip Days',
          `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Date}="${parsed.departure_date}")`)}`, 'GET');
        const dayRec = (daysData.records || [])[0];
        if (dayRec) {
          const slot = {
            type:        'freeform',
            time:        parsed.departure_time || '',
            description: [
              parsed.airline, parsed.flight_number,
              parsed.from_airport && parsed.to_airport ? parsed.from_airport + ' → ' + parsed.to_airport : null,
              parsed.confirmation_number ? 'Conf: ' + parsed.confirmation_number : null
            ].filter(Boolean).join(' · ')
          };
          const existingSlots = [1,2,3,4].map(n => dayRec.fields['Slot ' + n]).filter(Boolean);
          const slotNum = Math.min(existingSlots.length + 1, 4);
          await airtableFetch('Trip Days', `/${dayRec.id}`, 'PATCH', {
            fields: { ['Slot ' + slotNum]: JSON.stringify(slot) }
          });
        }
      } else if (parsed.type === 'car_rental' && parsed.pickup_date) {
        const daysData = await airtableFetch('Trip Days',
          `?filterByFormula=${encodeURIComponent(`AND({Trip ID}="${tripId}",{Date}="${parsed.pickup_date}")`)}`, 'GET');
        const dayRec = (daysData.records || [])[0];
        if (dayRec) {
          const slot = {
            type:        'freeform',
            time:        parsed.pickup_time || '',
            description: [
              '🚗',
              parsed.rental_company,
              parsed.car_type,
              parsed.pickup_location ? 'Pickup: ' + parsed.pickup_location : null,
              parsed.dropoff_date ? 'Return: ' + parsed.dropoff_date : null,
              parsed.confirmation_number ? 'Conf: ' + parsed.confirmation_number : null
            ].filter(Boolean).join(' · ')
          };
          const existingSlots = [1,2,3,4].map(n => dayRec.fields['Slot ' + n]).filter(Boolean);
          const slotNum = Math.min(existingSlots.length + 1, 4);
          await airtableFetch('Trip Days', `/${dayRec.id}`, 'PATCH', {
            fields: { ['Slot ' + slotNum]: JSON.stringify(slot) }
          });
        }
      }
    }

    // 5. Send confirmation email
    const html = buildConfirmationHtml(travelerName, tripName, parsed);
    const emailSubject = parsed.type === 'flight'
      ? `✈️ Flight added to ${tripName}`
      : parsed.type === 'hotel'
      ? `🏨 ${parsed.hotel_name || 'Hotel'} added to ${tripName}`
      : parsed.type === 'car_rental'
      ? `🚗 ${parsed.rental_company || 'Car rental'} added to ${tripName}`
      : `Reservation added to ${tripName}`;

    await sendResend(fromEmail, emailSubject, html);
    return res.status(200).json({ ok: true, type: parsed.type, tripId });

  } catch(e) {
    console.error('parse-email error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
