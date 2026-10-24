self.addEventListener('push', (event) => {
  let data = { title: 'possistem', body: '' };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'possistem', {
      body: data.body || '',
      icon: '/pos/app/icon-192.png',
      badge: '/pos/app/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.includes('/pos/app/'));
      if (existing) {
        existing.navigate('/pos/app/activity');
        return existing.focus();
      }
      return clients.openWindow('/pos/app/activity');
    }),
  );
});
