const https = require('https');

const BASE_ID         = 'appdlxcWb45dIqNK2';
const JOURNAL_TABLE   = 'Journal Entries';
const TRIPS_TABLE     = 'Trips';
const TRAVELER_TABLE  = 'Traveler';
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

async function getClaudeReflection(reflection, barriers, tripName) {
  const dest = tripName ? ` on their trip to ${tripName}` : '';
  const prompt = `You are a warm, insightful travel coach for Transformed by Travels. A traveler${dest} just shared their evening journal entries.

Reflections on their goals from today: "${reflection || '(none shared)'}"
Barriers they encountered: "${barriers || '(none shared)'}"

Write a brief, personal, encouraging response (2-3 sentences) that acknowledges what they shared, offers one gentle insight or reframe, and ends with encouragement for tomorrow. Speak directly to them as "you". Be specific to what they wrote, not generic.`;

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
  return data.content?.[0]?.text || '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST — save a journal entry
  if (req.method === 'POST') {
    const b = req.body || {};
    const email      = (b.email      || '').toLowerCase().trim();
    const tripId     = (b.tripId     || '').trim();
    const reflection = (b.reflection || '').trim();
    const barriers   = (b.barriers   || '').trim();
    const photoUrl   = (b.photoUrl   || '').trim();

    if (!email) return res.status(400).json({ error: 'email required' });
    if (!reflection && !barriers) return res.status(400).json({ error: 'at least one response required' });

    const today = new Date().toISOString().split('T')[0];

    // Calculate day number from trip start date
    let dayNumber = null;
    const startDate = (b.startDate || '').trim();
    if (startDate) {
      const msPerDay = 24 * 60 * 60 * 1000;
      const diff = Math.round((new Date(today) - new Date(startDate)) / msPerDay);
      dayNumber = diff >= 0 ? diff + 1 : null;
    }

    // Get Claude reflection
    let claudeReflection = '';
    try {
      claudeReflection = await getClaudeReflection(reflection, barriers, b.tripName || '');
    } catch(e) { /* non-fatal — save without it */ }

    const fields = {
      'Traveler Email': email,
      'Entry Date':     today,
      'Reflection':     reflection,
      'Barriers':       barriers
    };
    if (tripId)           fields['Trip ID']              = tripId;
    if (dayNumber)        fields['Day Number']           = dayNumber;
    if (photoUrl)         fields['Photo URL']            = photoUrl;
    if (claudeReflection) fields['Reflection from Claude'] = claudeReflection;

    airtablePost(JOURNAL_TABLE, fields, (err, data) => {
      if (err) return res.status(500).json({ error: err.message });
      if (data.error) return res.status(500).json({ error: data.error });
      res.status(200).json({ success: true, claudeReflection });
    });
    return;
  }

  // GET ?action=send-daily — cron: send SMS to all active travelers
  if (req.method === 'GET' && req.query.action === 'send-daily') {
    const formula = encodeURIComponent(`{Status of Trip}="Active"`);
    airtableGet(TRIPS_TABLE, `?filterByFormula=${formula}`, (err, tripData) => {
      if (err) return res.status(500).json({ error: err.message });

      const toSend = (tripData.records || [])
        .filter(r => r.fields['Traveler Email'])
        .map(r => ({
          email:     r.fields['Traveler Email'],
          tripId:    r.id,
          startDate: r.fields['Start Date'] || '',
          tripName:  r.fields['Trip Name'] || r.fields['Destination'] || 'your trip'
        }));

      if (!toSend.length) return res.status(200).json({ success: true, sent: 0 });

      // Look up phone numbers for matching travelers
      let pending  = toSend.length;
      let sent     = 0;

      toSend.forEach(({ email, tripId, startDate, tripName }) => {
        const filter = `?filterByFormula=${encodeURIComponent(`({Traveler Email}="${email}")`)}`;
        airtableGet(TRAVELER_TABLE, filter, (err2, travData) => {
          const record = travData && travData.records && travData.records[0];
          const phone  = record && record.fields['Phone Number'];

          if (phone) {
            const today   = new Date().toISOString().split('T')[0];
            const link    = `${PORTAL_URL}/journal.html?email=${encodeURIComponent(email)}&trip=${encodeURIComponent(tripId)}&date=${today}${startDate ? '&start=' + encodeURIComponent(startDate) : ''}&dest=${encodeURIComponent(tripName)}`;
            const message = `Time to reflect on your day in ${tripName}! 🌟 Log your journal: ${link}`;
            sendSMS(phone, message, () => {});
            sent++;
          }

          pending--;
          if (pending === 0) {
            res.status(200).json({ success: true, sent, checked: toSend.length });
          }
        });
      });
    });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
