// OneSignal — חייב להיות ראשון כדי ש-iOS יזהה את ה-SW
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

/* ⚠️ CLAUDE: bump this on EVERY push to this repo — keep in sync with APP_VERSION in js/app.js
   (increment the -vNN suffix here whenever APP_VERSION changes there, e.g. 'v17' here when
   APP_VERSION becomes '1.0.0-beta.2'). Without this bump, users' devices keep serving old
   cached files and "בדוק אם יש עדכון" in Settings will report "already up to date" even when it isn't. */
const CACHE_NAME = 'madhomv153';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/developer-console.js',
  './js/db.js',
  './js/auth.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW-DIAG] install fired — CACHE_NAME:', CACHE_NAME);
  console.log('[SW-DIAG] APP_SHELL count:', APP_SHELL.length);
  console.log('[SW-DIAG] APP_SHELL files:', JSON.stringify(APP_SHELL));

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache each file individually so we can identify which one fails
      return Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).then(() => {
            console.log('[SW-DIAG] cached OK:', url);
          }).catch((err) => {
            console.error('[SW-DIAG] cache FAILED:', url, '—', err.message);
            throw err; // re-throw so install fails visibly
          })
        )
      );
    }).then(() => {
      console.log('[SW-DIAG] cache.addAll complete — all files cached');
    }).catch((err) => {
      console.error('[SW-DIAG] install failed — error:', err.name, err.message);
    })
  );
  self.skipWaiting();
  console.log('[SW-DIAG] skipWaiting called');
});

self.addEventListener('activate', (event) => {
  console.log('[SW-DIAG] activate fired');
  event.waitUntil(
    caches.keys().then((keys) => {
      console.log('[SW-DIAG] existing caches:', JSON.stringify(keys));
      return Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => {
        console.log('[SW-DIAG] deleting old cache:', k);
        return caches.delete(k);
      }));
    }).then(() => {
      console.log('[SW-DIAG] activate complete — clients.claim()');
    })
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  console.log('[SW-DIAG] message received:', event.data);
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW-DIAG] SKIP_WAITING received — skipWaiting()');
    self.skipWaiting();
  }
});

// Network-first for JS/CSS (always fresh), cache-first for images/icons
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  const isAppFile = url.includes('/js/') || url.includes('/css/') || url.endsWith('index.html') || url.endsWith('/');

  if (isAppFile) {
    // Network-first: always try network, fall back to cache
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first for icons/images
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        });
      })
    );
  }
});













