'use client';
import { useState } from 'react';

const LOGO_URLS: Record<string, string[]> = {
  pinnacle:   ['https://cdn.brandfetch.io/pinnacle.com/w/400/h/400',        'https://www.google.com/s2/favicons?domain=pinnacle.com&sz=32'],
  fanduel:    ['https://cdn.brandfetch.io/fanduel.com/w/400/h/400',         'https://www.google.com/s2/favicons?domain=fanduel.com&sz=32'],
  draftkings: ['https://cdn.brandfetch.io/draftkings.com/w/400/h/400',      'https://www.google.com/s2/favicons?domain=draftkings.com&sz=32'],
  betrivers:  ['https://cdn.brandfetch.io/betrivers.com/w/400/h/400',       'https://www.google.com/s2/favicons?domain=betrivers.com&sz=32'],
  novig:      ['https://cdn.brandfetch.io/novig.us/w/400/h/400',            'https://www.google.com/s2/favicons?domain=novig.us&sz=32'],
  betmgm:     ['https://cdn.brandfetch.io/betmgm.com/w/400/h/400',         'https://www.google.com/s2/favicons?domain=betmgm.com&sz=32'],
  prizepicks: ['https://cdn.brandfetch.io/prizepicks.com/w/400/h/400',      'https://www.google.com/s2/favicons?domain=prizepicks.com&sz=32'],
  underdog:   ['https://cdn.brandfetch.io/underdogfantasy.com/w/400/h/400', 'https://www.google.com/s2/favicons?domain=underdogfantasy.com&sz=32'],
};

const BRAND_COLORS: Record<string, string> = {
  pinnacle:   '#ffcc00',
  fanduel:    '#1493ff',
  draftkings: '#53d338',
  betrivers:  '#e31c1c',
  novig:      '#7c3aed',
  betmgm:     '#bf9b30',
  prizepicks: '#7c3aed',
  underdog:   '#ff6b35',
};

function BookBadge({ letter, color, size }: { letter: string; color: string; size: number }) {
  return (
    <span style={{
      display:        'inline-flex',
      alignItems:     'center',
      justifyContent: 'center',
      width:          size,
      height:         size,
      borderRadius:   '50%',
      background:     color,
      color:          '#000',
      fontFamily:     'system-ui, sans-serif',
      fontSize:       Math.max(8, Math.floor(size * 0.55)),
      fontWeight:     700,
      verticalAlign:  'middle',
      marginRight:    6,
      flexShrink:     0,
    }}>
      {letter}
    </span>
  );
}

export function BookLogo({ bookKey, size = 18 }: { bookKey: string; size?: number }) {
  const [urlIndex, setUrlIndex] = useState(0);
  const urls  = LOGO_URLS[bookKey];
  const color = BRAND_COLORS[bookKey] ?? '#555';
  const letter = bookKey.charAt(0).toUpperCase();

  if (!urls || urlIndex >= urls.length) {
    return <BookBadge letter={letter} color={color} size={size} />;
  }

  return (
    <img
      src={urls[urlIndex]}
      width={size}
      height={size}
      style={{ borderRadius: '50%', verticalAlign: 'middle', marginRight: 6, objectFit: 'cover' }}
      onError={() => setUrlIndex(i => i + 1)}
    />
  );
}
