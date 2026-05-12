const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const FCM_VAPID_KEY = 'dcUxUzpUGTEmgSZL-CXHwvFu39df3uhiPdnQIHMZ6Jk';

export async function registerPushNotifications(): Promise<string> {
  if (!('Notification' in window)) throw new Error('This browser does not support notifications.');

  const [{ initializeApp }, { getMessaging, getToken, isSupported }] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging.js'),
  ]);

  const supported = await isSupported();
  if (!supported) throw new Error('Firebase messaging is not supported in this browser.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const app = initializeApp(firebaseConfig);
  const messaging = getMessaging(app);

  const token = await getToken(messaging, { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Unable to retrieve FCM token.');

  return token;
}
