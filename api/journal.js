const https = require('https');

const BASE_ID         = 'appdlxcWb45dIqNK2';
const JOURNAL_TABLE   = 'Journal Entries';
const TRIPS_TABLE     = 'Trips';
const TRAVELER_TABLE  = 'Traveler';
const EMAILS_TABLE    = 'Emails';
const PORTAL_URL      = 'https://transformedbytravels.vercel.app';

function airtableGet(table, filter, callback) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}${filter}`,
    method:   'GET',
    headers:  { 'Authorization': 'Bearer ' + apiKey }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.end();
}

function airtablePost(table, fields, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = JSON.stringify({ fields });
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}`,
    method:   'POST',
    headers: {
      'Authorization':  'Bearer ' + apiKey,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(bodyStr);
  req.end();
}

function airtablePatch(table, recordId, fields, callback) {
  const apiKey  = process.env.AIRTABLE_API_KEY;
  const bodyStr = JSON.stringify({ fields });
  const options = {
    hostname: 'api.airtable.com',
    path:     `/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}`,
    method:   'PATCH',
    headers: {
      'Authorization':  'Bearer ' + apiKey,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(bodyStr)
    }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(bodyStr);
  req.end();
}

function sendSMS(to, body, callback) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_PHONE_NUMBER;
  const params     = `To=${encodeURIComponent(to)}&From=${encodeURIComponent(from)}&Body=${encodeURIComponent(body)}`;
  const auth       = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const options = {
    hostname: 'api.twilio.com',
    path:     `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method:   'POST',
    headers: {
      'Authorization':  'Basic ' + auth,
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params)
    }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try { callback(null, JSON.parse(data)); }
      catch(e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(params);
  req.end();
}

// ── Weather codes (WMO) ──────────────────────────────────────────
const WMO_DESC = {
  0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
  45:'Foggy',48:'Icy fog',
  51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',
  61:'Light rain',63:'Rain',65:'Heavy rain',
  71:'Light snow',73:'Snow',75:'Heavy snow',
  77:'Snow grains',
  80:'Light showers',81:'Showers',82:'Heavy showers',
  85:'Snow showers',86:'Heavy snow showers',
  95:'Thunderstorm',96:'Thunderstorm w/ hail',99:'Thunderstorm w/ heavy hail'
};
const WMO_EMOJI = {
  0:'☀️',1:'🌤',2:'⛅',3:'☁️',
  45:'🌫',48:'🌫',
  51:'🌦',53:'🌦',55:'🌧',
  61:'🌧',63:'🌧',65:'🌧',
  71:'🌨',73:'❄️',75:'❄️',77:'🌨',
  80:'🌦',81:'🌧',82:'⛈',85:'🌨',86:'❄️',
  95:'⛈',96:'⛈',99:'⛈'
};

async function getWeatherForecast(place, country) {
  try {
    // Strip state abbreviation for geocoding (e.g. "Bayfield, WI" → "Bayfield")
    const cityName = place.split(',')[0].trim();
    const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=5&language=en&format=json`);
    const geoData = await geoResp.json();
    if (!geoData.results || !geoData.results.length) return null;
    // Prefer result matching the trip's country
    const loc = country
      ? (geoData.results.find(r => r.country && r.country.toLowerCase().includes(country.toLowerCase().split(',')[0].trim())) || geoData.results[0])
      : geoData.results[0];
    if (!loc) return null;
    const wResp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&temperature_unit=fahrenheit&timezone=auto&forecast_days=2`);
    const wData = await wResp.json();
    if (!wData.daily) return null;
    const code    = wData.daily.weathercode[1];
    return {
      emoji:   WMO_EMOJI[code] || '🌡',
      desc:    WMO_DESC[code]  || 'Variable',
      maxTemp: Math.round(wData.daily.temperature_2m_max[1]),
      minTemp: Math.round(wData.daily.temperature_2m_min[1]),
      precip:  Math.round(wData.daily.precipitation_sum[1] * 10) / 10
    };
  } catch(e) {
    console.error('[getWeather]', e.message);
    return null;
  }
}

function getLunarPhase(date) {
  const refNewMoon  = new Date('2000-01-06T18:14:00Z');
  const synodicMonth = 29.53058867;
  const phase = (((date - refNewMoon) / 86400000) % synodicMonth + synodicMonth) % synodicMonth;
  const illumination = Math.round((1 - Math.cos(phase / synodicMonth * 2 * Math.PI)) / 2 * 100);
  let name, emoji;
  if      (phase < 1.85)  { name = 'New Moon';        emoji = '🌑'; }
  else if (phase < 7.38)  { name = 'Waxing Crescent'; emoji = '🌒'; }
  else if (phase < 9.22)  { name = 'First Quarter';   emoji = '🌓'; }
  else if (phase < 14.77) { name = 'Waxing Gibbous';  emoji = '🌔'; }
  else if (phase < 16.61) { name = 'Full Moon';       emoji = '🌕'; }
  else if (phase < 22.15) { name = 'Waning Gibbous';  emoji = '🌖'; }
  else if (phase < 23.99) { name = 'Last Quarter';    emoji = '🌗'; }
  else                    { name = 'Waning Crescent';  emoji = '🌘'; }
  return { name, emoji, illumination };
}

function ordinal(n) {
  if (!n || n < 1) return 'first';
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

function sendEmail(to, subject, html) {
  return new Promise((resolve) => {
    const apiKey = process.env.RESEND_API_KEY;
    const body   = JSON.stringify({ from: 'TravelForGrowth@transformedbytravels.com', to, subject, html });
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
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', e => { console.error('Email send error:', e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

function sendMonthlyEmail(to, subject, html) {
  return sendEmail(to, subject, html);
}

async function getClaudeReflection(reflection, barriers, memory, tripName, dayNumber, archetype, hopes) {
  const day    = ordinal(dayNumber);
  const dest   = tripName || 'your destination';
  const opener = `Hoping your ${day} day in ${dest} is going well.`;

  const context = [];
  if (archetype) context.push(`Traveler archetype: ${archetype}`);
  if (hopes)     context.push(`Hopes for this trip: ${hopes}`);

  const prompt = `You are a warm travel coach for Transformed by Travels. Begin your response with exactly this sentence: "${opener}"

${context.length ? 'About this traveler:\n' + context.join('\n') + '\n' : ''}
Today's journal:
- Reflections on goals: "${reflection || '(none shared)'}"
- Barriers encountered: "${barriers || '(none shared)'}"
- Best memory created today: "${memory || '(none shared)'}"

After the opener, write exactly 2 more sentences. Sentence 1: acknowledge something specific from what they wrote — especially their best memory if they shared one — connecting it naturally to their archetype or hopes. Sentence 2: a warm encouraging thought looking toward tomorrow. Speak directly as "you". Be specific — never generic.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages:   [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  if (!data.content) throw new Error('No content in response');
  return data.content[0]?.text || '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parse action from query string directly (req.query may not always be populated)
  const _qs     = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
  const _qp     = new URLSearchParams(_qs);
  const _action = (req.query && req.query.action) || _qp.get('action') || '';

  // GET ?action=prompts — fetch lead-in prompts from Journal Prompts table
  if (req.method === 'GET' && _action === 'prompts') {
    airtableGet('Journal Prompts', '?filterByFormula=' + encodeURIComponent('{Active}=1'), (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      const result = {};
      (data.records || []).forEach(r => {
        const type = (r.fields['Day Type'] || '').toUpperCase();
        result[type] = r.fields['Lead-in'] || '';
      });
      res.status(200).json(result);
    });
    return;
  }

  // GET ?action=entries — fetch journal entries for a trip
  if (req.method === 'GET' && _action === 'entries') {
    const email  = ((req.query && req.query.email)  || '').toLowerCase().trim();
    const tripId = ((req.query && req.query.tripId) || '').trim();
    if (!email) return res.status(400).json({ error: 'email required' });
    const formula = tripId
      ? `AND({Traveler Email}="${email}",{Trip ID}="${tripId}")`
      : `({Traveler Email}="${email}")`;
    const filter = `?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Entry%20Date&sort[0][direction]=asc`;
    airtableGet(JOURNAL_TABLE, filter, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(200).json({ records: data.records || [] });
    });
    return;
  }

  // POST — save or update a journal entry
  if (req.method === 'POST') {
    const b = req.body || {};
    const email      = (b.email      || '').toLowerCase().trim().slice(0, 200);
    const tripId     = (b.tripId     || '').trim().slice(0, 100);
    const reflection = (b.reflection || '').trim().slice(0, 3000);
    const barriers   = (b.barriers   || '').trim().slice(0, 1000);
    const memory     = (b.memory     || '').trim().slice(0, 1000);
    const photoUrl   = (b.photoUrl   || '').trim().slice(0, 500);
    const archetype  = (b.archetype  || '').trim().slice(0, 100);
    const hopes      = (b.hopes      || '').trim().slice(0, 500);
    const recordId   = (b.recordId   || '').trim().slice(0, 100);

    if (!email) return res.status(400).json({ error: 'email required' });
    if (!reflection && !barriers && !memory) return res.status(400).json({ error: 'at least one response required' });

    const now   = new Date();
    // Use the date the traveler is journaling about (from URL param), not UTC server time
    const today = (b.entryDate || '').trim() || now.toISOString().split('T')[0];
    console.log('[journal POST v2] entryDate received:', b.entryDate, '→ saving as:', today);

    // Calculate day number from trip start date (or use override for dev testing)
    let dayNumber = b.dayOverride ? parseInt(b.dayOverride) : null;
    if (!dayNumber) {
      const startDate = (b.startDate || '').trim();
      if (startDate) {
        const msPerDay = 24 * 60 * 60 * 1000;
        const diff = Math.round((new Date(today) - new Date(startDate)) / msPerDay);
        dayNumber = diff >= 0 ? diff + 1 : null;
      }
    }

    // Get Claude reflection
    let claudeReflection = '';
    let claudeError = '';
    try {
      claudeReflection = await getClaudeReflection(reflection, barriers, memory, b.tripName || '', dayNumber, archetype, hopes);
    } catch(e) { claudeError = e.message; }

    const fields = {
      'Reflection': reflection,
      'Barriers':   barriers,
      'Entry Time': now.toISOString().split('T')[1].substring(0, 5) + ' UTC'
    };
    if (memory)           fields['Best Memory']            = memory;
    if (photoUrl)         fields['Photo URL']              = photoUrl;
    if (claudeReflection) fields['Reflection from Claude'] = claudeReflection;

    if (recordId) {
      // Update existing entry
      airtablePatch(JOURNAL_TABLE, recordId, fields, (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        if (data.error) return res.status(500).json({ error: data.error });
        res.status(200).json({ success: true, claudeReflection, claudeError: claudeError || undefined });
      });
    } else {
      // Create new entry
      fields['Traveler Email'] = email;
      fields['Entry Date']     = today;
      if (tripId)      fields['Trip ID']    = tripId;
      if (dayNumber)   fields['Day Number'] = dayNumber;
      if (b.entryType) fields['Entry Type'] = b.entryType;

      airtablePost(JOURNAL_TABLE, fields, (err, data) => {
        if (err) return res.status(500).json({ error: err.message });
        if (data.error) return res.status(500).json({ error: data.error });
        res.status(200).json({ success: true, claudeReflection, claudeError: claudeError || undefined });
      });
    }
    return;
  }

  // GET ?action=send-daily — cron: send journal reminders to all active travelers
  if (req.method === 'GET' && _action === 'send-daily') {
    (async () => {
      try {
        const now = new Date();
        const airtableGetP = (table, filter) => new Promise((resolve, reject) =>
          airtableGet(table, filter, (err, data) => err ? reject(err) : resolve(data))
        );

        const tripsData = await airtableGetP(TRIPS_TABLE, '?filterByFormula=' + encodeURIComponent('{Status of Trip}="Active"'));
        console.log(`[send-daily] active trips found: ${(tripsData.records||[]).length} error=${tripsData.error ? JSON.stringify(tripsData.error) : ''}`);

        const toSend = (tripsData.records || [])
          .filter(r => r.fields['Traveler Email'] && r.fields['Journal Enabled'] !== false)
          .filter(r => {
            const tz          = r.fields['Time Zone'] || 'UTC';
            const journalHour = Number(r.fields['Journal Time'] || 19);
            const localHour   = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now));
            console.log(`[send-daily] ${r.fields['Traveler Email']} tz=${tz} localHour=${localHour} journalHour=${journalHour} match=${localHour === journalHour}`);
            return localHour === journalHour;
          })
          .map(r => {
            const tz        = r.fields['Time Zone'] || 'UTC';
            const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
            return {
              email:          r.fields['Traveler Email'],
              tripId:         r.id,
              destination:    r.fields['Destination'] || '',
              country:        r.fields['Country'] || '',
              activationDate: r.fields['Activation Date'] || r.fields['Start Date'] || '',
              endDate:        r.fields['End Date'] || '',
              tripName:       r.fields['Trip Name'] || r.fields['Destination'] || 'your trip',
              localDate,
              places: [1,2,3,4,5,6,7].map(n => ({
                name: r.fields['Place ' + n] || '',
                day:  Number(r.fields['Day ' + n]) || 0
              })).filter(p => p.name && p.day)
            };
          });

        if (!toSend.length) return res.status(200).json({ success: true, sent: 0 });

        let sent = 0;

        for (const { email, tripId, destination, country, activationDate, endDate, tripName, localDate, places } of toSend) {
          // Traveler info
          const travData = await airtableGetP(TRAVELER_TABLE, '?filterByFormula=' + encodeURIComponent(`({Traveler Email}="${email}")`));
          const travRec  = (travData.records || [])[0];
          const name     = travRec ? (travRec.fields['Traveler Name'] || 'Traveler') : 'Traveler';
          const phone    = travRec ? (travRec.fields['Phone Number'] || '') : '';

          // Day number
          let dayNum = null;
          if (activationDate) {
            const diff = Math.round((new Date(localDate) - new Date(activationDate)) / 86400000);
            dayNum = diff >= 0 ? diff + 1 : null;
          }

          // Current place
          let currentPlace = destination || tripName;
          if (dayNum && places.length) {
            const current = places.slice().sort((a, b) => a.day - b.day).filter(p => p.day <= dayNum).pop();
            if (current) currentPlace = current.name;
          }

          // Tomorrow's weather + lunar
          const tomorrowDate = new Date(localDate + 'T12:00:00');
          tomorrowDate.setDate(tomorrowDate.getDate() + 1);
          const weatherPlace = currentPlace !== tripName ? currentPlace : (destination || tripName);
          const [weather, lunar] = await Promise.all([
            getWeatherForecast(weatherPlace, country),
            Promise.resolve(getLunarPhase(tomorrowDate))
          ]);

          const isLastDay  = endDate && localDate >= endDate;
          const isFirstDay = dayNum === 1;
          const dayType    = isLastDay ? 'LAST' : isFirstDay ? 'FIRST' : 'MIDDLE';
          const dayLabel   = dayNum ? `Day ${dayNum}` : 'Today';
          const link = `${PORTAL_URL}/journal.html?email=${encodeURIComponent(email)}&trip=${encodeURIComponent(tripId)}&date=${localDate}${activationDate ? '&start=' + encodeURIComponent(activationDate) : ''}&dest=${encodeURIComponent(currentPlace)}&daytype=${dayType}`;

          // ── Tomorrow section HTML ──────────────────────────────────
          const tomorrowLabel = tomorrowDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
          const weatherHtml = weather
            ? `<td style="text-align:center;padding:0 16px 0 0;">
                <div style="font-size:2rem;line-height:1;">${weather.emoji}</div>
                <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#0f172a;margin-top:6px;">${weather.maxTemp}° / ${weather.minTemp}°F</div>
                <div style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;margin-top:2px;">${weather.desc}${weather.precip > 0 ? ' · ' + weather.precip + '" precip' : ''}</div>
              </td>`
            : '';
          const lunarHtml = `<td style="text-align:center;padding:0 0 0 16px;border-left:1px solid #e2e8f0;">
              <div style="font-size:2rem;line-height:1;">${lunar.emoji}</div>
              <div style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;color:#0f172a;margin-top:6px;">${lunar.name}</div>
              <div style="font-family:Arial,sans-serif;font-size:12px;color:#64748b;margin-top:2px;">${lunar.illumination}% illuminated</div>
            </td>`;

          const tomorrowBlockHtml = `
<tr><td style="padding:0 40px 28px;">
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px 20px;">
    <div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">Tomorrow · ${tomorrowLabel}</div>
    <table cellpadding="0" cellspacing="0" style="width:100%;"><tr>${weatherHtml}${lunarHtml}</tr></table>
  </div>
</td></tr>`;

          const finishLink = `${PORTAL_URL}/portal.html`;

          if (phone) {
            let smsBody;
            if (isLastDay) {
              smsBody = `Last Day — ${currentPlace}\nHi ${name.split(' ')[0]}, today's your last day! Take a moment to journal and finish your trip.\n${finishLink}`;
            } else {
              const tomorrowSms = weather
                ? `\nTomorrow: ${weather.emoji} ${weather.maxTemp}°/${weather.minTemp}°F · ${lunar.emoji} ${lunar.name}`
                : `\nTomorrow: ${lunar.emoji} ${lunar.name}`;
              smsBody = `${dayLabel} — ${currentPlace}\nHi ${name.split(' ')[0]}, time to capture your travel reflection!${tomorrowSms}\n${link}`;
            }
            await new Promise(resolve => sendSMS(phone, smsBody, (e) => {
              if (e) console.error('[send-daily] SMS error for', email, e.message);
              resolve();
            }));
          } else if (isLastDay) {
            const subject = `Last Day — ${currentPlace} 🏁`;
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
<img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" /></td></tr>
<tr><td style="padding:36px 40px 28px;">
<h1 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 16px;">Last Day in ${currentPlace}, ${name}!</h1>
<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 16px;">Today marks the final day of <strong>${tripName}</strong>. Before the journey fades, take a moment to capture any final reflections — then go ahead and officially finish your trip.</p>
<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">When you're ready, your Integration Workshop will help you turn this experience into lasting growth.</p>
</td></tr>
<tr><td style="padding:0 40px 36px;text-align:center;">
<a href="${finishLink}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Finish My Trip 🏁</a>
</td></tr>
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr></table></td></tr></table></body></html>`;
            await sendEmail(email, subject, html);
          } else {
            const subject = `${dayLabel} Journal — ${currentPlace}`;
            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
<img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" /></td></tr>
<tr><td style="padding:36px 40px 28px;">
<h1 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 16px;">Hello ${name},</h1>
<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">Hoping your ${ordinal(dayNum)} day in ${currentPlace} is going well. Take a moment to capture your reflection before the day slips by.</p>
</td></tr>
<tr><td style="padding:0 40px 28px;text-align:center;">
<a href="${link}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Write Today's Journal →</a>
</td></tr>
${tomorrowBlockHtml}
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr></table></td></tr></table></body></html>`;
            await sendEmail(email, subject, html);
          }

          sent++;
          console.log('[send-daily] sent to', email, dayLabel, currentPlace);
        }

        res.status(200).json({ success: true, sent, checked: toSend.length });
      } catch(e) {
        console.error('[send-daily]', e.message);
        res.status(500).json({ error: e.message });
      }
    })();
    return;
  }

  // GET ?action=send-monthly — cron: send monthly journal prompt to eligible subscribers
  if (req.method === 'GET' && _action === 'send-monthly') {
    // 1. Get all active trip emails (to skip)
    airtableGet(TRIPS_TABLE, `?filterByFormula=${encodeURIComponent(`{Status of Trip}="Active"`)}`, (err, activeData) => {
      if (err) return res.status(500).json({ error: err.message });
      const activeEmails = new Set((activeData.records || []).map(r => (r.fields['Traveler Email'] || '').toLowerCase()));

      // 2. Get all completed trip emails (eligible)
      airtableGet(TRIPS_TABLE, `?filterByFormula=${encodeURIComponent(`{Status of Trip}="Completed"`)}`, (err2, completedData) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const completedEmails = new Set((completedData.records || []).map(r => (r.fields['Traveler Email'] || '').toLowerCase()));

        // 3. Get all active subscribers
        const subFilter = `?filterByFormula=${encodeURIComponent(`{Subscription Active}=1`)}`;
        airtableGet(TRAVELER_TABLE, subFilter, (err3, travData) => {
          if (err3) return res.status(500).json({ error: err3.message });

          const eligible = (travData.records || []).filter(r => {
            const email = (r.fields['Traveler Email'] || '').toLowerCase();
            return completedEmails.has(email) && !activeEmails.has(email);
          });

          if (!eligible.length) return res.status(200).json({ success: true, sent: 0 });

          // 4. Fetch email template
          const tmplFilter = `?filterByFormula=${encodeURIComponent(`({Code}="MONTHLY_JOURNAL")`)}`;
          airtableGet(EMAILS_TABLE, tmplFilter, (err4, tmplData) => {
            const tmplRecord = tmplData && (tmplData.records || [])[0];
            const tmpl       = tmplRecord ? tmplRecord.fields : {};
            const subject    = tmpl['Subject'] || 'Your Monthly Travel Reflection';
            const p1         = tmpl['Paragraph 1'] || '';
            const p2         = tmpl['Paragraph 2'] || '';
            const p3         = tmpl['Paragraph 3'] || '';

            const para = text => text
              ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.75;margin:0 0 18px;">${text.replace(/\n/g, '<br>')}</p>`
              : '';

            const sends = eligible.map(r => {
              const email = (r.fields['Traveler Email'] || '').toLowerCase();
              const name  = r.fields['Traveler Name'] || 'Traveler';
              const link  = `${PORTAL_URL}/monthly-journal.html?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}`;

              const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
<img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" /></td></tr>
<tr><td style="padding:36px 40px 28px;">${para(p1)}${para(p2)}${para(p3)}</td></tr>
<tr><td style="padding:0 40px 36px;text-align:center;">
<a href="${link}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Write My Reflection →</a>
</td></tr>
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr></table></td></tr></table></body></html>`;

              return sendMonthlyEmail(email, subject, html);
            });
            Promise.all(sends).catch(() => {});

            res.status(200).json({ success: true, sent: eligible.length });
          });
        });
      });
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
