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

function ordinal(n) {
  if (!n || n < 1) return 'first';
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

function sendEmail(to, subject, html) {
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
  const req = https.request(options, () => {});
  req.on('error', e => console.error('Email send error:', e.message));
  req.write(body);
  req.end();
}

function sendMonthlyEmail(to, subject, html) {
  sendEmail(to, subject, html);
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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
    })
  });
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

  // GET ?action=entries — fetch journal entries for a trip
  if (req.method === 'GET' && req.query.action === 'entries') {
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
    const email      = (b.email      || '').toLowerCase().trim();
    const tripId     = (b.tripId     || '').trim();
    const reflection = (b.reflection || '').trim();
    const barriers   = (b.barriers   || '').trim();
    const memory     = (b.memory     || '').trim();
    const photoUrl   = (b.photoUrl   || '').trim();
    const archetype  = (b.archetype  || '').trim();
    const hopes      = (b.hopes      || '').trim();
    const recordId   = (b.recordId   || '').trim();

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

  // GET ?action=send-daily — cron: send SMS to all active travelers
  if (req.method === 'GET' && req.query.action === 'send-daily') {
    const formula = encodeURIComponent(`{Status of Trip}="Active"`);
    airtableGet(TRIPS_TABLE, `?filterByFormula=${formula}`, (err, tripData) => {
      if (err) return res.status(500).json({ error: err.message });

      const now = new Date();

      const toSend = (tripData.records || [])
        .filter(r => r.fields['Traveler Email'])
        .filter(r => r.fields['Journal Enabled'] !== false)
        .filter(r => {
          // Only send if current hour in trip's timezone matches Journal Time
          const tz          = r.fields['Time Zone'] || 'UTC';
          const journalHour = Number(r.fields['Journal Time'] || 19);
          const localHour   = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now));
          console.log(`[send-daily] ${r.fields['Traveler Email']} tz=${tz} localHour=${localHour} journalHour=${journalHour}`);
          return localHour === journalHour;
        })
        .map(r => {
          const tz        = r.fields['Time Zone'] || 'UTC';
          const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
          return {
            email:          r.fields['Traveler Email'],
            tripId:         r.id,
            activationDate: r.fields['Activation Date'] || r.fields['Start Date'] || '',
            tripName:       r.fields['Trip Name'] || r.fields['Destination'] || 'your trip',
            localDate,
            places:         [1,2,3,4,5,6,7].map(n => ({
              name: r.fields['Place ' + n] || '',
              day:  Number(r.fields['Day ' + n]) || 0
            })).filter(p => p.name && p.day)
          };
        });

      if (!toSend.length) return res.status(200).json({ success: true, sent: 0 });

      let sent = 0;

      toSend.forEach(({ email, tripId, activationDate, tripName, localDate, places }) => {
        const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
        airtableGet(TRAVELER_TABLE, filter, (err2, travData) => {
          const record = travData && travData.records && travData.records[0];
          const name   = (record && record.fields['Traveler Name']) || 'Traveler';
          const phone  = (record && record.fields['Phone Number']) || '';

          let dayNum = null;
          if (activationDate) {
            const diff = Math.round((new Date(localDate) - new Date(activationDate)) / (24 * 60 * 60 * 1000));
            dayNum = diff >= 0 ? diff + 1 : null;
          }

          // Determine current place from place/day data
          let currentPlace = tripName;
          if (dayNum && places && places.length) {
            const sorted  = places.slice().sort((a, b) => a.day - b.day);
            const current = sorted.filter(p => p.day <= dayNum).pop();
            if (current) currentPlace = current.name;
          }

          const dayLabel = dayNum ? `Day ${dayNum}` : 'Today';
          const link = `${PORTAL_URL}/journal.html?email=${encodeURIComponent(email)}&trip=${encodeURIComponent(tripId)}&date=${localDate}${activationDate ? '&start=' + encodeURIComponent(activationDate) : ''}&dest=${encodeURIComponent(currentPlace)}`;

          if (phone) {
            // Send SMS via Twilio
            const smsBody = `${dayLabel} — ${currentPlace}\nHi ${name.split(' ')[0]}, time to capture your travel reflection!\n${link}`;
            sendSMS(phone, smsBody, (smsErr) => {
              if (smsErr) console.error('[send-daily] SMS error for', email, smsErr.message);
            });
          } else {
            // Fall back to email if no phone on file
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
<tr><td style="padding:0 40px 36px;text-align:center;">
<a href="${link}" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Write Today's Journal →</a>
</td></tr>
<tr><td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
<p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
</td></tr></table></td></tr></table></body></html>`;
            sendEmail(email, subject, html);
          }
          sent++;

          // update pending count — reuse same pattern
        });
      });

      // Give emails a moment to fire then respond
      setTimeout(() => res.status(200).json({ success: true, sent, checked: toSend.length }), 2000);
    });
    return;
  }

  // GET ?action=send-monthly — cron: send monthly journal prompt to eligible subscribers
  if (req.method === 'GET' && req.query.action === 'send-monthly') {
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

            eligible.forEach(r => {
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

              sendMonthlyEmail(email, subject, html);
            });

            res.status(200).json({ success: true, sent: eligible.length });
          });
        });
      });
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
