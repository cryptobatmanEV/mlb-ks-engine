'use client';

import { useEffect, useState } from 'react';

// Shown after a delay so first-time sign-ins (which can wait on a cold
// database) don't look like the page has stalled or login failed.
export default function LoadingTimeoutMessage() {
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShowHint(true), 10000);
    return () => clearTimeout(t);
  }, []);

  if (!showHint) return null;

  return (
    <div style={{ fontSize: '11px', color: 'var(--ev-dim)', marginTop: '14px' }}>
      Still loading — this can take a moment on first sign-in
    </div>
  );
}
