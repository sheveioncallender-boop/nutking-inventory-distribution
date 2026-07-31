const CACHE = 'nutking-offline-shell-v3';
const SHELL = '/nutking/offline';
const ASSETS = [
  SHELL,
  '/nutking/rapid-scan',
  '/nutking_inventory_distribution/static/offline/app.js',
  '/nutking_inventory_distribution/static/img/nutking_logo.png',
  '/nutking/manifest.webmanifest',
];
self.addEventListener('install', (event) => event.waitUntil(
  caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).pathname.startsWith('/nutking/api/')) return;
  event.respondWith(
    fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match(SHELL);
      return Response.error();
    })
  );
});
