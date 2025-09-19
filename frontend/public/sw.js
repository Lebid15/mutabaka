/* Basic Web Push Service Worker */
self.addEventListener('push', function (event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || (data.senderDisplay || 'New message');
  const body = data.body || data.preview || '';
  const icon = '/icons/notification.png';
  const badge = '/icons/notification.png';
  const notificationData = {
    clickUrl: data.clickUrl || '/',
    conversationId: data.conversationId,
    type: data.type || 'message',
  };
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data: notificationData,
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const url = (event.notification && event.notification.data && event.notification.data.clickUrl) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windowClients => {
      // If any client is our app origin, try to navigate it to the target and focus
      const origin = self.location.origin;
      for (const client of windowClients) {
        if (client.url && client.url.startsWith(origin)) {
          try { if ('navigate' in client) { await client.navigate(url); } } catch {}
          try { return client.focus(); } catch { /* ignore */ }
        }
      }
      // No existing client; open a new window
      return clients.openWindow(url);
    })
  );
});
