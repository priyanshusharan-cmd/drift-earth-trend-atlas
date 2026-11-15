// Diverging colour scales with a symmetric, data-driven range.
// Colours: ColorBrewer RdBu and BrBG (Brewer, Penn State), 11 classes.

const RAMPS = {
  temperature: ["#053061", "#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7", "#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f"],
  precipitation: ["#543005", "#8c510a", "#bf812d", "#dfc27d", "#f6e8c3", "#f5f5f5", "#c7eae5", "#80cdc1", "#35978f", "#01665e", "#003c30"],
};

const NICE = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];

/** Pick a step so that ±5 classes cover the 98th percentile of |values|. */
export function niceStep(values, weights) {
  const pairs = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === v) pairs.push([Math.abs(v), weights ? weights[i] : 1]);
  }
  if (!pairs.length) return 0.1;
  pairs.sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let acc = 0, q = pairs[pairs.length - 1][0];
  for (const [v, w] of pairs) { acc += w; if (acc >= 0.98 * total) { q = v; break; } }
  const raw = q / 5;
  return NICE.find((s) => s >= raw) ?? NICE[NICE.length - 1];
}

export function makeScale(name, step) {
  const ramp = RAMPS[name] ?? RAMPS.temperature;
  const half = (ramp.length - 1) / 2;
  const bin = (v) => {
    // The middle class is centred on zero: (-step/2, step/2).
    const k = Math.round(v / step);
    return Math.max(-half, Math.min(half, k)) + half;
  };
  return {
    ramp, step, half,
    index: bin,
    color: (v) => ramp[bin(v)],
    edges: () => Array.from({ length: ramp.length - 1 }, (_, i) => (i - half + 0.5) * step),
  };
}

/** Blend a hex colour toward another, for cells without a robust signal. */
export function mix(hexA, hexB, t) {
  const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
  const ch = (x, s) => (x >> s) & 255;
  const m = (s) => Math.round(ch(a, s) * (1 - t) + ch(b, s) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}
