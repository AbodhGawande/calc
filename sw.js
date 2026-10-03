/* Offline support: the whole app is kept on the phone and opened from there — the internet is only used to look for
   a new version (and for exchange rates). Bump VERSION on every deploy — that is what makes phones pick up the new
   files. */
const VERSION = 'calc-v30'; // keep the number in step with APP_VERSION in app.js
// The app itself: fetched when a version is installed.
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
  './intro/data.js',
];
// The guide's screenshots (intro.js): fetched afterwards, when the page asks, so a new version never waits for them.
const PICTURES = ['1', '2', '3', '4', '5', '6'].flatMap(p => ['a', 'b', 'c'].map(f => `./intro/${p}${f}.webp`))
  .concat(['a', 'b', 'c', 'd'].map(f => `./intro/7${f}.webp`));   // page 7: Safari's "Add to Home Screen" steps

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

// The page says "pictures" once it's up: store any of the guide's screenshots that aren't on the phone yet.
self.addEventListener('message', event => {
  if (event.data !== 'pictures') return;
  event.waitUntil(caches.open(VERSION).then(cache => Promise.all(PICTURES.map(url =>
    cache.match(url).then(hit => hit || cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Exchange-rate requests (other origins) go straight to the network; the app keeps its own saved copy.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // From the phone's copy; anything not there yet is fetched once and kept.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(cache => cache.put(req, copy)); }
      return res;
    }))
  );
});
