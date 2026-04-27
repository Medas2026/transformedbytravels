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

function truncate(val, max) { return (val || '').slice(0, max); }

// Strip any numeric score references Claude might include despite instructions
function stripScores(text) {
  return text
    .replace(/\b(Curiosity|Adventure|Reflection|Connection|Intention|Travel Purpose)\s+\d+(\s*\/\s*7)?\b/g, '$1')
    .replace(/\(\s*(Curiosity|Adventure|Reflection|Connection|Intention|Travel Purpose)\s+\d+(?:,\s*(Curiosity|Adventure|Reflection|Connection|Intention|Travel Purpose)\s+\d+)*\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function scoreLabel(n) {
  const v = parseInt(n, 10) || 0;
  if (v <= 2) return 'Low';
  if (v <= 4) return 'Moderate';
  if (v <= 5) return 'High';
  return 'Very High';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const qs  = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const p   = new URLSearchParams(qs);
    const partnerName = truncate(p.get('partnerName'), 100);

    // Partner mode — generate combined guide with Claude
    if (partnerName) {
      const destination  = truncate(p.get('destination'), 100);
      const country      = truncate(p.get('country'), 100);
      const archetype    = truncate(p.get('archetype'), 100);
      const passions     = truncate((p.get('passions')   || '').replace(/\|/g, ', '), 300);
      const hopes        = truncate((p.get('hopes')      || '').replace(/\|/g, ', '), 300);
      const lifeStage    = truncate(p.get('lifeStage'), 100);
      const travelStyle  = truncate(p.get('travelStyle'), 100);
      const travelerName = truncate(p.get('travelerName') || 'Traveler A', 100);

      const pArchetype  = truncate(p.get('partnerArchetype'), 100);
      const pPassions   = truncate((p.get('partnerPassions') || '').replace(/\|/g, ', '), 300);

      const dims = ['Curiosity','Adventure','Reflection','Connection','Intention'];
      const scoreA = dims.map(d => `${d}: ${scoreLabel(p.get(d))}`).join(', ');
      const scoreB = dims.map(d => `${d}: ${scoreLabel(p.get('partner' + d))}`).join(', ');

      const prompt = `You are an expert travel writer and destination specialist. Create a rich, personalized Destination DNA Guide for ${destination}${country ? ', ' + country : ''} tailored to two travel partners traveling together.

${travelerName}:
- Archetype: ${archetype}
- Passions: ${passions || 'not specified'}
- Hopes to experience: ${hopes || 'not specified'}
- Life stage: ${lifeStage}
- Travel style: ${travelStyle}
- Dimension scores: ${scoreA}

${partnerName}:
- Archetype: ${pArchetype}
- Passions: ${pPassions || 'not specified'}
- Dimension scores: ${scoreB}

Write a destination guide that speaks to BOTH travelers — finding the sweet spots where their travel styles converge, and suggesting how they can each get what they need from this destination. Structure it with these sections:

# ${destination} — Your Joint Destination DNA

## Why This Destination Works For You Both
## Experiences That Speak to Both of You
## For the ${archetype} (moments just for ${travelerName})
## For the ${pArchetype} (moments just for ${partnerName})
## How to Structure Your Days Together
## Practical Tips

Use vivid, inspiring language. Be specific to this destination. 600-800 words.

IMPORTANT: Never include numeric scores in your output. You may naturally reference a traveler's dimension level (e.g. "your high sense of adventure" or "your very high curiosity") but always as natural language — never as a score, number, or parenthetical like "(Adventure 7)".`;

      const guide = stripScores(await claudeGuide(prompt));
      return res.status(200).json({ guide });
    }

    // Standard solo guide — generate with Claude
    const destination  = truncate(p.get('destination'), 100);
    const country      = truncate(p.get('country'), 100);
    const archetype    = truncate(p.get('archetype'), 100);
    const passions     = truncate((p.get('passions')   || '').replace(/\|/g, ', '), 300);
    const passionFocus = truncate(p.get('passion') || '', 100);
    const hopes        = truncate((p.get('hopes')      || '').replace(/\|/g, ', '), 300);
    const lifeStage    = truncate(p.get('lifeStage'), 100);
    const travelStyle  = truncate(p.get('travelStyle'), 100);
    const travelerName = truncate(p.get('travelerName') || 'Traveler', 100);

    const dims   = ['Curiosity','Adventure','Reflection','Connection','Intention'];
    const scoreA = dims.map(d => `${d}: ${scoreLabel(p.get(d))}`).join(', ');

    const soloPrompt = `You are an expert travel writer and destination specialist. Create a rich, personalized Destination DNA Guide for ${destination}${country ? ', ' + country : ''} tailored to a single traveler.

${travelerName}:
- Archetype: ${archetype}
- Passions: ${passions || 'not specified'}${passionFocus ? `\n- Passion Focus for this trip: ${passionFocus}` : ''}
- Hopes to experience: ${hopes || 'not specified'}
- Life stage: ${lifeStage}
- Travel style: ${travelStyle}
- Dimension scores: ${scoreA}
${passionFocus ? `\nIMPORTANT: The traveler has specifically selected "${passionFocus}" as their passion focus for this destination. Make sure experiences related to ${passionFocus} are prominently featured throughout the guide.\n` : ''}
Write a destination guide that speaks directly to this traveler — what makes this destination a natural fit for who they are, and how they should experience it. Structure it with these sections:

# ${destination} — Your Destination DNA

## Why This Destination Calls to You
## Experiences Made for You
## How to Make the Most of Your Time
## Hidden Gems Worth Seeking Out
## Practical Tips

Use vivid, inspiring language. Be specific to this destination. 600-800 words.

IMPORTANT: Never include numeric scores in your output. You may naturally reference a traveler's dimension level (e.g. "your high sense of adventure" or "your very high curiosity") but always as natural language — never as a score, number, or parenthetical like "(Adventure 7)".`;

    const guide = stripScores(await claudeGuide(soloPrompt));
    return res.status(200).json({ guide });
  } catch(e) {
    console.log('handler error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
