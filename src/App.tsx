import React, { useEffect, useState } from 'react';
import DesktopDashboard from './pages/DesktopDashboard';
import PhoneCamera from './pages/PhoneCamera';

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState<string>('');
  const [mode, setMode] = useState<string>('');

  useEffect(() => {
    const checkSession = () => {
      const params = new URLSearchParams(window.location.search);
      const session = params.get('session');
      setSessionId(session);
      setBackendUrl(params.get('backend') || '');
      setMode(params.get('mode') || '');
    };

    checkSession();
    window.addEventListener('popstate', checkSession);
    return () => window.removeEventListener('popstate', checkSession);
  }, []);

  if (sessionId) {
    return (
      <PhoneCamera
        sessionId={sessionId}
        initialBackendUrl={backendUrl}
        initialMode={mode}
      />
    );
  }

  return <DesktopDashboard />;
}
