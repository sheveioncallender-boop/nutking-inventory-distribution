const CACHE = 'nutking-operations-v0.5.0';
const APP_SHELL = '/nutking/';
const STATIC_PREFIXES = [
  '/nutking_inventory_distribution/static/offline/',
  '/nutking_inventory_distribution/static/img/',
  '/nutking_inventory_distribution/static/description/',
];
const CORE_ASSETS = [
  APP_SHELL,
  '/nutking_inventory_distribution/static/offline/app-v0.5.0.css',
  '/nutking_inventory_distribution/static/offline/app-v0.5.0.js',
  '/nutking_inventory_distribution/static/offline/hybrid-v0.5.0.js',
  '/nutking_inventory_distribution/static/img/nutking_logo.png',
  '/nutking_inventory_distribution/static/img/nutking_logo.webp',
  '/nutking_inventory_distribution/static/description/icon-192.png',
  '/nutking_inventory_distribution/static/description/icon-512.png',
  '/nutking/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(APP_SHELL, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(APP_SHELL)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/nutking/api/')) return;

  if (request.mode === 'navigate' && (url.pathname === '/nutking' || url.pathname === '/nutking/')) {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (
    url.pathname === '/nutking/manifest.webmanifest'
    || STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    event.respondWith(cacheFirst(request));
  }
});
