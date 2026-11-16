/* Offline support: try the network first so updates arrive, fall back to the saved copy. */
const CACHE = 'nn-pos-shell-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'assets/app.css', 'assets/js/store.js', 'assets/js/sheet.js', 'assets/js/sync.js', 'assets/js/app.js',
  'assets/fonts/geist-latin-wght-normal.woff2', 'assets/fonts/instrument-serif-latin-400-normal.woff2', 'assets/fonts/instrument-serif-latin-400-italic.woff2',
  'assets/icons/icon-180.png', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
