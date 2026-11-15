// Computes a trend for every grid cell off the main thread.
import { trend } from "./stats.js";

// The main thread sends the yearly grids once per season; keep the latest.
let cached = { url: null, values: null };

self.onmessage = ({ data: job }) => {
  try {
    const { id, url, firstYear, start, end, nLat, nLon, fill, scale, minYears, from, to } = job;
    if (job.values) cached = { url, values: job.values };
    if (cached.url !== url) throw new Error(`No grid data received for ${url}`);
    const { values } = cached;
    const size = nLat * nLon;
    const t0 = start - firstYear;
    const count = end - start + 1;
    const years = Float64Array.from({ length: count }, (_, i) => start + i);
    const series = new Float64Array(count);
    const scratch = new Float64Array((count * (count - 1)) / 2);

    // This worker handles cells [from, to); results are indexed from `from`.
    const len = to - from;
    const slope = new Float32Array(len).fill(NaN);
    const lower = new Float32Array(len).fill(NaN);
    const upper = new Float32Array(len).fill(NaN);
    const p = new Float32Array(len).fill(NaN);
    const mean = new Float32Array(len).fill(NaN);
    const valid = new Uint8Array(len);

    for (let c = from; c < to; c++) {
      const k = c - from;
      let n = 0, sum = 0;
      for (let t = 0; t < count; t++) {
        const raw = values[(t0 + t) * size + c];
        if (raw === fill) series[t] = NaN;
        else { const v = raw * scale; series[t] = v; sum += v; n++; }
      }
      if (n < Math.max(minYears, Math.ceil(count * 0.7))) continue;
      const r = trend(years, series, {}, scratch);
      if (!(r.slope === r.slope)) continue;
      slope[k] = r.slope * 10;
      lower[k] = r.lower * 10;
      upper[k] = r.upper * 10;
      p[k] = r.p;
      mean[k] = sum / n;
      valid[k] = Math.min(255, n);
      if ((k & 511) === 0) self.postMessage({ id, progress: k / len });
    }

    self.postMessage(
      { id, done: true, from, slope, lower, upper, p, mean, valid },
      [slope.buffer, lower.buffer, upper.buffer, p.buffer, mean.buffer, valid.buffer],
    );
  } catch (error) {
    self.postMessage({ id: job.id, error: String(error.message || error) });
  }
};
