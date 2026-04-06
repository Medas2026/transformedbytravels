const https = require('https');
const http = require('http');

function get(url, redirectsLeft, callback) {
  const lib = url.startsWith('https') ? https : http;
  lib.get(url, (res) => {
    const loc = res.headers.location;
    if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) && loc && redirectsLeft > 0) {
      const next = loc.startsWith('http') ? loc : 'https://script.google.com' + loc;
      get(next, redirectsLeft - 1, callback);
      return;
    }
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => callback(null, data));
  }).on('error', err => callback(err));
}

function claudeGuide(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 2000,
      messages:   [{ role: 'user', content: prompt }]
    });
    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (r) => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          resolve((parsed.content && parsed.content[0] && parsed.content[0].text) || '');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const qs  = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const p   = new URLSearchParams(qs);
    const partnerName = p.get('partnerName') || '';

    // Partner mode — generate combined guide with Claude
    if (partnerName) {
      const destination = p.get('destination') || '';
      const country     = p.get('country')     || '';
      const archetype   = p.get('archetype')   || '';
      const passions    = (p.get('passions')   || '').replace(/\|/g, ', ');
      const hopes       = (p.get('hopes')      || '').replace(/\|/g, ', ');
      const lifeStage   = p.get('lifeStage')   || '';
      const travelStyle = p.get('travelStyle') || '';
      const travelerName = p.get('travelerName') || 'Traveler A';

      const pArchetype  = p.get('partnerArchetype') || '';
      const pPassions   = (p.get('partnerPassions') || '').replace(/\|/g, ', ');

      const dims = ['Curiosity','Adventure','Reflection','Connection','Intention'];
      const scoreA = dims.map(d => `${d}: ${p.get(d) || 0}/7`).join(', ');
      const scoreB = dims.map(d => `${d}: ${p.get('partner' + d) || 0}/7`).join(', ');

      const prompt = `You are an expert travel writer and destination specialist. Create a rich, personalized Destination DNA Guide for ${destination}${country ? ', ' + country : ''} tailored to two travel partners traveling together.

Traveler 1:
- Archetype: ${archetype}
- Passions: ${passions || 'not specified'}
- Hopes to experience: ${hopes || 'not specified'}
- Life stage: ${lifeStage}
- Travel style: ${travelStyle}
- Dimension scores: ${scoreA}

Traveler 2 (${partnerName}):
- Archetype: ${pArchetype}
- Passions: ${pPassions || 'not specified'}
- Dimension scores: ${scoreB}

Write a destination guide that speaks to BOTH travelers — finding the sweet spots where their travel styles converge, and suggesting how they can each get what they need from this destination. Structure it with these sections:

# ${destination} — Your Joint Destination DNA

## Why This Destination Works For You Both
## Experiences That Speak to Both of You
## For the ${archetype} (moments just for Traveler 1)
## For the ${pArchetype} (moments just for ${partnerName})
## How to Structure Your Days Together
## Practical Tips

Use vivid, inspiring language. Be specific to this destination. 600-800 words.`;

      const guide = await claudeGuide(prompt);
      return res.status(200).json({ guide });
    }

    // Standard solo guide — proxy to Google Apps Script
    const base = 'https://script.google.com/macros/s/AKfycbxxqhkHPKSnj48H6tpFtWbbCsrs6zkNvrmSIcw3NGdWhSNBehqjAsqMUIIbTpAUShx6mA/exec';
    const url  = base + '?' + qs;
    console.log('dest-guide fetching:', url.slice(0, 120));

    get(url, 10, (err, data) => {
      if (err) { res.status(500).json({ error: err.message }); return; }
      try {
        const parsed = JSON.parse(data);
        res.status(200).json(parsed);
      } catch(e) {
        res.status(500).json({ error: 'Parse error', raw: data.slice(0, 300) });
      }
    });
  } catch(e) {
    console.log('handler error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
