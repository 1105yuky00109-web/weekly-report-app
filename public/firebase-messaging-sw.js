// Firebase Cloud Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyBero5buqjW670UPObtf4QiVX-rkhhFfPs",
    authDomain: "weekly-report-93e5f.firebaseapp.com",
    projectId: "weekly-report-93e5f",
    storageBucket: "weekly-report-93e5f.firebasestorage.app",
    messagingSenderId: "905872831436",
    appId: "1:905872831436:web:1367ad0b1d54d9bba7a369"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// バックグラウンド通知の受信処理
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message: ', payload);
    
    const notificationTitle = payload.notification ? payload.notification.title : '週報システム';
    const notificationOptions = {
        body: payload.notification ? payload.notification.body : '新しい週報の提出または変更がありました。',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: payload.data || {}
    };

    // Badging API を使用してアプリアイコンにバッジを表示
    if (payload.data && payload.data.badgeCount) {
        const badgeCount = parseInt(payload.data.badgeCount, 10);
        if (!isNaN(badgeCount) && 'setAppBadge' in navigator) {
            navigator.setAppBadge(badgeCount).catch(err => {
                console.error('Failed to set app badge: ', err);
            });
        }
    }

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// 通知をクリックした時の処理
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    // アプリのURLを開く、または既存のウィンドウにフォーカスする
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ('focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
