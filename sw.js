// sw.js - Web Push Notification Service Worker for iOS & Modern Browsers
self.addEventListener('install', event => {
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
    let data = { title: '龙高北小站', body: '您收到了一条新动态通知', url: '/messages.html' };
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch(e) {
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body || '您收到了一条新动态通知',
        icon: '/image/LG.png',
        badge: '/image/LG.png',
        data: data.url || '/messages.html',
        tag: data.tag || 'lg-notification'
    };

    if ('setAppBadge' in navigator && data.unreadCount !== undefined) {
        try {
            if (data.unreadCount > 0) {
                navigator.setAppBadge(data.unreadCount);
            } else {
                navigator.clearAppBadge();
            }
        } catch(e) {}
    }

    event.waitUntil(
        self.registration.showNotification(data.title || '龙高北小站', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const targetUrl = event.notification.data || '/messages.html';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
            for (let i = 0; i < clientList.length; i++) {
                let client = clientList[i];
                if (client.url.includes(location.origin) && 'focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
