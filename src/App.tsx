import React, { useEffect, useState } from 'react';
import DesktopDashboard from './pages/DesktopDashboard';
import PhoneCamera from './pages/PhoneCamera';

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = () => {
      const params = new URLSearchParams(window.location.search);
      const session = params.get('session');
      setSessionId(session);
    };

    checkSession();
    window.addEventListener('popstate', checkSession);
    return () => window.removeEventListener('popstate', checkSession);
  }, []);

  if (sessionId) {
    return <PhoneCamera sessionId={sessionId} />;
  }

  return <DesktopDashboard />;
}
