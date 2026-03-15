const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
  const url = 'https://script.google.com/macros/s/AKfycbxxqhkHPKSnj48H6tpFtWbbCsrs6zkNvrmSIcw3NGdWhSNBehqjAsqMUIIbTpAUShx6mA/exec?action=hopeCards';
  try {
    const response = await fetch(url, { redirect: 'follow' });
    const text = await response.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ status: response.status, body: text.slice(0, 500) });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
};
