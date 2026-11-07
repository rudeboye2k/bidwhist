/* Give Me Da Kitty — offline support.
 * Network first (so every deploy reaches players at once), falling back to the
 * last copy cached here when there's no signal. Solo play needs nothing from
 * the server, so a phone that's been here once can play the computer offline.
 * Online play (/api/*) is never cached. */
const CACHE = 'gmdk-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/engine.js', 'js/ai.js', 'js/room-core.js', 'js/qrcode.js', 'js/net.js', 'js/app.js',
  'img/icon-192.png', 'img/icon-512.png', 'img/apple-touch-icon.png', 'img/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if ((!sameOrigin && !fonts) || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        // Cache by path without the ?v= tag, so offline lookups still match.
        const key = sameOrigin ? url.origin + url.pathname : req;
        cache.put(key, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      const key = sameOrigin ? url.origin + url.pathname : req;
      const hit = (await cache.match(key)) || (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? await cache.match(url.origin + '/index.html') || await cache.match('index.html') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
