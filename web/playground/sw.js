// Service worker: lets the playground open and run offline after one visit.
// - Pages, code and data from this site: network first, cached copy when offline,
//   so a new deploy is picked up on the next online visit.
// - The pinned Python runtime (/pyodide/<version>/): cache first; its URL changes
//   with the version, so a cached copy is never stale.
// - Anything else, notably the ORCID API, is not intercepted and never cached.
const VERSION = '__BUILD__';
const CACHE = `orcid-playground-${VERSION}`;
// Kept across deploys: re-downloading the ~14 MB runtime for every site change would be wasteful.
const RUNTIME = 'orcid-playground-runtime';
const SHELL = ['/', '/network/', '/group/', '/team/', '/cloud.js', '/team.js', '/playground.css', '/studio.js', '/group.js', '/group-link.js', '/digest.js', '/teampack.js',
  '/engine.js', '/engine-client.js', '/auth.js', '/network-bridge.js', '/orcid-biosketch.js', '/orcid-group.js',
  '/network/app.js', '/network/style.css', '/py/orcid_biosketch.zip', '/generated/biosketch.json',
  '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('orcid-playground-') && k !== CACHE && k !== RUNTIME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Sign-in configuration must always be current; it is tiny.
  if (url.pathname === '/config.json') return;
  event.respondWith(url.pathname.startsWith('/pyodide/') ? cacheFirst(event.request) : networkFirst(event.request));
});
