import { useState } from 'react';
import { registerPushNotifications } from './firebaseMessaging';

export default function App() {
  const [token, setToken] = useState<string>('');
  const [status, setStatus] = useState<string>('Push notifications are not enabled yet.');

  const handleEnablePush = async () => {
    try {
      setStatus('Requesting notification permission...');
      const fcmToken = await registerPushNotifications();
      setToken(fcmToken);
      setStatus('Push notifications enabled successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to enable push notifications.';
      setStatus(message);
    }
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 820, margin: '0 auto' }}>
      <h1>BIT Updates Notifications</h1>
      <p>{status}</p>
      <button onClick={handleEnablePush} type="button" style={{ padding: '0.75rem 1rem', cursor: 'pointer' }}>
        Enable Push Notifications
      </button>

      {token ? (
        <>
          <h2 style={{ marginTop: '1.5rem' }}>FCM Device Token</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f3f4f6', padding: '1rem', borderRadius: 8 }}>
            {token}
          </pre>
        </>
      ) : null}
    </main>
  );
}
