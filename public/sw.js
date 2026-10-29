const C = 'anon-v3', F = ['/', '/manifest.json', '/icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(F))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return; // nunca interceptar /join ni /send
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
