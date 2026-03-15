const https = require('https');

function buildEmailHTML(name, archetype, archetypeTag, archetypeDesc, scores) {
  const dims = ['Curiosity', 'Adventure', 'Reflection', 'Connection', 'Intention'];
  const dimScoreRows = dims.map(d => {
    const score = Number(scores[d] || 0);
    const pct = Math.round((score / 7) * 100);
    return `
      <tr>
        <td style="padding:6px 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="130" style="font-family:Arial,sans-serif;font-size:13px;color:#334155;font-weight:bold;padding-right:12px;">${d}</td>
              <td>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:6px;overflow:hidden;background:#e2e8f0;">
                  <tr>
                    <td width="${pct}%" style="background:#2dd4bf;height:14px;border-radius:6px;"></td>
                    <td style="height:14px;"></td>
                  </tr>
                </table>
              </td>
              <td width="45" style="text-align:right;font-family:Arial,sans-serif;font-size:13px;color:#64748b;padding-left:10px;">${score}/7</td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:#ffffff;padding:32px;text-align:center;border-bottom:3px solid #2dd4bf;">
              <img src="https://transformedbytravels.vercel.app/images/Base%20Green%20Graphic%20Logo%20Black.png" height="80" alt="Transformed by Travels" style="display:block;margin:0 auto;" />
            </td>
          </tr>

          <!-- INTRO -->
          <tr>
            <td style="padding:36px 40px 28px;text-align:center;">
              <h1 style="font-family:Georgia,serif;font-size:22px;color:#0f172a;margin:0 0 16px;">Hello ${name},</h1>
              <p style="font-family:Arial,sans-serif;font-size:15px;color:#475569;line-height:1.7;margin:0;">
                Thank you for taking the Transformational Travel Profile. You will have access to a variety of trip planning services and education all personalized for who you are.
              </p>
            </td>
          </tr>

          <!-- ARCHETYPE CARD -->
          <tr>
            <td style="padding:0 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:32px;text-align:center;">
                    <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;color:#2dd4bf;margin:0 0 10px;">${archetypeTag}</p>
                    <h2 style="font-family:Georgia,serif;font-size:26px;color:#ffffff;margin:0 0 16px;">${archetype}</h2>
                    <p style="font-family:Arial,sans-serif;font-size:14px;color:#94a3b8;line-height:1.7;margin:0;">${archetypeDesc}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- DIMENSION SCORES -->
          <tr>
            <td style="padding:0 40px 36px;">
              <h3 style="font-family:Georgia,serif;font-size:17px;color:#0f172a;margin:0 0 18px;">Your Dimension Scores</h3>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${dimScoreRows}
              </table>
            </td>
          </tr>

          <!-- CTA BUTTON -->
          <tr>
            <td style="padding:0 40px 48px;text-align:center;">
              <a href="https://transformedbytravels.vercel.app/trip-planner.html" style="display:inline-block;background:#2dd4bf;color:#0f172a;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:14px 36px;border-radius:8px;">Explore Your Destinations →</a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="font-family:Arial,sans-serif;font-size:12px;color:#94a3b8;margin:0;">© Transformed by Travels · All rights reserved</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, archetype, archetypeTag, archetypeDesc, scores } = req.body;
  console.log('send-email called:', { name, email, archetype });
  console.log('RESEND_API_KEY present:', !!process.env.RESEND_API_KEY);
  if (!email || !name) {
    console.log('Missing name or email');
    return res.status(400).json({ error: 'Missing name or email' });
  }

  const html = buildEmailHTML(name, archetype, archetypeTag, archetypeDesc, scores);
  const payload = JSON.stringify({
    from: 'YourResults@TransformedbyTravels.com',
    to: email,
    subject: `${name}, your Transformational Travel Profile is ready`,
    html: html
  });

  const options = {
    hostname: 'api.resend.com',
    path: '/emails',
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };

  const request = https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        console.log('Resend response status:', response.statusCode, 'body:', data);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          res.status(200).json({ success: true, id: parsed.id });
        } else {
          res.status(500).json({ error: parsed.message || 'Send failed', detail: parsed });
        }
      } catch(e) {
        res.status(500).json({ error: 'Parse error', raw: data.slice(0, 200) });
      }
    });
  });

  request.on('error', (err) => {
    console.log('Request error:', err.message);
    res.status(500).json({ error: err.message });
  });

  request.write(payload);
  request.end();
};
