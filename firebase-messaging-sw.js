// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBqB_cOk2ESbtHxCYkQRh3rx4P6WHqDpiQ",
    authDomain: "smart-expiry-fcm.firebaseapp.com",
    projectId: "smart-expiry-fcm",
    storageBucket: "smart-expiry-fcm.firebasestorage.app",
    messagingSenderId: "327136614137",
    appId: "1:327136614137:web:31bf2948b0b909b45fb428"
});

const messaging = firebase.messaging();

console.log('[firebase-messaging-sw.js] Messaging initialized');

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message: ', payload);

    const notificationTitle = payload.notification.title || 'Smart Household Assistant';
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/android-launchericon-192-192.png',
        badge: '/android-launchericon-192-192.png',
        tag: 'fcm-background-test',
        renotify: true
    };

    console.log('[firebase-messaging-sw.js] Showing notification:', notificationTitle);
    self.registration.showNotification(notificationTitle, notificationOptions);
});
