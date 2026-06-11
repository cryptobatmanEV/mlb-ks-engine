import Nav from '../components/Nav';

// ── Style tokens ───────────────────────────────────────────────────────────

const LABEL: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '10px',
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color:         'var(--ev-dim)',
};

const CARD: React.CSSProperties = {
  background:   'var(--ev-card)',
  border:       '1px solid var(--ev-border)',
  borderRadius: '2px',
};

const TERM: React.CSSProperties = {
  fontFamily:    'var(--font-mono)',
  fontSize:      '11px',
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color:         'var(--ev-green)',
  fontWeight:    600,
};

const DEF: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize:   '12px',
  lineHeight: 1.6,
  color:      'var(--ev-text)',
};

const SUBHEAD: React.CSSProperties = {
  ...LABEL,
  color:        'var(--ev-muted)',
  marginTop:    '16px',
  marginBottom: '8px',
};

// ── Glossary content ────────────────────────────────────────────────────────

const GLOSSARY: { term: string; def: string }[] = [
  {
    term: 'PROJ Ks',
    def: "The model's projected strikeout total for this start (Poisson lambda). This is the expected value, not a hard line.",
  },
  {
    term: 'BOOK O/U',
    def: "Best available strikeout line from sportsbooks, with the price (e.g. -115) and book name shown below it.",
  },
  {
    term: 'BOOK EDGE',
    def: "Model's P(actual Ks > book line) minus the book's implied probability from its price. Green = model sees more value than the book. Red = book is priced above the model's estimate.",
  },
  {
    term: 'PP LINE',
    def: 'PrizePicks strikeout line for this pitcher (typically a whole number, played as -110 over/under).',
  },
  {
    term: 'PP EDGE',
    def: "Model's P(actual Ks > PP line) minus 50% (PrizePicks pick'em pricing). Green = model favors the over.",
  },
  {
    term: 'MY LINE',
    def: 'Enter any strikeout total you found at a book or app. The model recalculates P(over) for that exact number using a Poisson distribution around PROJ Ks.',
  },
  {
    term: 'MY EDGE',
    def: "Model's P(actual Ks > MY LINE) minus 50%, based on the custom total you entered.",
  },
  {
    term: 'K/9 L10',
    def: "Pitcher's strikeouts per 9 innings, rolling average over their last 10 starts.",
  },
  {
    term: 'SWSTR%',
    def: "Swinging-strike rate over the pitcher's last 10 starts. Higher SwStr% generally means more swing-and-miss stuff and more strikeouts.",
  },
  {
    term: 'OPP K%',
    def: "Opposing lineup's strikeout rate over their last 15 team games. Higher = a more strikeout-prone lineup, which favors the pitcher.",
  },
  {
    term: 'PARK',
    def: 'Park factor for strikeouts. 100 = league average. Above 100 = the park suppresses contact and favors strikeouts (e.g. pitcher-friendly parks with more foul territory or tougher backgrounds).',
  },
  {
    term: 'GAME TIME',
    def: 'First pitch time, shown in Eastern Time.',
  },
];

const DETAIL_GLOSSARY: { term: string; def: string }[] = [
  {
    term: 'BB/9, HR/9, WHIP, FIP',
    def: "Standard rate stats over the pitcher's last 10 starts. Lower is generally better for all four. FIP estimates ERA based only on Ks, walks, and home runs allowed.",
  },
  {
    term: 'K%, CALLED STRIKE%, CHASE%, FP STRIKE%',
    def: 'Plate-discipline rates over the last 10 starts: strikeout rate, called-strike rate, chase (swing on pitches outside the zone) rate, and first-pitch strike rate. All trend green when above league average.',
  },
  {
    term: 'PITCH MIX (FB VELO, FASTBALL/SLIDER/CURVEBALL/CHANGEUP/OTHER %)',
    def: "Average fastball velocity and pitch-type usage over the pitcher's last 10 starts, plus average pitch count and innings pitched per start.",
  },
  {
    term: 'OPP K%, OPP OPS, OPP CHASE%',
    def: "Opposing lineup's strikeout rate, OPS, and chase rate over their last 15 team games. High OPP K% and CHASE%, and low OPP OPS, all favor the pitcher's strikeout total.",
  },
  {
    term: 'REST DAYS, PREV PITCHES, PRIOR STARTS',
    def: "Days of rest since the pitcher's last appearance, pitch count in that last appearance, and how many starts they have made so far this season (used by the model to gauge workload and sample size).",
  },
  {
    term: 'PARK K FACTOR, TEMP, WIND, WIND FAVOR',
    def: "Park strikeout factor (100 = average), game-time temperature, wind speed, and whether the wind favors the pitcher (e.g. blowing in, suppressing contact) or the hitter.",
  },
];

// ── Page ───────────────────────────────────────────────────────────────────

export default function GuidePage() {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--ev-bg)', padding: '32px 20px 60px' }}>
      <div style={{ maxWidth: '1380px', margin: '0 auto' }}>

        {/* Header */}
        <header style={{ marginBottom: '28px' }}>
          <div style={{ ...LABEL, color: 'var(--ev-green)', letterSpacing: '3px', marginBottom: '8px' }}>
            THE +EV CAVE
          </div>
          <h1 style={{
            fontFamily: 'var(--font-syne)', fontWeight: 800, fontSize: '26px',
            margin: 0, letterSpacing: '-0.5px', color: 'var(--ev-text)',
          }}>
            GUIDE
          </h1>
        </header>

        {/* Nav */}
        <Nav active="guide" />

        {/* How it works */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '10px' }}>HOW IT WORKS</div>
          <p style={{ ...DEF, margin: 0, color: 'var(--ev-muted)' }}>
            A LightGBM Poisson regression model projects each starting pitcher&apos;s strikeout total
            (PROJ Ks) for today&apos;s game. The model is trained on rolling pitcher form (K/9, BB/9,
            HR/9, WHIP, FIP, K%, swinging-strike%, called-strike%, chase%, first-pitch-strike%, pitch
            mix and velocity), opponent strikeout tendencies and recent offensive performance, ballpark
            strikeout factors, weather, and workload context (rest days, prior pitch counts, starts
            this season).
          </p>
          <div style={SUBHEAD}>FROM PROJECTION TO EDGE</div>
          <p style={{ ...DEF, margin: 0, color: 'var(--ev-muted)' }}>
            PROJ Ks is treated as the lambda (mean) of a Poisson distribution. For any strikeout line
            -- a sportsbook line, a PrizePicks line, or a custom MY LINE -- the model computes
            P(actual Ks &gt; line) directly from that distribution. EDGE is this model probability
            minus the implied probability from the price (or 50% for pick&apos;em-style PrizePicks
            and custom lines). Positive edge means the model thinks the over is more likely than the
            price suggests.
          </p>
        </div>

        {/* Glossary */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '16px' }}>CARD COLUMN GLOSSARY</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px 32px' }}>
            {GLOSSARY.map(({ term, def }) => (
              <div key={term}>
                <div style={{ ...TERM, marginBottom: '4px' }}>{term}</div>
                <div style={DEF}>{def}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail card glossary */}
        <div style={{ ...CARD, padding: '20px 24px' }}>
          <div style={{ ...LABEL, marginBottom: '6px' }}>DETAIL CARD GLOSSARY</div>
          <p style={{ ...DEF, margin: '0 0 16px', color: 'var(--ev-dim)', fontSize: '11px' }}>
            Click a row on the CARD page to expand the full Statcast detail card.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px 32px' }}>
            {DETAIL_GLOSSARY.map(({ term, def }) => (
              <div key={term}>
                <div style={{ ...TERM, marginBottom: '4px' }}>{term}</div>
                <div style={DEF}>{def}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </main>
  );
}
