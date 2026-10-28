const C = 'scanner-v3';
const A = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(A)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim())
));
// network-first: laging bagong code kapag may internet, cache lang kapag offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(res => {
    const cp = res.clone(); caches.open(C).then(c => c.put(e.request, cp)); return res;
  }).catch(() => caches.match(e.request)));
});
