/* Offline support: the whole app is cached on install and served from the cache.
   Bump VERSION on every deploy — that is what makes phones pick up the new files. */
const VERSION = 'calc-v28'; // keep the number in step with APP_VERSION in app.js
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './units.js',
  './engine.js',
  './rates.js',
  './convert.js',
  './help.js',
  './share.js',
  './intro.js',
  './app.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  // the guide's screenshots (intro.js; the web version's set)
  './intro/data.js',
  ...['1a', '1b', '1c', '2a', '2b', '2c', '3a', '3b', '3c', '4a', '4b', '4c'].map(n => `./intro/w${n}.webp`),
];

self.addEventListener('install', event => {
  // cache: 'reload' skips the browser's own copy (GitHub Pages lets it keep files for 10 minutes),
  // so a new version never gets cached with the previous version's files.
  const fresh = ASSETS.map(url => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Exchange-rate requests (other origins) go straight to the network; the app keeps its own saved copy.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req))
  );
});
