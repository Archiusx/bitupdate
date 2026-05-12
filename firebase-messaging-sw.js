/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDAwty9lfGsj-hAf1QffMJLtvUfhdd_SPI',
  authDomain: 'loginx-897b3.firebaseapp.com',
  databaseURL: 'https://loginx-897b3-default-rtdb.firebaseio.com',
  projectId: 'loginx-897b3',
  storageBucket: 'loginx-897b3.firebasestorage.app',
  messagingSenderId: '380291415413',
  appId: '1:380291415413:web:6d222db905e4457e29e73c',
  measurementId: 'G-BM6PMDKN5V',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'BIT Updates';
  const options = {
    body: payload.notification?.body || 'You have a new notification.',
    icon: '/vite.svg',
  };

  self.registration.showNotification(title, options);
});
