// Offline cache for angelstyle.com/sud. Registered by the page with scope
// '/sud', so it only ever sees the sudoku page and the files that page loads.
//
// The page HTML is network-first (a new deploy shows up as soon as you are
// online) with the cached copy as the fallback. Next's /_next/static files are
// content-hashed, so those are cache-first: a stored one is never stale.

const CACHE = 'sud-v1';
const PAGE = '/sud';
const EXTRAS = ['/sud/manifest.webmanifest', '/sud/icon-180.png', '/sud/icon-192.png', '/sud/icon-512.png'];

async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch(PAGE, { cache: 'no-store' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(PAGE, res);
  const assets = new Set(EXTRAS);
  for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) assets.add(m[0]);
  await Promise.all([...assets].map((u) => cache.add(u).catch(() => {})));
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sud-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cache' || !Array.isArray(e.data.urls)) return;
  const urls = e.data.urls.filter((u) => typeof u === 'string' && new URL(u).origin === self.location.origin);
  e.waitUntil(caches.open(CACHE).then(async (cache) => {
    for (const u of urls) if (!(await cache.match(u))) await cache.add(u).catch(() => {});
  }));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || url.pathname === PAGE) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put(PAGE, res.clone()));
          return res;
        })
        .catch(() => caches.match(PAGE).then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/sud/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      })),
    );
  }
});
