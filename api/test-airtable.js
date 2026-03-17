const https = require('https');

module.exports = function handler(req, res) {
  const apiKey = process.env.AIRTABLE_API_KEY;

  const options = {
    hostname: 'api.airtable.com',
    path: '/v0/appdlxcWb45dIqNK2/Traveler?maxRecords=1',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + apiKey
    }
  };

  const request = https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => {
      res.status(200).json({
        keyPresent: !!apiKey,
        keyStart: apiKey ? apiKey.substring(0, 10) : 'none',
        airtableStatus: response.statusCode,
        airtableResponse: data.slice(0, 500)
      });
    });
  });

  request.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });

  request.end();
};
