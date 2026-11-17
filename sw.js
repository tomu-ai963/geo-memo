// GeoMemo service worker
// - アプリ本体（HTML）はネットワーク優先。オンラインなら常に最新を取り、取れたらキャッシュを更新する。
//   オフライン・応答が遅いときだけキャッシュを返す
// - アイコン等の静的ファイルはキャッシュ優先
// - Google Fonts は stale-while-revalidate（オフラインでも一度読んだフォントは出る）
// メモ本体は localStorage にあるので、ここでは扱わない。
// 事前キャッシュするファイルを増減したら VERSION を上げる。

const VERSION = 'v1';
const APP_CACHE = `geomemo-app-${VERSION}`;
const FONT_CACHE = 'geomemo-fonts';
const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('geomemo-app-') && k !== APP_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(APP_CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(fallbackUrl, res.clone());
    return res;
  });
  network.catch(() => {}); // タイムアウトで先にキャッシュを返したときの未処理 rejection を防ぐ

  const cached = await cache.match(fallbackUrl);
  if (!cached) return network;

  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}

async function cacheFirst(req) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || network;
}
