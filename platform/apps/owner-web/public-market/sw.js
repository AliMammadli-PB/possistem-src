self.addEventListener('push', (event) => {
  let data = { title: 'Market POS', body: '' };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Market POS', {
      body: data.body || '',
      icon: '/marketpos/icon-192.png',
      badge: '/marketpos/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.includes('/marketpos/'));
      if (existing) {
        existing.navigate('/marketpos/');
        return existing.focus();
      }
      return clients.openWindow('/marketpos/');
    }),
  );
});
