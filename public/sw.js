// Cache only the app shell. AniList requests stay network-only so schedule data
// is never silently served stale, and the UI can report network errors.
const CACHE = 'otaku-time-shell-v1';
const SHELL = new URL('./', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('otaku-time-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.mode !== 'navigate' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(SHELL, copy)));
    }
    return response;
  }).catch(() => caches.match(SHELL)));
});

// A reminder opens its show inside the installed app or an existing tab.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.mediaId;
  const url = new URL(id ? `./#show/${id}` : './', self.registration.scope).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) {
      await existing.navigate(url);
      return existing.focus();
    }
    return clients.openWindow(url);
  }));
});
