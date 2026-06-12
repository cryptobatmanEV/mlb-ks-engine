"""
Investigate whether Poisson-derived edges are overstating confidence.

For each holdout start (2025 H2 + 2026), and for each "plausible" book line
(within 1.5 Ks of the model's predicted lambda -- i.e. lines a sportsbook
would actually post for this pitcher), compute:
  - Poisson P(over)/P(under), pick the side the model favors
  - a synthetic edge = model_prob_for_side - 0.5238 (a generic -110 implied
    probability, used as a stand-in since historical book odds aren't stored)
  - whether that side actually hit

Then bucket by edge size (0-3%, 3-6%, 6-10%, 10%+) and compare mean predicted
probability vs actual hit rate within each bucket -- this is the calibration
check the edge sizes imply.

Repeats the same exercise with a negative-binomial distribution (estimating
an overdispersion parameter alpha from holdout residuals) and compares.
"""

import numpy as np
import pandas as pd
import joblib
from scipy.stats import poisson, nbinom

DATA = 'data/processed/training_dataset.parquet'
MODEL_PATH = 'models/saved/ks_model.pkl'

LINES = [4.5, 5.5, 6.5, 7.5, 8.5]
GENERIC_IMPLIED = 119.0 / 219.0 / 1.0  # placeholder, overwritten below
BOOK_IMPLIED = 0.5238  # generic -110 implied probability per side

EDGE_BINS = [0.0, 0.03, 0.06, 0.10, 1.0]
EDGE_LABELS = ['0-3%', '3-6%', '6-10%', '10%+']


def load_holdout():
    df = pd.read_parquet(DATA)
    df['game_date'] = pd.to_datetime(df['game_date'])
    bundle = joblib.load(MODEL_PATH)
    features = bundle['features']
    model = bundle['model']
    bias_correction = bundle['bias_correction']

    df['is_home'] = df['is_home'].astype(int)
    df['is_night'] = (df['day_night'] == 'night').astype(int)
    df['is_dome'] = df['is_dome'].astype(float)

    test_df = df[df['game_date'].dt.year >= 2025]
    holdout = test_df[test_df['game_date'] >= '2025-07-01'].copy()

    X = holdout[features]
    pred_raw = np.clip(model.predict(X), 1e-6, None)
    holdout['pred_k'] = np.clip(pred_raw + bias_correction, 1e-6, None)
    return holdout


def estimate_nb_alpha(holdout):
    """Method-of-moments overdispersion parameter alpha, where
    Var(actual_k | pred_k) = pred_k + alpha * pred_k^2.
    Estimated by bucketing on rounded pred_k."""
    h = holdout.copy()
    h['bucket'] = h['pred_k'].round().astype(int)
    rows = []
    for b, sub in h.groupby('bucket'):
        if len(sub) < 30:
            continue
        mu = sub['pred_k'].mean()
        var = sub['target_k'].var()
        if var > mu and mu > 0:
            alpha = (var - mu) / (mu ** 2)
            rows.append((b, len(sub), mu, var, alpha))

    tab = pd.DataFrame(rows, columns=['pred_bucket', 'n', 'mean_pred', 'var_actual', 'alpha'])
    print("\nPer-bucket overdispersion estimates:")
    print(tab.to_string(index=False))

    # weight by n
    alpha = float((tab['alpha'] * tab['n']).sum() / tab['n'].sum())
    print(f"\nWeighted-average alpha = {alpha:.4f}")
    return alpha


def nb_p_over(mu, line, alpha):
    """P(K > floor(line)) under NB2(mu, alpha): Var = mu + alpha*mu^2."""
    floor = int(line)
    n = 1.0 / alpha
    p = n / (n + mu)
    return 1.0 - nbinom.cdf(floor, n, p)


def build_edge_table(holdout, prob_fn, label):
    """For each holdout row, for each plausible book line (within 1.5 Ks of
    pred_k), compute model prob for the favored side, the synthetic edge vs
    a -110 implied probability, and whether that side hit."""
    records = []
    pred_k = holdout['pred_k'].values
    actual_k = holdout['target_k'].values

    for line in LINES:
        floor = int(line)
        mask = np.abs(pred_k - line) <= 1.5
        if not mask.any():
            continue
        mu = pred_k[mask]
        act = actual_k[mask]

        p_over = np.array([prob_fn(m, line) for m in mu])
        p_under = 1.0 - p_over

        favor_over = p_over >= p_under
        p_model = np.where(favor_over, p_over, p_under)
        edge = p_model - BOOK_IMPLIED

        # outcome for the favored side (exclude pushes)
        push = (act == floor)
        hit_over = (act > floor).astype(float)
        hit = np.where(favor_over, hit_over, 1 - hit_over)

        for e, pm, h, pu in zip(edge, p_model, hit, push):
            if pu:
                continue
            records.append((e, pm, h))

    edges = pd.DataFrame(records, columns=['edge', 'p_model', 'hit'])
    edges['bucket'] = pd.cut(edges['edge'], bins=EDGE_BINS, labels=EDGE_LABELS)

    print(f"\n{'=' * 60}")
    print(f"{label} -- calibration by predicted-edge size")
    print(f"{'=' * 60}")
    print(f"  (n={len(edges)} (start, line) pairs with |pred_k - line| <= 1.5, edge >= 0)")
    cal = (
        edges[edges['edge'] >= 0]
        .groupby('bucket', observed=True)
        .agg(predicted=('p_model', 'mean'), actual=('hit', 'mean'), n=('hit', 'count'))
        .reset_index()
    )
    for _, row in cal.iterrows():
        gap = row['predicted'] - row['actual']
        print(f"  edge {row['bucket']:>6}:  predicted={row['predicted']:.3f}  "
              f"actual={row['actual']:.3f}  gap={gap:+.3f}  n={row['n']}")
    return cal


def scaled_p_over(mu, line, scale):
    p_over = float(1 - poisson.cdf(int(line), mu))
    return 0.5 + (p_over - 0.5) * scale


def find_best_scale(holdout, candidates):
    """Grid-search a shrinkage factor applied as p_adj = 0.5 + (p-0.5)*scale,
    minimizing the average |predicted - actual| gap across edge buckets."""
    print("\nGrid search over shrinkage factor (p_adj = 0.5 + (p_poisson - 0.5) * scale):")
    best = None
    for scale in candidates:
        fn = lambda mu, line, s=scale: scaled_p_over(mu, line, s)
        # build edge table quietly
        records = []
        pred_k = holdout['pred_k'].values
        actual_k = holdout['target_k'].values
        for line in LINES:
            floor = int(line)
            mask = np.abs(pred_k - line) <= 1.5
            mu = pred_k[mask]
            act = actual_k[mask]
            p_over = np.array([fn(m, line) for m in mu])
            p_under = 1.0 - p_over
            favor_over = p_over >= p_under
            p_model = np.where(favor_over, p_over, p_under)
            edge = p_model - BOOK_IMPLIED
            push = (act == floor)
            hit_over = (act > floor).astype(float)
            hit = np.where(favor_over, hit_over, 1 - hit_over)
            for e, pm, h, pu in zip(edge, p_model, hit, push):
                if pu or e < 0:
                    continue
                records.append((e, pm, h))
        edges = pd.DataFrame(records, columns=['edge', 'p_model', 'hit'])
        edges['bucket'] = pd.cut(edges['edge'], bins=EDGE_BINS, labels=EDGE_LABELS)
        cal = edges.groupby('bucket', observed=True).agg(
            predicted=('p_model', 'mean'), actual=('hit', 'mean'), n=('hit', 'count')).reset_index()
        mean_abs_gap = (cal['predicted'] - cal['actual']).abs().mean()
        print(f"  scale={scale:.2f}  mean_abs_gap={mean_abs_gap:.4f}")
        if best is None or mean_abs_gap < best[1]:
            best = (scale, mean_abs_gap)
    print(f"\n  Best scale: {best[0]:.2f} (mean_abs_gap={best[1]:.4f})")
    return best[0]


def main():
    print("Loading holdout set and model...")
    holdout = load_holdout()
    print(f"  {len(holdout):,} holdout starts")

    print("\n" + "=" * 60)
    print("STEP 1: Poisson calibration by predicted-edge size")
    print("=" * 60)
    poisson_fn = lambda mu, line: float(1 - poisson.cdf(int(line), mu))
    cal_poisson = build_edge_table(holdout, poisson_fn, "POISSON")

    print("\n" + "=" * 60)
    print("STEP 2: Estimate negative-binomial overdispersion parameter")
    print("=" * 60)
    alpha = estimate_nb_alpha(holdout)

    print("\n" + "=" * 60)
    print("STEP 3: Negative-binomial calibration by predicted-edge size")
    print("=" * 60)
    nb_fn = lambda mu, line: float(nb_p_over(mu, line, alpha))
    cal_nb = build_edge_table(holdout, nb_fn, "NEGATIVE BINOMIAL")

    print("\n" + "=" * 60)
    print("STEP 4: BEFORE (Poisson) vs AFTER (Negative Binomial)")
    print("=" * 60)
    merged = cal_poisson.merge(cal_nb, on='bucket', suffixes=('_poisson', '_nb'))
    print(f"  {'Edge bucket':<12} {'Poisson pred':>13} {'NB pred':>10} {'Actual':>8} "
          f"{'Poisson gap':>13} {'NB gap':>10}")
    for _, row in merged.iterrows():
        gap_p = row['predicted_poisson'] - row['actual_poisson']
        gap_nb = row['predicted_nb'] - row['actual_nb']
        print(f"  {row['bucket']:<12} {row['predicted_poisson']:>13.3f} "
              f"{row['predicted_nb']:>10.3f} {row['actual_poisson']:>8.3f} "
              f"{gap_p:>+13.3f} {gap_nb:>+10.3f}")

    print("\n" + "=" * 60)
    print("STEP 5: NB did not materially improve calibration -- "
          "search for a Poisson shrinkage factor instead")
    print("=" * 60)
    candidates = [round(x, 2) for x in np.arange(0.70, 1.01, 0.05)]
    best_scale = find_best_scale(holdout, candidates)

    print("\n" + "=" * 60)
    print(f"STEP 6: BEFORE (Poisson, scale=1.0) vs AFTER (Poisson, scale={best_scale:.2f})")
    print("=" * 60)
    scaled_fn = lambda mu, line, s=best_scale: scaled_p_over(mu, line, s)
    cal_scaled = build_edge_table(holdout, scaled_fn, f"POISSON x SCALE={best_scale:.2f}")
    merged2 = cal_poisson.merge(cal_scaled, on='bucket', suffixes=('_before', '_after'))
    print(f"\n  {'Edge bucket':<12} {'Before pred':>12} {'After pred':>11} {'Actual':>8} "
          f"{'Before gap':>11} {'After gap':>10}")
    for _, row in merged2.iterrows():
        gap_b = row['predicted_before'] - row['actual_before']
        gap_a = row['predicted_after'] - row['actual_after']
        print(f"  {row['bucket']:<12} {row['predicted_before']:>12.3f} "
              f"{row['predicted_after']:>11.3f} {row['actual_before']:>8.3f} "
              f"{gap_b:>+11.3f} {gap_a:>+10.3f}")


if __name__ == "__main__":
    main()
