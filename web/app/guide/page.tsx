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
    def: "MODEL PROB is your primary signal — it's the model's confidence that the play wins. Above 58% means the model is highly confident (shown in green). Sort the table by MODEL PROB to surface the strongest plays first.",
  },
  {
    title: 'CONFIRM WITH SWSTR%',
    def: "An elite swinging-strike rate (25%+) means the pitcher genuinely misses bats. This validates that the projection is backed by real stuff quality, not just a favorable matchup.",
  },
  {
    title: 'CHECK PROJ Ks VS ADJ Ks',
    def: "When these two numbers are close, the model and the market agree. A large gap means the market disagrees with the model — approach those plays with extra caution. A red ! badge signals the gap exceeds 1 strikeout.",
  },
  {
    title: 'USE THE MATCHUP',
    def: "A high OPP K% means the opposing lineup strikes out often, which amplifies the projection. Expand the row for the full matchup breakdown, including OPP K%, OPP OPS, park factor, and weather.",
  },
  {
    title: 'USE AI PICKS',
    def: "The AI PICKS tab automatically surfaces the top plays, ranked by a composite score — MODEL PROB is the primary driver, weighted alongside SWSTR%, market edge, K/9, model/market agreement, and opponent K rate.",
  },
];

// ── Sorting content ──────────────────────────────────────────────────────

const SORT_ITEMS: { term: string; def: string }[] = [
  {
    term: 'BY EDGE',
    def: "Ranks pitchers by BOOK EDGE descending — the plays with the most model value versus the sportsbook price appear first. Best starting point when you want the strongest value plays.",
  },
  {
    term: 'BY GAME',
    def: "Sorts pitchers by first-pitch time. Use this when you're tracking a specific slate or watching games in order and want to see who pitches first.",
  },
  {
    term: 'AI PICKS',
    def: "Switches to the AI PICKS tab, which shows only the top curated plays for the day. The AI ranks plays by a composite score that weights MODEL PROB most heavily, then SWSTR%, market edge, K/9, model/market agreement, and opponent K rate.",
  },
];

// ── Market Odds content ──────────────────────────────────────────────────

const MARKET_ODDS_ITEMS: { term: string; def: string }[] = [
  {
    term: 'PINNACLE',
    def: "The sharpest market shown. Pinnacle accepts bets from winning players and adjusts lines quickly, making their number the most efficient price in the industry. When Pinnacle's line differs from others, Pinnacle is usually right.",
  },
  {
    term: 'FANDUEL / DRAFTKINGS / BETRIVERS / BETMGM',
    def: "Major US sportsbooks. These books are less sharp than Pinnacle but often offer better prices on sharp sides. The consensus line shown on the main table card is the most common number across these markets.",
  },
  {
    term: 'NOVIG',
    def: "A no-vig exchange-style book that offers reduced juice. Novig's number may differ from the consensus — a useful second data point for finding soft lines.",
  },
  {
    term: 'ALT BADGE',
    def: "Shown next to a book's line when that book is offering a different total than the consensus. Alt lines are displayed in muted text and carry different implied odds — the BOOK EDGE figure is calculated from the consensus line, not alt lines.",
  },
];

// ── DFS Lines content ────────────────────────────────────────────────────

const DFS_ITEMS: { term: string; def: string }[] = [
  {
    term: 'PRIZEPICKS',
    def: "Pick'em-style DFS. Standard pricing is -119 over/under, giving a break-even win rate of 53.5%. The edge shown is the model's probability on the recommended side minus that 53.5% threshold.",
  },
  {
    term: 'UNDERDOG FANTASY',
    def: "Pick'em-style DFS with standard pricing of -115 over/under, also a 53.5% break-even. The edge is computed the same way as PrizePicks.",
  },
  {
    term: 'ALT BADGE (UNDERDOG)',
    def: "When Underdog has no standard 1x-payout line for a pitcher, the model falls back to the closest alt-line to the adjusted projection. An ALT badge next to the UD line signals this fallback was used — treat the edge figure with slightly more caution.",
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
    def: "The model's probability on the recommended side minus the implied probability of the book's price. Green = positive value; red = the book's price implies more confidence than the model has.",
  },
  {
    term: 'MODEL PROB',
    def: "Calibrated probability that the recommended play wins. Above 58% is green (high confidence). 50–58% is muted (lean). Below 50% is red (model favors the other side).",
  },
  {
    term: 'PP LINE',
    def: "PrizePicks strikeout line for this pitcher, played as -119 over/under (break-even 53.5%).",
  },
  {
    term: 'PP EDGE',
    def: "How much value the model sees on PrizePicks' pick'em-style pricing at -119. Green = the model favors the shown side.",
  },
  {
    term: 'UD LINE',
    def: "Underdog Fantasy strikeout line, played at -115 (break-even 53.5%). An ALT badge means no standard Underdog line existed and the model fell back to the closest alt-line.",
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

        {/* Sorting */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '16px' }}>SORTING</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {SORT_ITEMS.map(({ term, def }) => (
              <div key={term}>
                <div style={{ ...TERM, marginBottom: '4px' }}>{term}</div>
                <div style={DEF}>{def}</div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Picks */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '10px' }}>AI PICKS</div>
          <p style={{ ...DEF, margin: '0 0 12px', color: 'var(--ev-muted)' }}>
            The AI PICKS tab surfaces the top 5 plays for the day, selected and ranked
            automatically. Plays must pass both a minimum MODEL PROB threshold (55%) and a minimum
            SWSTR% threshold (20%) to qualify — pitchers who don&apos;t miss bats consistently are
            excluded regardless of the line.
          </p>
          <p style={{ ...DEF, margin: '0 0 12px', color: 'var(--ev-muted)' }}>
            Qualifying plays are scored on a composite that weighs MODEL PROB most heavily, then
            SWSTR% above the 20% baseline, market edge, K/9 above a 7.0 baseline,
            model/market agreement, and opponent strikeout rate. The top 5 by composite score
            are shown.
          </p>
          <p style={{ ...DEF, margin: 0, color: 'var(--ev-muted)' }}>
            Each AI pick card shows the recommended play, the book or DFS source, MODEL PROB, BOOK
            EDGE, and a one-line reason summarizing the key factors behind the selection.
          </p>
        </div>

        {/* Market Odds */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '16px' }}>MARKET ODDS</div>
          <p style={{ ...DEF, margin: '0 0 16px', color: 'var(--ev-muted)' }}>
            Expand any row to see the MARKET ODDS & DFS card, which shows the strikeout line and
            price across six sportsbooks: Pinnacle, FanDuel, DraftKings, BetRivers, Novig, and
            BetMGM.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {MARKET_ODDS_ITEMS.map(({ term, def }) => (
              <div key={term}>
                <div style={{ ...TERM, marginBottom: '4px' }}>{term}</div>
                <div style={DEF}>{def}</div>
              </div>
            ))}
          </div>
        </div>

        {/* DFS Lines */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '16px' }}>DFS LINES</div>
          <p style={{ ...DEF, margin: '0 0 16px', color: 'var(--ev-muted)' }}>
            PrizePicks and Underdog Fantasy lines appear in the expanded card alongside sportsbook
            odds. Both are pick&apos;em style — you&apos;re playing the over or under against a
            fixed line at a set price rather than against a market.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {DFS_ITEMS.map(({ term, def }) => (
              <div key={term}>
                <div style={{ ...TERM, marginBottom: '4px' }}>{term}</div>
                <div style={DEF}>{def}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Model Probability */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '10px' }}>MODEL PROBABILITY</div>
          <p style={{ ...DEF, margin: '0 0 14px', color: 'var(--ev-muted)' }}>
            MODEL PROB is the model&apos;s calibrated probability that the recommended play wins.
            Calibrated means the number is not just a raw score — it has been adjusted so that
            plays the model calls 60% have historically won around 60% of the time.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-green)', fontWeight: 700, minWidth: '60px', paddingTop: '1px' }}>{'> 58%'}</div>
              <div style={DEF}>Green — high confidence. The model sees a strong probability edge on this side. Prioritize these plays.</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-muted)', fontWeight: 700, minWidth: '60px', paddingTop: '1px' }}>50–58%</div>
              <div style={DEF}>Muted — a lean, not a lock. The model slightly favors this side but isn&apos;t highly confident. Can still be +EV depending on the price.</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-red)', fontWeight: 700, minWidth: '60px', paddingTop: '1px' }}>{'< 50%'}</div>
              <div style={DEF}>Red — the model actually favors the other side. The recommended play may still carry book value due to pricing, but treat it with caution.</div>
            </div>
          </div>
        </div>

        {/* ! Alert Badge */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '10px' }}>! ALERT BADGE (K TOOL)</div>
          <p style={{ ...DEF, margin: '0 0 12px', color: 'var(--ev-muted)' }}>
            A red <span style={{ color: 'var(--ev-red)', fontWeight: 700 }}>!</span> appears
            next to a pitcher&apos;s name when the adjusted projection (ADJ Ks) differs from the
            consensus book line by more than 1 strikeout. This signals that the model and the
            market are far apart on this pitcher.
          </p>
          <p style={{ ...DEF, margin: 0, color: 'var(--ev-muted)' }}>
            Common causes: a late lineup scratch, a weather delay, a pitcher on shortened rest,
            or a recent development not yet reflected in the model. When you see the ! badge,
            hover for the tooltip, then verify the pitcher&apos;s status before placing a bet.
          </p>
        </div>

        {/* Book Edge */}
        <div style={{ ...CARD, padding: '20px 24px', marginBottom: '24px' }}>
          <div style={{ ...LABEL, marginBottom: '10px' }}>BOOK EDGE</div>
          <p style={{ ...DEF, margin: '0 0 14px', color: 'var(--ev-muted)' }}>
            BOOK EDGE is the model&apos;s probability on the recommended side minus the implied
            probability of the book&apos;s price. A +5% edge means the model gives the play a
            5-percentage-point higher probability of winning than the price implies.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-green)', fontWeight: 700, minWidth: '64px', paddingTop: '1px' }}>{'> +5%'}</div>
              <div style={DEF}>Strong edge — bold green. Clear model value relative to the price being offered.</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-green)', fontWeight: 400, minWidth: '64px', paddingTop: '1px' }}>0–5%</div>
              <div style={DEF}>Thin edge — light green. Positive expected value but slim margin. Worth playing at the right price.</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-muted)', fontWeight: 400, minWidth: '64px', paddingTop: '1px' }}>0 to −3%</div>
              <div style={DEF}>Near neutral — muted. The model and the price are roughly aligned. Marginal or no sportsbook edge.</div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ev-red)', fontWeight: 400, minWidth: '64px', paddingTop: '1px' }}>{'< −3%'}</div>
              <div style={DEF}>Negative edge — red. The book is pricing the other side. The model has less confidence than the price implies.</div>
            </div>
          </div>
          <p style={{ ...DEF, margin: 0, color: 'var(--ev-muted)' }}>
            A negative BOOK EDGE doesn&apos;t always mean skip the play. If the DFS lines (PP or
            UD) offer better value than the sportsbook for the same projection, the DFS edge may
            be the real opportunity. Always compare BOOK EDGE, PP EDGE, and UD EDGE before
            deciding where to play.
          </p>
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
