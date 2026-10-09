import React, { useEffect, useState } from 'react';
import DesktopDashboard from './pages/DesktopDashboard';
import PhoneCamera from './pages/PhoneCamera';

function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');
    if (session) {
      setSessionId(session);
    }
  }, []);

  if (sessionId) {
    return <PhoneCamera sessionId={sessionId} />;
  }

  return <DesktopDashboard />;
}

export default App;
