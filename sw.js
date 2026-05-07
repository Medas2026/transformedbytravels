const CACHE_NAME    = 'tbt-field-guide-v1';
const SPECIES_CACHE = 'tbt-species-v1';

// App shell — always cached on install
const SHELL_ASSETS = [
  '/wildlife-guide.html',
  '/manifest.json',
  '/images/app-icon-256.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== SPECIES_CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Species pack — serve from cache, fall back to network
  if (url.pathname === '/api/species-pack') {
    e.respondWith(
      caches.open(SPECIES_CACHE).then(async c => {
        const cached = await c.match(e.request.url);
        if (cached) return cached;
        const resp = await fetch(e.request);
        if (resp.ok) c.put(e.request.url, resp.clone());
        return resp;
      })
    );
    return;
  }

  // App shell — cache first
  if (SHELL_ASSETS.some(a => url.pathname === a || url.pathname.endsWith(a))) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
    return;
  }

  // Cloudinary species photos — cache as they're viewed
  if (url.hostname.includes('cloudinary.com') || url.hostname.includes('res.cloudinary.com')) {
    e.respondWith(
      caches.open(SPECIES_CACHE).then(async c => {
        const cached = await c.match(e.request);
        if (cached) return cached;
        try {
          const resp = await fetch(e.request);
          if (resp.ok) c.put(e.request, resp.clone());
          return resp;
        } catch {
          return new Response('', { status: 503 });
        }
      })
    );
    return;
  }

  // Everything else — network with cache fallback
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Message from page: clear species cache and re-download
self.addEventListener('message', e => {
  if (e.data === 'clear-species-cache') {
    caches.delete(SPECIES_CACHE).then(() => {
      e.source.postMessage('species-cache-cleared');
    });
  }
});
