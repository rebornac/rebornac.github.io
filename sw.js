const CACHE_NAME = 'forjafit-cache-v1.4.0';
// Kept across app versions so illustrations are not downloaded again.
// Change it only when the files in assets/exercises change.
const MEDIA_CACHE = 'forjafit-media-v1';
const MEDIA_PATH = '/assets/exercises/';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/db.js',
  './js/domain.js',
  './js/muscle-map.js',
  './js/timer.js',
  './js/app.js',
  './data/exercises.json',
  './data/plans.json',
  './data/exercise-media.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

const IS_LOCAL_DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Bypass the HTTP cache so a new version never stores stale files
      .then((cache) => cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== MEDIA_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

async function matchCached(request) {
  const cache = await caches.open(CACHE_NAME);
  if (request.mode === 'navigate') {
    return (await cache.match(request, { ignoreSearch: true })) || cache.match('./index.html');
  }
  return cache.match(request);
}

// Production serves only the versioned cache, so one app version never mixes
// files with another. Publishing a new CACHE_NAME is what delivers an update.
async function respond(request) {
  if (IS_LOCAL_DEV) {
    try {
      return await fetch(request);
    } catch (err) {
      const cached = await matchCached(request);
      if (cached) return cached;
      throw err;
    }
  }
  return (await matchCached(request)) || fetch(request);
}

async function respondMedia(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// Downloads in small batches and skips what is already saved, so an
// interrupted download simply continues on the next launch.
async function cacheAllMedia() {
  const core = await caches.open(CACHE_NAME);
  const manifest = await core.match('./data/exercise-media.json');
  if (!manifest) return;
  const media = await manifest.json();
  const urls = [...new Set(Object.values(media).flatMap((m) => m.files))]
    .map((file) => new URL(`./assets/exercises/${file}`, self.registration.scope).href);
  const cache = await caches.open(MEDIA_CACHE);
  const saved = new Set((await cache.keys()).map((r) => r.url));
  const pending = urls.filter((url) => !saved.has(url));
  for (let i = 0; i < pending.length; i += 6) {
    await Promise.all(pending.slice(i, i + 6).map(async (url) => {
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        // Offline: this file is retried on the next launch
      }
    }));
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'cache-media') event.waitUntil(cacheAllMedia());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(url.pathname.includes(MEDIA_PATH) ? respondMedia(event.request) : respond(event.request));
});
