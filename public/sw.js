const CACHE_NAME = 'pelp-pal-static-v3';
const APP_ROUTES = ['/', '/login', '/dashboard', '/lookup', '/activity', '/summary', '/report', '/sync', '/account'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await Promise.allSettled(APP_ROUTES.map(async (route) => {
          const response = await fetch(route, { cache: 'reload' });
          if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            await cache.put(route, response);
          }
        }));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => Promise.all(cacheNames.filter((cacheName) => cacheName !== CACHE_NAME).map((cacheName) => caches.delete(cacheName))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isStaticAsset = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
  const isPrecachedRoute = request.mode === 'navigate' && APP_ROUTES.includes(url.pathname);
  if (!isStaticAsset && !isPrecachedRoute) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (isPrecachedRoute) {
        try {
          const response = await fetch(request);
          if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          if (cached) return cached;
          throw new Error('The app shell is not available offline yet.');
        }
      }
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }),
  );
});
