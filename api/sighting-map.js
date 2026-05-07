const SIGHTINGS = [
  { lat: -0.9833, lon: 29.6167, type: 'primate' },
  { lat: -1.0200, lon: 29.7000, type: 'primate' },
  { lat:  2.2847, lon: 31.7583, type: 'bird'    },
  { lat:  2.1500, lon: 31.6000, type: 'mammal'  },
  { lat:  2.2000, lon: 31.8000, type: 'mammal'  },
  { lat:  0.4833, lon: 30.4000, type: 'primate' },
  { lat:  0.5100, lon: 30.3600, type: 'mammal'  },
  { lat: -0.1200, lon: 30.0000, type: 'mammal'  },
  { lat: -0.0800, lon: 29.9000, type: 'mammal'  },
  { lat: -0.2000, lon: 29.8500, type: 'mammal'  },
  { lat: -0.1500, lon: 30.0500, type: 'mammal'  },
  { lat:  1.5800, lon: 32.4700, type: 'mammal'  },
  { lat: -0.6200, lon: 30.9500, type: 'mammal'  },
  { lat: -0.5800, lon: 30.9000, type: 'mammal'  },
  { lat:  2.1800, lon: 31.7000, type: 'bird'    },
  { lat: -0.1000, lon: 30.0200, type: 'bird'    },
];

const HEX = { mammal: '86efac', bird: '2dd4bf', primate: 'fbbf24' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const token = process.env.MAPBOX_TOKEN;
  if (!token) return res.status(503).send('MAPBOX_TOKEN not configured');

  const pins = SIGHTINGS.map(s => `pin-s+${HEX[s.type]}(${s.lon},${s.lat})`).join(',');
  const url  = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${pins}/31.0,1.0,6.2/1200x420?access_token=${token}`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).send(`Mapbox error ${upstream.status}: ${text}`);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).end(buf);
  } catch (e) {
    return res.status(502).send(e.message);
  }
};
