function doGet(e) {
  var action = e.parameter.action;

  if (action === 'lookup') {
    var email = (e.parameter.email || '').toLowerCase().trim();
    if (!email) {
      return ContentService.createTextOutput('{"error":"no email"}').setMimeType(ContentService.MimeType.JSON);
    }
    var ss = SpreadsheetApp.openById('1FL81Pfr2ScdLO9PSdNm7im4pyrlmUMwtTEOTQYVFjOY');
    var sheet = ss.getSheetByName('Responses');
    var rows = sheet.getDataRange().getValues();
    var found = null;
    for (var i = rows.length - 1; i >= 1; i--) {
      if (rows[i][2] && rows[i][2].toString().toLowerCase().trim() === email) {
        found = rows[i];
        break;
      }
    }
    if (!found) {
      return ContentService.createTextOutput('{"error":"not found"}').setMimeType(ContentService.MimeType.JSON);
    }
    var result = {
      name: found[1],
      archetype: found[3],
      scores: {
        Curiosity:  Number(found[4]),
        Adventure:  Number(found[5]),
        Reflection: Number(found[6]),
        Connection: Number(found[7]),
        Intention:  Number(found[8])
      },
      hopes: found[13] || ''
    };
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action !== 'destGuide') {
    return ContentService.createTextOutput('{"error":"unknown action"}').setMimeType(ContentService.MimeType.JSON);
  }

  var destination = e.parameter.destination || '';
  var country = e.parameter.country || '';
  var continent = e.parameter.continent || '';
  var archetype = e.parameter.archetype || 'Traveler';
  var C = e.parameter.Curiosity || 0;
  var Adv = e.parameter.Adventure || 0;
  var R = e.parameter.Reflection || 0;
  var Con = e.parameter.Connection || 0;
  var I = e.parameter.Intention || 0;
  var hopesRaw = e.parameter.hopes || '';
  var hopesLine = '';
  if (hopesRaw) {
    hopesLine = ' They hope travel will help them: ' + hopesRaw.split('|').join(', ') + '.';
  }

  var prompt = 'You are a transformational travel expert. A traveler with archetype ' + archetype + ' has these dimension scores out of 7: Curiosity ' + C + ', Adventure ' + Adv + ', Reflection ' + R + ', Connection ' + Con + ', Intention ' + I + '.' + hopesLine + ' They are exploring ' + destination + ' in ' + country + ', ' + continent + '. Write a personalized 260-word destination guide with these four sections: (1) Why ' + destination + ' Could Transform You - 2 sentences. (2) Experiences Tailored to Your Profile - 4 bullet points of specific activities matching their highest scores. (3) Your Growth Edge Here - 1 sentence on what will challenge them. (4) How to Travel Here as a ' + archetype + ' - 2 sentences of mindset advice. Use bold headers. Speak directly to the traveler as you.';

  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  var options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    }),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var data = JSON.parse(response.getContentText());
  var guide = (data.content && data.content[0]) ? data.content[0].text : 'Error: no content';

  return ContentService.createTextOutput(JSON.stringify({ guide: guide })).setMimeType(ContentService.MimeType.JSON);
}
