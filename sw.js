// Loopd Service Worker — handles push notifications and offline caching
const CACHE_NAME = 'loopd-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Handle incoming push notifications
self.addEventListener('push', e => {
  let data = { title: 'Loopd', body: 'You have a new update from your village 💜', icon: '/Loopd/icon-192.png', badge: '/Loopd/icon-192.png', tag: 'loopd-notification' };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch(err) {}

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/Loopd/icon-192.png',
      badge: data.badge || '/Loopd/icon-192.png',
      tag: data.tag || 'loopd-notification',
      data: { url: data.url || 'https://ilgoldman-create.github.io/Loopd' },
      vibrate: [200, 100, 200],
      requireInteraction: false,
    })
  );
});

// Open the app when notification is tapped
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || 'https://ilgoldman-create.github.io/Loopd';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('Loopd') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});
