'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';

const BTN: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '11px',
  letterSpacing: '2px',
  textTransform: 'uppercase',
  borderRadius:  '2px',
  padding:       '10px 20px',
  cursor:        'pointer',
  color:         '#fff',
  background:    '#5865F2',
  border:        '1px solid #5865F2',
  fontWeight:    600,
};

const HINT: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '10px',
  letterSpacing: '1px',
  color:         'var(--ev-dim)',
  marginTop:     '10px',
};

// Discord auth always lands on /auth/success, which either posts a message
// back to this tab (popup flow) or continues on to /tracker (direct visit).
const AUTH_CALLBACK_URL = '/auth/success';

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export default function SignInWithDiscord() {
  const [inIframe, setInIframe] = useState(false);

  // Mobile browsers (and Discord's embedded webview) block OAuth redirects
  // that happen inside an iframe, so those cases open the sign-in flow in a
  // new tab instead of redirecting the current frame.
  useEffect(() => {
    setInIframe(window.self !== window.top);
  }, []);

  // When the popup tab finishes Discord auth, /auth/success posts this
  // message back so the embedded iframe can reload with the new session.
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.origin !== 'https://theevcave.com' && e.origin !== 'https://mlb-ks-engine.vercel.app') return;
      if (e.data === 'discord-auth-success') {
        window.location.reload();
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  function handleClick() {
    if (inIframe || isMobileDevice()) {
      window.open(
        `/api/auth/signin/discord?callbackUrl=${encodeURIComponent(AUTH_CALLBACK_URL)}`,
        '_blank'
      );
      return;
    }
    signIn('discord', { callbackUrl: AUTH_CALLBACK_URL });
  }

  return (
    <div>
      <button onClick={handleClick} style={BTN}>
        Sign in with Discord
      </button>
      {inIframe && (
        <div style={HINT}>
          A new tab will open for sign-in — return here after completing.
        </div>
      )}
    </div>
  );
}
