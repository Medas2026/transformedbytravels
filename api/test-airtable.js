const https = require('https');

module.exports = function handler(req, res) {
  const apiKey = process.env.AIRTABLE_API_KEY;

  res.status(200).json({
    keyPresent: !!apiKey,
    keyStart: apiKey ? apiKey.substring(0, 10) : 'none',
    keyLength: apiKey ? apiKey.length : 0
  });
};
