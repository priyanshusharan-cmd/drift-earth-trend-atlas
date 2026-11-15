// Trend statistics shared by the map worker, the detail panel and the tests.
// Everything here works on plain arrays so it runs in a worker or in Node.

const SQRT2 = Math.SQRT2;

// Abramowitz & Stegun 7.1.26 is not accurate enough in the tails that matter
// for p-values, so use the continued-fraction erfc from Numerical Recipes.
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
    t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

export const normalCdf = (x) => 0.5 * erfc(-x / SQRT2);
export const twoSidedP = (z) => erfc(Math.abs(z) / SQRT2);

// Inverse normal CDF (Acklam), used for Sen's slope confidence bounds.
export function normalQuantile(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// k-th smallest (0-based) of the first n entries, partially reordering `arr`
// so that everything before k is <= arr[k] and everything after is >= it.
// `lo`/`hi` narrow the search when that ordering is already known.
export function select(arr, n, k, lo = 0, hi = n - 1) {
  while (hi > lo) {
    const pivot = arr[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (arr[i] < pivot) i++;
      while (arr[j] > pivot) j--;
      if (i <= j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return arr[k];
  }
  return arr[k];
}

function medianOf(arr, n) {
  if (n === 0) return NaN;
  const hi = select(arr, n, n >> 1);
  if (n & 1) return hi;
  let lo = -Infinity;
  for (let i = 0; i < (n >> 1); i++) if (arr[i] > lo) lo = arr[i];
  return (lo + hi) / 2;
}

/**
 * Sen's slope + Mann–Kendall trend test for one series.
 *
 * x: years, y: values (NaN = missing). `scratch` is an optional Float64Array
 * of at least n(n-1)/2 entries reused across calls to avoid allocation.
 *
 * Variance is corrected for serial correlation following Hamed & Rao (1998),
 * using autocorrelations of the Sen-detrended ranks that are significant at
 * the 5% level. Set options.correct = false for the classic test.
 */
export function trend(x, y, options = {}, scratch) {
  const { correct = true, alpha = 0.05 } = options;
  const n0 = x.length;
  const xs = new Float64Array(n0), ys = new Float64Array(n0);
  let n = 0;
  for (let i = 0; i < n0; i++) {
    const v = y[i];
    if (v === v) { xs[n] = x[i]; ys[n] = v; n++; }
  }
  const empty = { n, slope: NaN, intercept: NaN, lower: NaN, upper: NaN, s: 0, tau: NaN, z: NaN, p: NaN, varS: NaN, nEff: n };
  if (n < 8) return empty;

  const m = (n * (n - 1)) / 2;
  const slopes = scratch && scratch.length >= m ? scratch : new Float64Array(m);
  let s = 0, k = 0;
  for (let i = 0; i < n - 1; i++) {
    const xi = xs[i], yi = ys[i];
    for (let j = i + 1; j < n; j++) {
      const dy = ys[j] - yi;
      s += dy > 0 ? 1 : dy < 0 ? -1 : 0;
      const dx = xs[j] - xi;
      if (dx !== 0) slopes[k++] = dy / dx;
    }
  }
  const slope = medianOf(slopes, k);

  // Tie correction for the variance of S.
  const sorted = ys.slice(0, n).sort();
  let tieTerm = 0;
  for (let i = 0; i < n;) {
    let j = i + 1;
    while (j < n && sorted[j] === sorted[i]) j++;
    const t = j - i;
    if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
    i = j;
  }
  let varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;

  let ratio = 1;
  if (correct) {
    // Autocorrelation of the ranks of the Sen-detrended series.
    const resid = new Float64Array(n);
    for (let i = 0; i < n; i++) resid[i] = ys[i] - slope * xs[i];
    const order = new Uint16Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => resid[a] - resid[b]);
    const dev = new Float64Array(n); // centred ranks; the mean rank is (n + 1) / 2
    for (let i = 0; i < n; i++) dev[order[i]] = i + 1 - (n + 1) / 2;
    let den = 0;
    for (let i = 0; i < n; i++) den += dev[i] * dev[i];
    const crit = -normalQuantile(alpha / 2) / Math.sqrt(n);
    let sum = 0;
    for (let lag = 1; lag < n - 1; lag++) {
      let num = 0;
      for (let i = 0; i + lag < n; i++) num += dev[i] * dev[i + lag];
      const r = num / den;
      if (Math.abs(r) > crit) sum += (n - lag) * (n - lag - 1) * (n - lag - 2) * r;
    }
    ratio = 1 + (2 / (n * (n - 1) * (n - 2))) * sum;
    if (!(ratio > 0)) ratio = 1;
    varS *= ratio;
  }

  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  const p = twoSidedP(z);

  // Confidence interval for Sen's slope (Gilbert 1987), 95% by default, with
  // the rank rounding of scipy.stats.theilslopes. It uses the corrected
  // variance, so serial correlation widens the interval as well.
  const cAlpha = -normalQuantile(alpha / 2) * Math.sqrt(varS);
  const lowRank = Math.max(Math.round((k - cAlpha) / 2) - 1, 0);
  const highRank = Math.min(Math.round((k + cAlpha) / 2), k - 1);
  // The median selection left slopes partitioned around rank k >> 1.
  const mid = k >> 1;
  const lower = lowRank < mid ? select(slopes, k, lowRank, 0, mid - 1) : select(slopes, k, lowRank);
  const upper = highRank > mid ? select(slopes, k, highRank, mid + 1, k - 1) : select(slopes, k, highRank);

  // Line passes through the median point (Conover).
  const xm = medianOf(xs.slice(0, n), n);
  const ym = medianOf(ys.slice(0, n), n);
  return {
    n, slope, intercept: ym - slope * xm, lower, upper,
    s, tau: s / m, z, p, varS, nEff: n / ratio,
  };
}

/**
 * Pettitt (1979) change-point test. Returns the index of the last value
 * before the shift, the years either side and the means of both segments.
 */
export function pettitt(x, y) {
  const xs = [], ys = [];
  for (let i = 0; i < x.length; i++) if (y[i] === y[i]) { xs.push(x[i]); ys.push(y[i]); }
  const n = ys.length;
  if (n < 10) return null;
  let best = 0, at = -1, u = 0;
  // U_t = U_{t-1} + sum_j sgn(y_t - y_j)
  for (let t = 0; t < n - 1; t++) {
    let row = 0;
    for (let j = 0; j < n; j++) {
      const d = ys[t] - ys[j];
      row += d > 0 ? 1 : d < 0 ? -1 : 0;
    }
    u += row;
    if (Math.abs(u) > best) { best = Math.abs(u); at = t; }
  }
  const p = Math.min(1, 2 * Math.exp((-6 * best * best) / (n ** 3 + n ** 2)));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    index: at,
    lastBefore: xs[at],
    firstAfter: xs[at + 1],
    before: mean(ys.slice(0, at + 1)),
    after: mean(ys.slice(at + 1)),
    k: best,
    p,
  };
}

/**
 * Benjamini–Hochberg. Returns the largest p-value threshold that keeps the
 * false discovery rate at `q`. Wilks (2016) recommends q = 2α for gridded
 * fields so that the global false-detection rate stays near α.
 */
export function fdrThreshold(pvalues, q) {
  const ps = [];
  for (const p of pvalues) if (p === p) ps.push(p);
  ps.sort((a, b) => a - b);
  const m = ps.length;
  let threshold = 0;
  for (let i = 0; i < m; i++) if (ps[i] <= ((i + 1) / m) * q) threshold = ps[i];
  return threshold;
}

/**
 * Area-weighted (cos latitude) mean of several grid cells for each year.
 * A year is left missing when less than `minCoverage` of the region's area
 * has data, so a shrinking station network cannot fake a trend.
 */
export function regionalSeries(cube, years, cells, latitudes, lonCount, fill, scale, minCoverage = 0.8) {
  const out = new Float64Array(years);
  const size = latitudes.length * lonCount;
  const weights = cells.map((c) => Math.cos((latitudes[Math.floor(c / lonCount)] * Math.PI) / 180));
  const total = weights.reduce((a, b) => a + b, 0);
  for (let t = 0; t < years; t++) {
    let acc = 0, w = 0;
    for (let i = 0; i < cells.length; i++) {
      const raw = cube[t * size + cells[i]];
      if (raw === fill) continue;
      acc += raw * scale * weights[i];
      w += weights[i];
    }
    out[t] = w > 0 && w >= minCoverage * total ? acc / w : NaN;
  }
  return out;
}
