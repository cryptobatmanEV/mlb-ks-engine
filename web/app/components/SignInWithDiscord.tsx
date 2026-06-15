'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export default function SignInWithDiscord({ callbackUrl }: { callbackUrl?: string }) {
  const router = useRouter();
  const [inIframe, setInIframe] = useState(false);

  // Mobile browsers (and Discord's embedded webview) block OAuth redirects
  // that happen inside an iframe, so those cases open the sign-in flow in a
  // new tab instead of redirecting the current frame.
  useEffect(() => {
    setInIframe(window.self !== window.top);
  }, []);

  function handleClick() {
    if (inIframe || isMobileDevice()) {
      const url = callbackUrl
        ? `/api/auth/signin/discord?callbackUrl=${encodeURIComponent(callbackUrl)}`
        : '/api/auth/signin/discord';
      window.open(url, '_blank');
      // Pick up the new session once the user comes back to this tab.
      window.addEventListener('focus', () => router.refresh(), { once: true });
      return;
    }
    signIn('discord', { callbackUrl });
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
