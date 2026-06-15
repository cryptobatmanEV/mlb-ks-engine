'use client';

import { useEffect } from 'react';

const LABEL: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '10px',
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color:         'var(--ev-dim)',
};

// Landing page for the Discord OAuth callback. When sign-in happened in a
// popup tab (iframe-embedded or mobile flows), this tells the opener it can
// reload with the new session and closes itself. Otherwise it's a direct
// visit, so just continue on to the tracker.
export default function AuthSuccessPage() {
  useEffect(() => {
    if (window.opener) {
      window.opener.postMessage('discord-auth-success', 'https://theevcave.com');
      window.close();
    } else {
      window.location.href = '/tracker';
    }
  }, []);

  return (
    <main style={{
      minHeight:      '100vh',
      background:     'var(--ev-bg)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      padding:        '20px',
      textAlign:      'center',
    }}>
      <div>
        <div className="ks-spinner" style={{ marginBottom: '16px' }} />
        <div style={{ ...LABEL, color: 'var(--ev-green)', marginBottom: '8px' }}>
          LOGIN SUCCESSFUL
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ev-text)' }}>
          Returning you to the tool...
        </div>
      </div>
    </main>
  );
}
