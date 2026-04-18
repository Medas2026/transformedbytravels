const https = require('https');

const COUNTRY_CODES = {
  'united states': 'US', 'usa': 'US', 'us': 'US',
  'canada': 'CA', 'ca': 'CA',
  'united kingdom': 'GB', 'uk': 'GB', 'gb': 'GB',
  'australia': 'AU', 'au': 'AU',
  'france': 'FR', 'germany': 'DE', 'spain': 'ES',
  'italy': 'IT', 'japan': 'JP', 'mexico': 'MX',
  'new zealand': 'NZ', 'ireland': 'IE',
  'netherlands': 'NL', 'belgium': 'BE', 'portugal': 'PT',
  'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK',
  'finland': 'FI', 'switzerland': 'CH', 'austria': 'AT',
  'czechia': 'CZ', 'czech republic': 'CZ', 'poland': 'PL',
  'hungary': 'HU', 'greece': 'GR', 'croatia': 'HR',
  'south africa': 'ZA', 'brazil': 'BR', 'argentina': 'AR',
  'chile': 'CL', 'peru': 'PE', 'colombia': 'CO',
  'thailand': 'TH', 'indonesia': 'ID', 'singapore': 'SG',
  'malaysia': 'MY', 'india': 'IN', 'south korea': 'KR',
  'taiwan': 'TW'
};

module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { city, country, startDate, endDate, radius = '50' } = req.query;
  if (!city) return res.status(400).json({ error: 'city required' });

  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Ticketmaster API key not configured' });

  const params = [
    'apikey=' + encodeURIComponent(apiKey),
    'city='   + encodeURIComponent(city),
    'sort=date,asc',
    'size=20',
    'radius=' + encodeURIComponent(radius),
    'unit=miles'
  ];
  if (startDate) params.push('startDateTime=' + encodeURIComponent(startDate + 'T00:00:00Z'));
  if (endDate)   params.push('endDateTime='   + encodeURIComponent(endDate   + 'T23:59:59Z'));
  const cc = COUNTRY_CODES[(country || '').toLowerCase().trim()];
  if (cc) params.push('countryCode=' + cc);

  const options = {
    hostname: 'app.ticketmaster.com',
    path:     '/discovery/v2/events.json?' + params.join('&'),
    method:   'GET',
    headers:  { 'Accept': 'application/json' }
  };

  const req2 = https.request(options, (resp) => {
    let d = '';
    resp.on('data', c => { d += c; });
    resp.on('end', () => {
      try {
        const parsed = JSON.parse(d);
        if (parsed.fault) return res.status(401).json({ error: 'Invalid API key' });
        const raw    = (parsed._embedded && parsed._embedded.events) || [];
        const events = raw.map(e => {
          const v = e._embedded && e._embedded.venues && e._embedded.venues[0];
          const c = e.classifications && e.classifications[0];
          return {
            name:     e.name || '',
            date:     e.dates && e.dates.start && e.dates.start.localDate,
            time:     e.dates && e.dates.start && e.dates.start.localTime,
            venue:    v ? v.name : '',
            city:     v && v.city ? v.city.name : '',
            category: c && c.segment ? c.segment.name : '',
            genre:    c && c.genre   ? c.genre.name   : '',
            url:      e.url || ''
          };
        });
        res.status(200).json({ events });
      } catch(ex) {
        res.status(500).json({ error: 'Parse error: ' + ex.message });
      }
    });
  });
  req2.on('error', e => res.status(500).json({ error: e.message }));
  req2.end();
};
