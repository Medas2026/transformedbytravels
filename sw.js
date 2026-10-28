const CACHE_NAME    = 'tbt-field-guide-v6';
const SPECIES_CACHE = 'tbt-species-v3';

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

  // Trip content APIs — species pack + park stops. Network-first so online
  // customers always get fresh data; fall back to cache when offline.
  if (url.pathname === '/api/species-pack' ||
      url.pathname === '/api/species-pack-trip' ||
      url.pathname === '/api/trip-stops') {
    e.respondWith(
      caches.open(SPECIES_CACHE).then(async c => {
        try {
          const resp = await fetch(e.request);
          if (resp.ok) c.put(e.request.url, resp.clone());
          return resp;
        } catch {
          const cached = await c.match(e.request.url);
          if (cached) return cached;
          throw new Error('offline and no cached content');
        }
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

  // Species photos: hosts we cache to enable offline browsing.
  const isSpeciesPhoto =
    url.hostname.includes('cloudinary.com') ||
    url.hostname.includes('res.cloudinary.com') ||
    url.hostname.endsWith('wikimedia.org') ||
    url.hostname.endsWith('wikipedia.org') ||
    /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url.pathname);

  if (isSpeciesPhoto) {
    // If we already have a cached copy, serve it (offline path). Otherwise, do
    // NOT intercept — let the browser fetch the image natively so we don't have
    // to route through the SW's CSP-restricted fetch. In the background we
    // still try to grab a copy for later offline use.
    e.respondWith((async () => {
      const c = await caches.open(SPECIES_CACHE);
      const cached = await c.match(e.request);
      if (cached) return cached;
      // Kick off a background cache — swallow all errors so nothing blocks the img
      fetch(e.request.url, { mode: 'no-cors' })
        .then(r => { if (r) c.put(e.request, r).catch(() => {}); })
        .catch(() => {});
      // Actually fulfill the img request with a fresh, un-cloned fetch
      return fetch(e.request);
    })());
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
