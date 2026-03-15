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

module.exports = function handler(req, res) {
  try {
    const base = 'https://script.google.com/macros/s/AKfycbxxqhkHPKSnj48H6tpFtWbbCsrs6zkNvrmSIcw3NGdWhSNBehqjAsqMUIIbTpAUShx6mA/exec';
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const url = base + qs;
    console.log('dest-guide fetching:', url.slice(0, 120));

    get(url, 10, (err, data) => {
      if (err) {
        console.log('get error:', err.message);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log('response length:', data.length, 'start:', data.slice(0, 80));
      try {
        const parsed = JSON.parse(data);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).json(parsed);
      } catch (e) {
        res.status(500).json({ error: 'Parse error', raw: data.slice(0, 300) });
      }
    });
  } catch(e) {
    console.log('handler error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
