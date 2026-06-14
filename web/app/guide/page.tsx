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

const STEP_NUM: React.CSSProperties = {
  fontFamily:    'var(--font-syne)',
  fontWeight:    800,
  fontSize:      '20px',
  color:         'var(--ev-green)',
  lineHeight:    1,
  minWidth:      '34px',
};

// ── How-to content ───────────────────────────────────────────────────────

const FIND_PLAYS_STEPS: { title: string; def: string }[] = [
  {
    title: 'START WITH MODEL PROB',
    def: "MODEL PROB is your primary signal — it's the model's confidence that the play wins. Above 60% means the model is highly confident. Sort the table by MODEL PROB to surface the strongest plays first.",
  },
  {
    title: 'CONFIRM WITH SWSTR%',
    def: "An elite swinging-strike rate (25%+) means the pitcher genuinely misses bats. This validates that the projection is backed by real stuff quality, not just a favorable matchup.",
  },
  {
    title: 'CHECK PROJ Ks VS ADJ Ks',
    def: "When these two numbers are close, the model and the market agree. A large gap means the market disagrees with the model — approach those plays with extra caution.",
  },
  {
    title: 'USE THE MATCHUP',
    def: "A high OPP K% means the opposing lineup strikes out often, which amplifies the projection. Expand the row for the full matchup breakdown, including OPP K%, OPP OPS, park factor, and weather.",
  },
  {
    title: 'USE AI PICKS',
    def: "The AI PICKS tab automatically surfaces the top plays, ranked by projection confidence — combining all of the above into a single shortlist.",
  },
];

// ── Glossary content ────────────────────────────────────────────────────────

const GLOSSARY: { term: string; def: string }[] = [
  {
    term: 'PROJ Ks',
    def: "The model's projected strikeout total for this start. This is the expected value, not a hard line.",
  },
  {
    term: 'ADJ Ks',
    def: "PROJ Ks adjusted using the sportsbook market when a line is available. This is the number all edges are calculated from. With no book line available, ADJ Ks equals PROJ Ks.",
  },
  {
    term: 'BOOK O/U',
    def: "Best available strikeout line from sportsbooks, with the price (e.g. -115) and book name shown below it.",
  },
  {
    term: 'BOOK EDGE',
    def: "How much value the model sees on this side compared to the sportsbook price. Green = the model favors this side more than the book's price suggests. Red = the book is priced above the model's estimate.",
  },
  {
    term: 'PP LINE',
    def: 'PrizePicks strikeout line for this pitcher (typically a whole number, played as -110 over/under).',
  },
  {
    term: 'PP EDGE',
    def: "How much value the model sees on PrizePicks' pick'em-style pricing. Green = the model favors the over.",
  },
  {
    term: 'MY LINE',
    def: 'Enter any strikeout total you found at a book or app to see the value the model sees on that exact number.',
  },
  {
    term: 'MY EDGE',
    def: "The value the model sees for the custom total you entered in MY LINE.",
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
    def: "Days of rest since the pitcher's last appearance, pitch count in that last appearance, and how many starts they have made so far this season.",
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
            Our proprietary AI model analyzes dozens of pitching and matchup variables to project
            strikeout totals and identify value plays. The model is trained on millions of
            historical pitches and updated daily.
          </p>
        </div>

        {/* How to find plays */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '16px' }}>HOW TO FIND PLAYS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {FIND_PLAYS_STEPS.map(({ title, def }, i) => (
              <div key={title} style={{ display: 'flex', gap: '14px' }}>
                <div style={STEP_NUM}>{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <div style={{ ...TERM, marginBottom: '4px' }}>{title}</div>
                  <div style={DEF}>{def}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How to use My Line */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '10px' }}>HOW TO USE MY LINE</div>
          <p style={{ ...DEF, margin: '0 0 10px', color: 'var(--ev-muted)' }}>
            MY LINE lets you check the model&apos;s edge on a specific number, independent of the
            book and PrizePicks lines already shown on the card.
          </p>
          <p style={{ ...DEF, margin: '0 0 10px', color: 'var(--ev-muted)' }}>
            Open the strikeout market for a pitcher on Novig or ProphetX, find the line being
            offered there, and enter that number into MY LINE on the card. MY EDGE will then show
            the value the model sees on that exact line — positive means the model favors the
            over at that number, negative means it favors the under.
          </p>
          <p style={{ ...DEF, margin: 0, color: 'var(--ev-muted)' }}>
            Use MY EDGE to compare lines across books: if your book&apos;s number gives a bigger
            edge than the BOOK EDGE or PP EDGE already shown, it may be the better place to play.
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
