const CACHE_NAME = 'pelp-pal-static-v4';
const APP_ROUTES = ['/', '/login', '/dashboard', '/lookup', '/activity', '/summary', '/report', '/sync', '/account', '/personnel', '/store', '/inspect/work'];
const REPORT_TEMPLATE = '/EMV%20Report%20Sample.docx';

async function prepareOfflineCache() {
  const cache = await caches.open(CACHE_NAME);
  const assets = new Set([REPORT_TEMPLATE]);
  let cachedRoutes = 0;
  for (const route of APP_ROUTES) {
    // Never persist a signed-in navigation response across accounts.
    const response = await fetch(route, { cache: 'reload', credentials: 'omit' });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error(`Offline page unavailable: ${route} (${response.status})`);
    }
    const html = await response.clone().text();
    for (const match of html.matchAll(/(?:src|href)=["'](\/[^"']+)["']/g)) {
      const assetUrl = match[1].replaceAll('&amp;', '&');
      if (assetUrl.startsWith('/_next/static/') || assetUrl.startsWith('/_next/image') || assetUrl.startsWith('/icons/')) assets.add(assetUrl);
    }
    await cache.put(route, response);
    cachedRoutes += 1;
  }
  for (const asset of assets) {
    const response = await fetch(asset, { cache: 'reload', credentials: 'omit' });
    if (!response.ok) throw new Error(`Offline asset unavailable: ${asset} (${response.status})`);
    await cache.put(asset, response);
  }
  return { cachedRoutes, cachedAssets: assets.size - 1, templateCached: true };
}

self.addEventListener('install', (event) => {
  event.waitUntil(prepareOfflineCache().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PREPARE_OFFLINE') return;
  event.waitUntil(prepareOfflineCache().then(
    (result) => event.ports[0]?.postMessage({ type: 'PREPARE_OFFLINE_RESULT', ...result }),
    (error) => event.ports[0]?.postMessage({ type: 'PREPARE_OFFLINE_ERROR', message: String(error) }),
  ));
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
  const isStaticAsset = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname === REPORT_TEMPLATE;
  const isPrecachedRoute = request.mode === 'navigate' && APP_ROUTES.includes(url.pathname);
  if (!isStaticAsset && !isPrecachedRoute) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      if (isPrecachedRoute) {
        try {
          // Online navigation may contain private state; return it without persisting it.
          return await fetch(request);
        } catch {
          const cached = await cache.match(url.pathname);
          if (cached) return cached;
          throw new Error('The app shell is not available offline yet.');
        }
      }
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }),
  );
});
