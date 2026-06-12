// Poisson helpers for the "MY LINE" custom strikeout-total feature.
// No scipy in the browser, so compute pmf via recursion: pmf(0) = e^-lambda,
// pmf(k) = pmf(k-1) * lambda / k.

export function poissonCdf(k: number, lambda: number): number {
  let pmf = Math.exp(-lambda);
  let cdf = pmf;
  for (let i = 1; i <= k; i++) {
    pmf *= lambda / i;
    cdf += pmf;
  }
  return cdf;
}

// Shrinkage applied to Poisson probabilities to correct for mild
// overconfidence at large edges -- must match predict/fair_odds.py's
// EDGE_SCALE so "MY EDGE" is on the same scale as BOOK EDGE / PP EDGE.
const EDGE_SCALE = 0.90;

// P(actual K > line), matching the Python side's
// `0.5 + (1 - poisson.cdf(floor(line), lambda) - 0.5) * EDGE_SCALE`.
export function probOver(line: number, lambda: number): number {
  const floor = Math.floor(line);
  const pOver = 1 - poissonCdf(floor, lambda);
  return 0.5 + (pOver - 0.5) * EDGE_SCALE;
}
