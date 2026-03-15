const https = require('https');

module.exports = function handler(req, res) {
  const url = 'https://script.google.com/macros/s/AKfycbxxqhkHPKSnj48H6tpFtWbbCsrs6zkNvrmSIcw3NGdWhSNBehqjAsqMUIIbTpAUShx6mA/exec?action=hopeCards';

  https.get(url, (response) => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        https.get(response.headers.location, (r2) => {
          let d2 = '';
          r2.on('data', chunk => { d2 += chunk; });
          r2.on('end', () => {
            try {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.status(200).json(JSON.parse(d2));
            } catch(e) {
              res.status(500).json({ error: 'Parse error', raw: d2.slice(0, 200) });
            }
          });
        }).on('error', err => res.status(500).json({ error: err.message }));
        return;
      }
      try {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).json(JSON.parse(data));
      } catch(e) {
        res.status(500).json({ error: 'Parse error', raw: data.slice(0, 200) });
      }
    });
  }).on('error', err => res.status(500).json({ error: err.message }));
};
