// Offline support: keeps the app's look & screens on the device.
// Team data (songs, set lists) always comes fresh from the server.
const CACHE = 'cmc-worship-v15';
const SHELL = ['./', './index.html', './css/styles.css', './js/app.js', './js/data.js', './js/config.js',
  './js/demo-backend.js', './js/supabase-backend.js', './js/song-import.js', './js/chart.js', './manifest.webmanifest', './icons/logo-mark.png', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co')) return;          // never cache team data
  const cacheable = url.origin === location.origin || url.hostname === 'cdn.jsdelivr.net' || url.hostname.includes('fonts.g');
  if (!cacheable) return;
  // Network first (so updates show right away), fall back to the saved copy when offline.
  const fresh = url.origin === location.origin ? fetch(e.request, { cache: 'no-cache' }) : fetch(e.request);
  e.respondWith(fresh.then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});

// ── Phone notifications ──
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cornerstone Worship', {
    body: d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || './#/messages' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './#/messages', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
