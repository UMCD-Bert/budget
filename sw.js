// App-shell voor offline gebruik. Cachet alleen index.html en de Supabase-SDK zelf —
// alle Supabase-API-verzoeken (data) gaan hier ongemoeid aan voorbij en blijven altijd live.
const CACHE_NAME = 'budget-shell-v1';
const SHELL_URLS = [
  new URL('./', self.location).href,
  new URL('index.html', self.location).href,
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !SHELL_URLS.includes(req.url)) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
