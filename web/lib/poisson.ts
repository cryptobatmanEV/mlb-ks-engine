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

// P(actual K > line), matching the Python side's `1 - poisson.cdf(floor(line), lambda)`.
export function probOver(line: number, lambda: number): number {
  const floor = Math.floor(line);
  return 1 - poissonCdf(floor, lambda);
}
