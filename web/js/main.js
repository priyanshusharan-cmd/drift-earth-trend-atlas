import { loadCatalog, loadWorld, loadMeta, loadCube, cubeUrl, cellSeries, grid } from "./data.js";
import { trend, pettitt, regionalSeries, fdrThreshold } from "./stats.js";
import { niceStep, makeScale, mix } from "./palette.js";
import { createMap, boxPolygon } from "./map.js";
import { seriesChart, zonalChart, timeline, fmt } from "./chart.js";
import { areaShares, zonalProfile, hotspots, areaFraction } from "./findings.js";
import { createGazetteer } from "./places.js";
import { enhanceSelect, enhanceSegmented } from "./picker.js";
import { renderExplainer } from "./explain.js";
import { createCosmos } from "./cosmos.js";
import { renderStripes, renderTicker } from "./stripes.js";

const d3 = globalThis.d3;
const topojson = globalThis.topojson;
const $ = (id) => document.getElementById(id);

const MIN_SPAN = 10;      // shortest window, in years
const FDR_Q = 0.10;       // Wilks (2016): q = 2α for α = 0.05
const REL_MIN_MEAN = 0.1; // mm/day below which a relative trend is meaningless

const app = {
  catalog: null, meta: null, g: null, cube: null, field: null,
  display: null, scale: null, threshold: 0, clusters: [], names: new Map(),
  state: { ds: null, season: "annual", start: null, end: null, units: "abs", robustOnly: true, sel: { type: "globe" }, mode: "trend", year: null },
  unfold: 0, stageU: 0, counts: {},
  job: 0,
};

// ---------------------------------------------------------------- theme
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function mapTheme() {
  return {
    nodata: cssVar("--nodata"), coast: cssVar("--coast"), border: cssVar("--border"),
    graticule: cssVar("--graticule"), outline: cssVar("--outline"), hover: cssVar("--hover"),
    select: cssVar("--select"), halo: cssVar("--halo"),
  };
}
function initTheme() {
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem("drift-theme"); } catch { /* storage unavailable */ }
  if (saved) root.dataset.theme = saved;
  document.querySelector(".theme-toggle").addEventListener("click", () => {
    const dark = root.dataset.theme
      ? root.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("drift-theme", root.dataset.theme); } catch { /* ignore */ }
    applyTheme();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
}
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function applyTheme() {
  app.cosmos?.setTheme(isDark());
  const t = mapTheme();
  app.globe?.setTheme(t);
  app.flat?.setTheme(t);
  if (app.field) render();
}

// ---------------------------------------------------------------- url state
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const s = app.state;
  if (p.get("d")) s.ds = p.get("d");
  if (p.get("s")) s.season = p.get("s");
  const y = p.get("y")?.match(/^(\d{4})-(\d{4})$/);
  if (y) { s.start = +y[1]; s.end = +y[2]; }
  if (p.get("u") === "rel") s.units = "rel";
  if (p.get("f") === "0") s.robustOnly = false;
  const sel = p.get("p");
  if (sel?.startsWith("c")) s.sel = { type: "cell", cell: +sel.slice(1) };
  const b = sel?.match(/^b(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/);
  if (b) s.sel = { type: "box", box: b.slice(1).map(Number) };
}
function writeHash() {
  const s = app.state;
  const p = new URLSearchParams({ d: s.ds, s: s.season, y: `${s.start}-${s.end}` });
  if (s.units === "rel") p.set("u", "rel");
  if (!s.robustOnly) p.set("f", "0");
  if (s.sel.type === "cell") p.set("p", `c${s.sel.cell}`);
  if (s.sel.type === "box") p.set("p", `b${s.sel.box.map((v) => v.toFixed(1)).join(",")}`);
  history.replaceState(null, "", `#${p}`);
}

// ---------------------------------------------------------------- controls
function option(value, label, selected) {
  const o = document.createElement("option");
  o.value = value; o.textContent = label; o.selected = selected;
  return o;
}
function fillYearSelects() {
  const { meta, state: s } = app;
  const season = meta.seasons[s.season];
  $("start").replaceChildren(...d3.range(season.firstYear, season.lastYear - MIN_SPAN + 2).map((y) => option(y, y, y === s.start)));
  $("end").replaceChildren(...d3.range(s.start + MIN_SPAN - 1, season.lastYear + 1).map((y) => option(y, y, y === s.end)));
}
function clampWindow() {
  const { meta, state: s } = app;
  const season = meta.seasons[s.season];
  const [defStart, defEnd] = meta.defaultWindow;
  if (s.start == null || s.start < season.firstYear) s.start = Math.max(season.firstYear, defStart ?? season.firstYear);
  if (s.end == null || s.end > season.lastYear) s.end = defEnd ?? season.lastYear;
  if (s.end > season.lastYear) s.end = season.lastYear;
  if (s.end - s.start + 1 < MIN_SPAN) s.start = Math.max(season.firstYear, s.end - MIN_SPAN + 1);
  if (s.end - s.start + 1 < MIN_SPAN) s.end = Math.min(season.lastYear, s.start + MIN_SPAN - 1);
}
function bindControls() {
  $("dataset").addEventListener("change", (e) => switchDataset(e.target.value));
  $("season").addEventListener("change", async (e) => {
    app.state.season = e.target.value;
    clampWindow();
    fillYearSelects();
    await loadSeason();
    compute();
  });
  $("start").addEventListener("change", (e) => { app.state.start = +e.target.value; fillYearSelects(); compute(); });
  $("end").addEventListener("change", (e) => { app.state.end = +e.target.value; fillYearSelects(); compute(); });
  $("robust-only").addEventListener("change", (e) => { app.state.robustOnly = e.target.checked; render(); });
  document.querySelectorAll('input[name="units"]').forEach((r) =>
    r.addEventListener("change", (e) => { app.state.units = e.target.value; render(); }));
  $("reset-place").addEventListener("click", () => select({ type: "globe" }));
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", (e) => setMode(e.target.value)));
  $("play").addEventListener("click", togglePlay);
  $("year").addEventListener("input", (e) => { stopPlaying(); app.state.year = +e.target.value; paintMaps(); });
  $("download").addEventListener("click", downloadSeries);
}

// ---------------------------------------------------------------- loading
async function switchDataset(id, keep = false) {
  const s = app.state;
  const prev = app.meta;
  app.meta = await loadMeta(id);
  app.g = grid(app.meta);
  s.ds = id;
  if (!app.meta.seasons[s.season]) s.season = "annual";
  if (!keep && prev && prev.id !== id) { s.start = null; s.end = null; s.sel = { type: "globe" }; }
  if (!app.meta.relativeUnits) s.units = "abs";
  clampWindow();
  app.names.clear();
  app.globe.setGrid(app.meta, app.g);
  app.flat.setGrid(app.meta, app.g);

  $("season").replaceChildren(...Object.entries(app.meta.seasons).map(([k, v]) =>
    option(k, k === "annual" ? "Whole year" : v.label, k === s.season)));
  fillYearSelects();
  $("units-group").hidden = !app.meta.relativeUnits;
  $("units-abs").textContent = app.meta.units;
  document.querySelector(`input[name="units"][value="${s.units}"]`).checked = true;
  renderSources();
  await loadSeason();
  compute();
}

async function loadSeason() {
  app.cube = await loadCube(app.meta, app.state.season);
}

/** Trend for every cell, split across a pool of workers. */
function compute() {
  const { meta, g, state: s } = app;
  stopPlaying();
  const season = meta.seasons[s.season];
  const id = ++app.job;
  const t0 = performance.now();
  // A newer request makes the running one useless; stop it rather than queue behind it.
  if (app.inFlight) app.workers = app.workers.map((w) => { w.terminate(); return makeWorker(); });
  app.inFlight = true;
  const pool = app.workers;
  const chunk = Math.ceil(g.size / pool.length);
  const progress = new Array(pool.length).fill(0);
  const parts = [];
  const field = {
    slope: new Float32Array(g.size), lower: new Float32Array(g.size), upper: new Float32Array(g.size),
    p: new Float32Array(g.size), mean: new Float32Array(g.size), valid: new Uint8Array(g.size),
  };
  const bar = $("busy");
  bar.hidden = false;
  bar.firstElementChild.style.width = "4%";

  pool.forEach((worker, w) => {
    const from = w * chunk, to = Math.min(g.size, from + chunk);
    worker.onmessage = ({ data }) => {
      if (data.id !== app.job) return;
      if (data.error) { showError(data.error); return; }
      if (data.progress != null) {
        progress[w] = data.progress;
        bar.firstElementChild.style.width = `${Math.round((progress.reduce((a, b) => a + b, 0) / pool.length) * 100)}%`;
        return;
      }
      for (const key of Object.keys(field)) field[key].set(data[key], data.from);
      parts.push(w);
      if (parts.length < pool.length) return;
      bar.hidden = true;
      app.inFlight = false;
      app.field = field;
      app.threshold = fdrThreshold(field.p, FDR_Q);
      const done = field.valid.reduce((n, v) => n + (v > 0), 0);
      $("live-text").innerHTML = `<b>${done.toLocaleString("en")}</b> trends computed in your browser in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      render();
    };
    const url = cubeUrl(meta, s.season);
    // Each worker gets its own copy of the grids only when the season changes.
    const values = worker.dataUrl === url ? undefined : app.cube;
    worker.dataUrl = url;
    worker.postMessage({
      id, url, values,
      firstYear: season.firstYear, start: s.start, end: s.end,
      nLat: g.nLat, nLon: g.nLon, fill: meta.fill, scale: meta.scale,
      minYears: MIN_SPAN, from, to,
    });
  });
}

function showError(message) {
  $("busy").hidden = true;
  app.inFlight = false;
  $("answer").textContent = `Drift could not compute trends: ${message}`;
}

// ---------------------------------------------------------------- derived values
const unitLabel = () => (app.state.units === "rel" ? "%" : app.meta.units);
const perDecade = () => `${unitLabel()} per decade`;
const robust = (c) => app.field.p[c] <= app.threshold;
// Enough decimals that small trends (e.g. 0.004 mm/day) are not shown as zero.
const dg = (v) => {
  const a = Math.abs(v);
  if (app.state.units === "rel") return a >= 1 || a === 0 ? 1 : 2;
  return a >= 0.095 || a === 0 ? 2 : a >= 0.0095 ? 3 : 4;
};

function displayField() {
  const { slope, mean } = app.field;
  if (app.state.units !== "rel") return slope;
  return slope.map((v, c) => (mean[c] > REL_MIN_MEAN ? (v / mean[c]) * 100 : NaN));
}

function placeName(cell) {
  if (!app.names.has(cell)) app.names.set(cell, app.gazetteer.name(app.g.center(cell)));
  return app.names.get(cell);
}

function cellsInBox([x0, y0, x1, y1]) {
  const out = [];
  for (let c = 0; c < app.g.size; c++) {
    const [lon, lat] = app.g.center(c);
    if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) out.push(c);
  }
  return out;
}

/** Name a set of cells by the countries and oceans covering most of them. */
function describeCells(cells) {
  const area = new Map();
  for (const c of cells) {
    const n = placeName(c);
    if (n.startsWith("waters near")) continue;
    area.set(n, (area.get(n) ?? 0) + app.g.weight(c));
  }
  const ranked = [...area].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  if (!ranked.length) return { label: placeName(cells[Math.floor(cells.length / 2)]), more: 0 };
  const top = ranked.slice(0, 3);
  const label = top.length === 1 ? top[0] : `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;
  return { label, more: ranked.length - top.length };
}

function windowSlice(years, values) {
  const { start, end } = app.state;
  const ys = [], vs = [];
  years.forEach((y, i) => { if (y >= start && y <= end) { ys.push(y); vs.push(values[i]); } });
  return { ys, vs };
}

/** Full-record series for the current selection, in display units. */
function selectionSeries() {
  const { meta, g, cube, state: s } = app;
  const season = meta.seasons[s.season];
  const years = d3.range(season.firstYear, season.lastYear + 1);
  let values, cells;
  if (s.sel.type === "cell") {
    values = cellSeries(meta, cube, s.season, s.sel.cell).values;
  } else {
    cells = s.sel.type === "box" ? cellsInBox(s.sel.box)
      : s.sel.type === "cluster" ? s.sel.cells
      : d3.range(g.size);
    values = Array.from(regionalSeries(cube, years.length, cells, meta.lat, g.nLon, meta.fill, meta.scale));
  }
  return { years, values, cells };
}

function toDisplay(values, windowMean) {
  if (app.state.units !== "rel") return values;
  return values.map((v) => ((v - windowMean) / windowMean) * 100);
}

// ---------------------------------------------------------------- reveal
// Sections animate in once as they enter the viewport; charts inside them
// replay their entrance only when they change while on screen.
const seen = new WeakSet();
const onScreen = new WeakSet();
function animateIfSeen(el) {
  return !reduceMotion() && seen.has(el) && onScreen.has(el);
}
function setupReveals() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = e.target;
      if (e.isIntersecting) onScreen.add(el); else onScreen.delete(el);
      if (!e.isIntersecting || seen.has(el)) continue;
      seen.add(el);
      el.classList.add("in");
      if (!app.field) continue;
      // First appearance: play the chart entrances.
      if (el.id === "zonal" || el.id === "hotspots") renderPatterns();
      if (el.id === "explain" && app.explain) renderExplainer(el, app.explain, !reduceMotion());
      if (el.id === "stripes") renderRecord({ animate: !reduceMotion() });
    }
  }, { threshold: 0.2 });
  document.querySelectorAll(".reveal, #zonal, #hotspots, #explain, #stripes").forEach((el) => io.observe(el));
}

// ---------------------------------------------------------------- render
function render() {
  if (!app.field) return;
  const { meta, g, state: s } = app;
  const display = displayField();
  app.display = display;
  const weights = Float64Array.from({ length: g.size }, (_, c) => g.weight(c));
  app.scale = makeScale(meta.palette, niceStep(display, weights));
  // How far cells without a robust trend fade, set per theme in CSS.
  const fadeTo = cssVar("--fade-to");
  const fade = parseFloat(cssVar("--fade-amount")) || 0.7;

  app.trendColors = new Array(g.size);
  for (let c = 0; c < g.size; c++) {
    const v = display[c];
    if (!(v === v)) { app.trendColors[c] = null; continue; }
    const col = app.scale.color(v);
    app.trendColors[c] = s.robustOnly && !robust(c) ? mix(col, fadeTo, fade) : col;
  }
  app.yearScale = null;
  app.clusters = hotspots({ slope: display, p: app.field.p }, g, app.threshold);
  paintMaps({ fade: true });
  renderHero();
  renderSteps();
  renderPatterns();
  renderPlace({ animate: true });
  renderTimeline();
  renderRecord();
  writeHash();
}

/** Colour both maps for the current mode: trend per decade or a single year. */
function paintMaps({ fade = false } = {}) {
  const yearMode = app.state.mode === "year";
  const colors = yearMode ? yearColors() : app.trendColors;
  app.globe.setColors(colors, { fade });
  app.flat.setColors(colors, { fade });
  renderLegend();
  renderAtlasHeading();
  $("robust-toggle").hidden = yearMode;
  $("player").hidden = !yearMode;
}

function renderLegend() {
  const yearMode = app.state.mode === "year";
  const sc = yearMode ? app.yearScale : app.scale;
  const ramp = sc.ramp.map((c) => `<span style="background:${c}"></span>`).join("");
  const edges = sc.edges();
  // Class edges sit at half steps, so show as many decimals as step / 2 needs.
  const digits = (String(+(sc.step / 2).toPrecision(6)).split(".")[1] ?? "").length;
  // Label every other class edge, mirrored around zero (±0.5 step, ±2.5 steps, …).
  const ticks = edges.map((e, i) => Math.round(Math.abs(e) / sc.step - 0.5) % 2 === 0
    ? `<span style="left:${((i + 1) / sc.ramp.length) * 100}%">${fmt(e, digits)}</span>` : "").join("");
  const cap = yearMode
    ? `Departure from the ${app.state.start}–${app.state.end} mean, ${unitLabel() === "%" ? "% of mean" : unitLabel()}`
    : `Trend, ${perDecade()}`;
  $("legend").innerHTML = `<p class="legend-cap">${cap}</p><div class="legend-ramp">${ramp}</div><div class="legend-ticks">${ticks}</div>`;
}

function globalFit() {
  const { meta, g, cube, state: s } = app;
  const season = meta.seasons[s.season];
  const years = d3.range(season.firstYear, season.lastYear + 1);
  const values = regionalSeries(cube, years.length, d3.range(g.size), meta.lat, g.nLon, meta.fill, meta.scale);
  const { ys, vs } = windowSlice(years, Array.from(values));
  const mean = d3.mean(vs.filter((v) => v === v));
  const fit = trend(ys, vs);
  return { fit, mean, years, values };
}

function seasonPhrase() {
  const s = app.state;
  return s.season === "annual" ? "" : ` in ${app.meta.seasons[s.season].label}`;
}

// Numbers in the answer count from their previous value to the new one.
function counter(key, value, kind) {
  const text = kind === "pct" ? pct(value) : fmt(value, dg(value));
  return `<span class="num" data-key="${key}" data-kind="${kind}" data-value="${value}">${text}</span>`;
}
function runCounters(root) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.querySelectorAll(".num").forEach((el) => {
    const { key, kind } = el.dataset;
    const to = +el.dataset.value;
    const from = app.counts[key];
    app.counts[key] = to;
    if (reduce || from === undefined || from === to) return;
    const format = (v) => (kind === "pct" ? pct(v) : fmt(v, dg(to)));
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 700);
      el.textContent = format(from + (to - from) * d3.easeCubicOut(k));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Captions shown while the globe unfolds; written from the current result. */
function renderSteps() {
  const { meta, state: s } = app;
  const [a, b, c] = $("unfold-steps").children;
  a.innerHTML = `Unfolded, every coloured cell is one trend: change in <b>${meta.name}${seasonPhrase()}</b> per decade, ${s.start}–${s.end}.`;
  b.innerHTML = s.robustOnly
    ? `Strong colour means the change is <b>robust</b>. Pale cells could be noise.`
    : `Colour shows each cell's trend. Turn on fading to see which ones are robust.`;
  const lead = app.clusters[0];
  c.innerHTML = lead
    ? `Fastest change: <b>${cap(clusterName(lead))}</b>. Scroll on to read any place or watch it year by year.`
    : `Scroll on to read any place or watch it year by year.`;
}

// ---------------------------------------------------------------- year by year
function yearValue(c, t) {
  const raw = app.cube[t * app.g.size + c];
  if (raw === app.meta.fill) return NaN;
  const v = raw * app.meta.scale;
  const m = app.field.mean[c];
  if (!(m === m)) return NaN;
  if (app.state.units === "rel") return m > REL_MIN_MEAN ? ((v - m) / m) * 100 : NaN;
  return v - m;
}

function yearColors() {
  const { meta, g, state: s } = app;
  const season = meta.seasons[s.season];
  if (!app.yearScale) {
    // One fixed scale for the whole window, so years can be compared.
    const sample = [], weights = [];
    for (let y = s.start; y <= s.end; y++) {
      const t = y - season.firstYear;
      for (let c = 0; c < g.size; c += 3) { sample.push(yearValue(c, t)); weights.push(g.weight(c)); }
    }
    app.yearScale = makeScale(meta.palette, niceStep(sample, weights));
  }
  if (s.year == null || s.year < s.start || s.year > s.end) s.year = s.end;
  const t = s.year - season.firstYear;
  const colors = new Array(g.size);
  for (let c = 0; c < g.size; c++) {
    const v = yearValue(c, t);
    colors[c] = v === v ? app.yearScale.color(v) : null;
  }
  const slider = $("year");
  slider.min = s.start; slider.max = s.end; slider.value = s.year;
  $("year-out").textContent = s.year;
  app.timelineMarker?.(s.year);
  return colors;
}

function setMode(mode) {
  app.state.mode = mode;
  stopPlaying();
  if (mode === "trend") app.timelineMarker?.(null);
  paintMaps({ fade: true });
}

let playing = null;
function stopPlaying() {
  if (playing) cancelAnimationFrame(playing);
  playing = null;
  $("play").setAttribute("aria-pressed", "false");
  $("play").setAttribute("aria-label", "Play the years");
}
function togglePlay() {
  if (playing) { stopPlaying(); return; }
  const s = app.state;
  if (s.year >= s.end) s.year = s.start;
  $("play").setAttribute("aria-pressed", "true");
  $("play").setAttribute("aria-label", "Pause");
  // About six years a second: slow enough to read each map.
  let last = 0;
  const step = (now) => {
    if (now - last > 165) {
      last = now;
      paintMaps();
      if (s.year >= s.end) { stopPlaying(); return; }
      s.year++;
    }
    playing = requestAnimationFrame(step);
  };
  playing = requestAnimationFrame(step);
}

function renderHero() {
  const { meta, g, state: s } = app;
  const shares = areaShares({ slope: app.display, p: app.field.p }, g, app.threshold);
  const { fit, mean } = globalFit();
  const words = meta.words;
  const gSlope = s.units === "rel" ? (fit.slope * 10 / mean) * 100 : fit.slope * 10;
  const parts = [];
  const span = `Between ${s.start} and ${s.end}`;
  if (fit.p < 0.05) {
    parts.push(`${span}, Earth's ${meta.name}${seasonPhrase()} ${fit.slope > 0 ? words.rise : words.fall} by <strong>${counter("global", gSlope, "trend")} ${perDecade()}</strong> on global average.`);
  } else {
    parts.push(`${span}, Earth's ${meta.name}${seasonPhrase()} shows no robust global trend (${fmt(gSlope, dg(gSlope))} ${perDecade()}, p = ${fit.p.toFixed(2)}).`);
  }
  if (shares) {
    parts.push(`Robust ${words.noun} covers <strong>${counter("up", shares.up, "pct")}</strong> of the surface with data, robust ${words.antiNoun} <strong>${counter("down", shares.down, "pct")}</strong>.`);
  }
  const up = app.clusters.find((k) => k.sign > 0);
  const down = app.clusters.find((k) => k.sign < 0);
  const lead = app.clusters[0];
  if (lead) {
    const other = lead.sign > 0 ? down : up;
    parts.push(`The strongest signal is over <strong>${clusterName(lead)}</strong> (${fmt(lead.mean, dg(lead.mean))} ${perDecade()})${other ? `, while <strong>${clusterName(other)}</strong> ${other.sign > 0 ? words.rise : words.fall}` : ""}.`);
  }
  $("answer").innerHTML = parts.join(" ");
  runCounters($("answer"));

  if (shares) {
    const bar = $("shares");
    bar.hidden = false;
    const [down0, flat0, up0] = bar.querySelectorAll(".shares-bar span");
    const sc = app.scale;
    down0.style.flexBasis = `${shares.down * 100}%`;
    flat0.style.flexBasis = `${shares.flat * 100}%`;
    up0.style.flexBasis = `${shares.up * 100}%`;
    down0.style.background = sc.ramp[1];
    up0.style.background = sc.ramp[sc.ramp.length - 2];
    $("shares-caption").innerHTML =
      `<span><i style="background:${sc.ramp[1]}"></i>${cap(words.antiNoun)} <b>${pct(shares.down)}</b></span>` +
      `<span><i style="background:${cssVar("--rule")}"></i>No robust change <b>${pct(shares.flat)}</b></span>` +
      `<span><i style="background:${sc.ramp[sc.ramp.length - 2]}"></i>${cap(words.noun)} <b>${pct(shares.up)}</b></span>`;
    bar.querySelector(".shares-bar").setAttribute("aria-label",
      `${pct(shares.up)} robust ${words.noun}, ${pct(shares.flat)} no robust change, ${pct(shares.down)} robust ${words.antiNoun}`);
  }
}

const pct = (v) => (v < 0.005 && v > 0 ? "<1%" : `${Math.round(v * 100)}%`);

function clusterName(k) {
  // The spherical centroid; it is computed per cluster so it moves with the window.
  k.name ??= app.gazetteer.name(k.centroid);
  return k.name;
}

function renderAtlasHeading() {
  const { meta, state: s } = app;
  if (s.mode === "year") {
    $("atlas-title").textContent = `${meta.title}${seasonPhrase()}, ${s.year ?? s.end}`;
    $("atlas-sub").textContent =
      `Each cell compared with its own ${s.start}–${s.end} average. Press play to watch the years go by, or drag the slider.`;
    return;
  }
  $("atlas-title").textContent = `${meta.title}${seasonPhrase()}, trend per decade`;
  $("atlas-sub").textContent =
    `Sen's slope for ${s.start}–${s.end} at every ${meta.resolution.split(",")[0]} cell of ${meta.product}. ` +
    `Strong colours are robust after controlling the false discovery rate (p ≤ ${app.threshold ? app.threshold.toPrecision(2) : "—"}).`;
}

function renderPatterns() {
  const { meta, g, state: s } = app;
  const rows = zonalProfile({ slope: app.display, p: app.field.p }, g, meta.lat, app.threshold);
  zonalChart($("zonal"), rows, app.scale.color, perDecade(), animateIfSeen($("zonal")));

  const ups = app.clusters.filter((k) => k.sign > 0);
  const downs = app.clusters.filter((k) => k.sign < 0);
  // Show the strongest regions of both signs so opposite trends are visible.
  const picked = [...ups.slice(0, 4), ...downs.slice(0, 3)].sort((a, b) => b.score - a.score);
  const list = $("hotspots");
  if (!picked.length) {
    list.innerHTML = `<li class="empty">No connected region has a robust trend in this window. Try a longer period.</li>`;
  } else {
    list.classList.toggle("stagger", animateIfSeen(list));
    list.replaceChildren(...picked.map((k, i) => {
      const li = document.createElement("li");
      li.style.setProperty("--i", i);
      const share = areaFraction(k.area, g);
      const [plon, plat] = g.center(k.peak);
      li.innerHTML = `<button type="button">
        <span class="sw" style="background:${app.scale.color(k.mean)}"></span>
        <span><span class="hs-name">${cap(clusterName(k))}</span>
          <span class="hs-meta">${share < 0.001 ? "Under 0.1" : (share * 100).toFixed(1)}% of Earth's surface, peaking at ${fmt(app.display[k.peak], dg(app.display[k.peak]))} near ${app.gazetteer.coords([plon, plat])}</span></span>
        <span class="hs-val">${fmt(k.mean, dg(k.mean))}<small>${perDecade()}</small></span>
      </button>`;
      li.querySelector("button").addEventListener("click", () => {
        select({ type: "cluster", cells: k.cells, name: clusterName(k), centroid: k.centroid });
        $("atlas").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
      return li;
    }));
  }
  const opposite = ups.length && downs.length;
  $("hotspot-note").textContent = opposite
    ? `Connected regions where the trend is robust, ranked by size times strength. Both directions appear: ${meta.words.noun} in some places, ${meta.words.antiNoun} in others.`
    : `Connected regions where the trend is robust, ranked by size times strength.`;
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------- place panel
function selectionGeometry(sel) {
  if (sel.type === "cell") return boxPolygon(app.g.bounds(sel.cell));
  if (sel.type === "box") return boxPolygon(sel.box);
  if (sel.type === "cluster") return { type: "MultiPolygon", coordinates: sel.cells.map((c) => [app.flat.state.rings[c]]) };
  return null;
}

function select(sel) {
  app.state.sel = sel;
  const geom = selectionGeometry(sel);
  app.flat.setSelection(geom);
  app.globe.setSelection(geom);
  const center = sel.type === "cell" ? app.g.center(sel.cell)
    : sel.type === "box" ? [(sel.box[0] + sel.box[2]) / 2, (sel.box[1] + sel.box[3]) / 2]
    : sel.type === "cluster" ? sel.centroid : null;
  if (center && app.unfold === 0) turnGlobeTo(center);
  renderPlace({ animate: true });
  writeHash();
}

function renderPlace({ animate = false } = {}) {
  const { meta, g, state: s } = app;
  const sel = s.sel;
  const series = selectionSeries();
  const { ys, vs } = windowSlice(series.years, series.values);
  const windowMean = d3.mean(vs.filter((v) => v === v));
  const rel = s.units === "rel";
  const dispAll = toDisplay(series.values, windowMean);
  const disp = toDisplay(vs, windowMean);
  const fit = trend(ys, disp);
  const cp = pettitt(ys, disp);

  let kind, name, coords = "";
  if (sel.type === "cell") {
    kind = "Grid cell";
    name = placeName(sel.cell);
    const [x0, y0, x1, y1] = g.bounds(sel.cell);
    coords = `${app.gazetteer.coords(g.center(sel.cell))}, cell ${Math.abs(x1 - x0)}° × ${Math.abs(y1 - y0)}°`;
  } else if (sel.type === "box") {
    kind = "Region you outlined";
    const [x0, y0, x1, y1] = sel.box;
    const { label, more } = describeCells(series.cells);
    name = label;
    coords = `${app.gazetteer.coords([x0, y0])} to ${app.gazetteer.coords([x1, y1])}, ${series.cells.length} cells${more ? `, plus ${more} more ${more === 1 ? "place" : "places"}` : ""}`;
  } else if (sel.type === "cluster") {
    kind = "Region of robust change";
    name = sel.name;
    coords = `${series.cells.length} connected cells`;
  } else {
    kind = "Whole globe";
    name = "Global average";
    coords = "Area-weighted mean of all cells with data";
  }
  $("place-kind").textContent = kind;
  $("place-name").textContent = cap(name);
  $("place-coords").textContent = coords;
  $("reset-place").hidden = sel.type === "globe";

  const slope10 = fit.slope * 10;
  const verdict = $("place-verdict");
  if (!(fit.slope === fit.slope)) {
    verdict.textContent = `Too few years with data between ${s.start} and ${s.end} to estimate a trend here.`;
  } else {
    const sig = fit.p < 0.05;
    const dir = slope10 > 0 ? meta.words.rise : meta.words.fall;
    verdict.innerHTML = sig
      ? `<b>${fmt(slope10, dg(slope10))} ${perDecade()}</b><br>It ${dir}, and the trend is unlikely to be noise.`
      : `<b>${fmt(slope10, dg(slope10))} ${perDecade()}</b><br>No robust trend: a slope this size could arise by chance (p = ${fit.p.toFixed(2)}).`;
  }

  const stripeScale = makeScale(meta.palette, niceStep(dispAll.map((v) => v - (rel ? 0 : windowMean))));
  seriesChart($("place-chart"), {
    years: series.years, values: dispAll, start: s.start, end: s.end,
    fit, changePoint: cp, windowMean: rel ? 0 : windowMean, units: rel ? "% of mean" : meta.units,
    stripe: stripeScale.color,
    animate: animate && !matchMedia("(prefers-reduced-motion: reduce)").matches,
  });

  const rows = [];
  if (fit.slope === fit.slope) {
    rows.push(["Trend per decade, 95% range", `${fmt(fit.lower * 10, dg(fit.lower * 10))} to ${fmt(fit.upper * 10, dg(fit.upper * 10))}`]);
    rows.push([`Change over ${s.end - s.start} years`, `${fmt(fit.slope * (s.end - s.start), dg(fit.slope * (s.end - s.start)))} ${unitLabel()}`]);
    rows.push(["Mann–Kendall τ", fit.tau.toFixed(2)]);
    rows.push(["p-value, persistence-corrected", fit.p < 0.001 ? "< 0.001" : fit.p.toFixed(3)]);
    rows.push(["Effective number of years", `${Math.round(fit.nEff)} of ${fit.n}`]);
    if (rel === false && meta.relativeUnits && windowMean > REL_MIN_MEAN) {
      rows.push(["Relative trend", `${fmt((slope10 / windowMean) * 100, 1)}% per decade`]);
    }
  }
  if (cp) {
    rows.push(["Largest shift (Pettitt)", cp.p < 0.05
      ? `after ${cp.lastBefore}, ${fmt(cp.after - cp.before, dg(cp.after - cp.before))} ${unitLabel()}`
      : `none detected (p = ${cp.p.toFixed(2)})`]);
  }
  rows.push(["Mean over the window", `${windowMean.toFixed(2)} ${meta.units}`]);
  if (sel.type === "cell") {
    rows.push(["Robust on the map", robust(sel.cell) ? "Yes" : `No, needs p ≤ ${app.threshold.toPrecision(2)}`]);
  }
  rows.push(["Years with data", `${vs.filter((v) => v === v).length} of ${ys.length}`]);
  $("place-stats").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  app.lastSeries = { name, years: series.years, values: series.values, fit, units: meta.units };
  app.explain = {
    years: ys, values: disp, fit, name: `${meta.name} for ${sel.type === "globe" ? "the whole globe" : cap(name)}`,
    season: seasonPhrase(), units: unitLabel(), fieldP: app.field.p, threshold: app.threshold,
  };
  $("explain-for").textContent = `Worked through for ${sel.type === "globe" ? "the global average" : cap(name)}, ${s.start}–${s.end}. Pick another place on the map and every step updates.`;
  renderExplainer($("explain"), app.explain, animateIfSeen($("explain")));
}

function downloadSeries() {
  const { meta, state: s } = app;
  const last = app.lastSeries;
  if (!last) return;
  const lines = [
    `# ${meta.product}: ${meta.title}${seasonPhrase()}`,
    `# Place: ${last.name}`,
    `# Units: ${meta.units}${meta.baseline ? ` (anomaly vs ${meta.baseline})` : ""}`,
    `# Sen's slope ${s.start}-${s.end}: ${(last.fit.slope * 10).toFixed(4)} ${meta.units}/decade, Mann-Kendall p = ${last.fit.p.toFixed(4)}`,
    `# Source: ${meta.landing}  Retrieved: ${meta.retrieved}`,
    "year,value",
    ...last.years.map((y, i) => `${y},${Number.isFinite(last.values[i]) ? last.values[i].toFixed(3) : ""}`),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `drift-${meta.id}-${s.season}-${last.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- record
function renderRecord({ animate = false } = {}) {
  const { meta, state: s } = app;
  const { years, values, mean } = globalFit();
  const arr = Array.from(values);
  const color = makeScale(meta.palette, niceStep(arr.map((v) => v - mean))).color;
  const first = years.find((_, i) => arr[i] === arr[i]);
  $("record-sub").textContent =
    `Global mean ${meta.name}${seasonPhrase()} every year from ${first} to ${years[years.length - 1]}, ` +
    `coloured by how far it sat from the ${s.start}–${s.end} average. ${cap(meta.words.rise)} years run ${meta.palette === "temperature" ? "red" : "teal"}.`;
  renderStripes($("stripes"), $("stripes-read"), {
    years, values: arr, mean, color, start: s.start, end: s.end, units: meta.units, digits: 2,
  }, { animate: animate || animateIfSeen($("stripes")) });

  const picked = [...app.clusters].sort((a, b) => b.score - a.score).slice(0, 10);
  renderTicker($("ticker"), picked.map((k) => ({
    label: cap(clusterName(k)),
    value: `${fmt(k.mean, dg(k.mean))} ${perDecade()}`,
    color: app.scale.color(k.mean),
  })));
}

// ---------------------------------------------------------------- timeline
function renderTimeline() {
  const { meta, state: s } = app;
  const { years, values } = globalFit();
  const arr = Array.from(values);
  const mean = d3.mean(windowSlice(years, arr).vs.filter((v) => v === v));
  const stripe = makeScale(meta.palette, niceStep(arr.map((v) => v - mean))).color;
  $("timeline-label").textContent =
    `Global mean ${meta.name}${seasonPhrase()}, ${years[0]}–${years[years.length - 1]}. Drag the window to change the period. Years with data over less than 80% of the globe are left out.`;
  app.timelineMarker = timeline($("timeline"), {
    years, values: arr, mean, stripe, start: s.start, end: s.end, minSpan: MIN_SPAN,
  }, ([a, b]) => {
    s.start = a; s.end = b;
    fillYearSelects();
    compute();
  });
  if (app.state.mode === "year") app.timelineMarker(app.state.year);
}

// ---------------------------------------------------------------- sources
function renderSources() {
  const m = app.meta;
  $("sources").innerHTML = app.catalog.datasets.map((d) => d.id === m.id ? `
    <div class="source">
      <p><strong>${m.product}</strong>, ${m.institution}. ${m.title} in ${m.units}${m.baseline ? `, relative to ${m.baseline}` : ""}; ${m.resolution}.</p>
      <p>Monthly fields from ${m.firstMonth} to ${m.lastMonth}, reduced to annual and seasonal means. Seasons need every month present; annual means need at least ${m.seasons.annual.minMonths} of 12 months.</p>
      <p class="fine">${m.citation} <a href="${m.landing}">Data source</a>.</p>
    </div>` : `<div class="source"><p><strong>${d.product}</strong>, also available: choose ${d.name} in the question above.</p></div>`).join("");
  $("build-info").textContent = `Data retrieved ${new Date(m.retrieved).toUTCString().replace(/:\d\d GMT/, " UTC")}. Rebuild with scripts/build_data.py to update.`;
}

// ---------------------------------------------------------------- globe motion
const IDLE_RESUME = 6000; // ms after the last touch before the globe spins again
let lastTouch = -Infinity;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function touchGlobe() { lastTouch = performance.now(); }

function turnGlobeTo([lon, lat]) {
  touchGlobe();
  const from = app.globe.state.rotation.slice();
  const to = [-lon, -Math.max(-60, Math.min(60, lat)), 0];
  // Take the short way round.
  to[0] = from[0] + ((((to[0] - from[0]) % 360) + 540) % 360) - 180;
  if (reduceMotion()) { app.globe.rotate(to); return; }
  const interp = d3.interpolate(from, to);
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / 900);
    if (app.unfold === 0) app.globe.rotate(interp(d3.easeCubicInOut(t)));
    touchGlobe();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function startSpin() {
  if (reduceMotion()) return;
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe($("globe"));
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(64, now - last);
    last = now;
    const idle = now - lastTouch > IDLE_RESUME && app.state.sel.type === "globe";
    if (idle && visible && app.unfold === 0 && !document.hidden && !app.globe.isBusy() && app.field) {
      const r = app.globe.state.rotation;
      app.globe.rotate([r[0] + dt * 0.006, r[1], 0]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- scroll stage
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * One canvas tells the story as the page scrolls, and plays backwards when
 * scrolling up. u runs 0..3: the globe leaves its hero slot for the centre
 * and grows (0..1), unfolds into the flat map while the story is pinned
 * (1..2), then glides into the atlas map's place (2..3).
 */
function setupStage() {
  const sky = $("sky"), slot = $("globe-slot"), story = $("story"), canvas = $("globe");
  const pin = story.querySelector(".story-pin");
  const steps = [...$("unfold-steps").children];
  const bar = document.querySelector(".bar");
  const lerpBox = (a, b, t) => a.map((p, i) => p.map((v, j) => v + (b[i][j] - v) * t));
  const ease = d3.easeCubicInOut;
  let isStatic = false, held = null, phase = { a: 0, p: 0, q: 0 };

  const local = (r) => {
    const c = canvas.getBoundingClientRect();
    return [[r.left - c.left, r.top - c.top], [r.right - c.left, r.bottom - c.top]];
  };
  const slotBox = () => local(slot.getBoundingClientRect());
  const centreBox = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const size = Math.min(w * 0.62, h * 0.86);
    return [[(w - size) / 2, (h - size) / 2], [(w + size) / 2, (h + size) / 2]];
  };
  const flatBox = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight, g = Math.max(16, Math.min(56, w * 0.04));
    return [[g, h * 0.05], [w - g, h * 0.8]];
  };
  const atlasBox = () => {
    const [[x0, y0], [x1, y1]] = local($("map").getBoundingClientRect());
    const pad = 6; // same inset the atlas map uses for its own fit
    return [[x0 + pad, y0 + pad], [x1 - pad, y1 - pad]];
  };
  // map.js asks for the globe box (t = 0) and the flat box (t = 1).
  const extent = (t) => (t < 0.5
    ? lerpBox(slotBox(), centreBox(), ease(phase.a))
    : phase.q > 0 ? lerpBox(flatBox(), atlasBox(), ease(phase.q)) : flatBox());

  function progress() {
    const barH = bar.offsetHeight;
    const storyTop = story.getBoundingClientRect().top - barH;
    const heroSpan = storyTop + window.scrollY;               // scroll at which the story pins
    const a = heroSpan > 0 ? Math.min(1, Math.max(0, window.scrollY / heroSpan)) : 1;
    const range = story.offsetHeight - pin.offsetHeight;
    const p = Math.min(1, Math.max(0, -storyTop / range));
    const atlasTop = $("atlas").getBoundingClientRect().top - barH;
    const q = Math.min(1, Math.max(0, 1 - atlasTop / pin.offsetHeight));
    return a + p + q;
  }

  function apply(u) {
    const a = Math.min(1, u), p = Math.min(1, Math.max(0, u - 1)), q = Math.min(1, Math.max(0, u - 2));
    phase = { a, p, q };
    app.stageU = u;
    document.body.dataset.handoff = q >= 1 ? "atlas" : u > 0 ? "travel" : "stage";
    $("atlas").style.setProperty("--arrive", String(smoothstep(0.55, 1, q)));
    $("globe-hint").style.opacity = String(1 - smoothstep(0, 0.08, a));
    $("scroll-cue").style.opacity = String(1 - smoothstep(0, 0.1, a));
    steps.forEach((li) => li.classList.toggle("on", q === 0 && p >= +li.dataset.from && p < +li.dataset.to));

    if (u <= 0) {
      if (held) { app.unfold = 0; app.globe.setExtent(extent); app.globe.setMorph(0, held); held = null; }
      else app.globe.setExtent(extent);
      return;
    }
    if (!held) { held = app.globe.state.rotation.slice(); app.globe.stopInertia(); $("globe-tip").hidden = true; }
    // The globe turns a little as it travels, then faces 0°, 0° to unfold.
    const turn = smoothstep(0, 0.5, p);
    const lon0 = held[0] + 50 * ease(a);
    const lon = ((((lon0 % 360) + 540) % 360) - 180) * (1 - turn);
    const t = smoothstep(0.1, 0.75, p);
    app.unfold = t;
    app.globe.setExtent(extent);
    app.globe.setMorph(t, [lon, held[1] * (1 - turn), 0]);
  }

  // Scroll sets a target; the shown progress eases toward it every frame.
  let current = 0, target = 0, easing = 0;
  function update(jump = false) {
    if (isStatic) return;
    target = progress();
    if (jump) { current = target; apply(current); return; }
    if (easing) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      target = progress();
      current += (target - current) * (1 - Math.exp(-dt / 110));
      if (Math.abs(target - current) < 0.0004) current = target;
      apply(current);
      easing = current === target ? 0 : requestAnimationFrame(step);
    };
    easing = requestAnimationFrame(step);
  }

  function layout() {
    document.documentElement.style.setProperty("--bar-h", `${bar.offsetHeight}px`);
    isStatic = reduceMotion();
    document.body.classList.toggle("static", isStatic);
    if (isStatic) {
      app.stageU = 0;
      // No motion: the globe simply sits in its slot.
      if (sky.parentElement !== slot) slot.prepend(sky);
      document.body.dataset.handoff = "atlas";
      $("atlas").style.setProperty("--arrive", "1");
      app.unfold = 0;
      app.globe.setExtent(null);
      app.globe.setMorph(0, held);
      held = null;
      return;
    }
    if (sky.parentElement === slot) document.querySelector("main").prepend(sky);
    update(true);
  }

  window.addEventListener("scroll", () => update(), { passive: true });
  window.addEventListener("resize", layout);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", layout);
  document.fonts?.ready.then(() => layout());
  layout();
}

// ---------------------------------------------------------------- hover
function cellTip(c) {
  const name = `<b>${cap(placeName(c))}</b>`;
  const where = app.gazetteer.coords(app.g.center(c));
  if (app.state.mode === "year") {
    const t = app.state.year - app.meta.seasons[app.state.season].firstYear;
    const v = yearValue(c, t);
    return v === v
      ? `${name}<br>${fmt(v, dg(v))} ${unitLabel() === "%" ? "%" : unitLabel()} vs ${app.state.start}–${app.state.end} mean<small>${app.state.year}, ${where}</small>`
      : `${name}<small>No data in ${app.state.year}</small>`;
  }
  const v = app.display?.[c];
  return v === v
    ? `${name}<br>${fmt(v, dg(v))} ${perDecade()}<small>${robust(c) ? "Robust trend" : "Not robust"}, ${where}</small>`
    : `${name}<small>Not enough data in this window</small>`;
}

function placeTip(tip, map, ll, pt) {
  if (!ll || !app.field) { tip.hidden = true; map.setHover(null); return; }
  const c = app.g.cellAt(ll[0], ll[1]);
  if (c < 0) { tip.hidden = true; return; }
  map.setHover(boxPolygon(app.g.bounds(c)));
  tip.innerHTML = cellTip(c);
  tip.hidden = false;
  const wrap = tip.parentElement.getBoundingClientRect();
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(wrap.width - w - 4, Math.max(4, pt[0] + 14))}px`;
  tip.style.top = `${pt[1] + h + 24 > wrap.height ? pt[1] - h - 12 : pt[1] + 16}px`;
}

function bindMaps() {
  app.flat.on("hover", (ll, pt) => placeTip($("tip"), app.flat, ll, pt));
  app.globe.on("hover", (ll, pt) => placeTip($("globe-tip"), app.globe, ll, pt));
  const pick = (ll) => {
    const c = app.g.cellAt(ll[0], ll[1]);
    if (c >= 0) select({ type: "cell", cell: c });
  };
  app.flat.on("select", pick);
  app.globe.on("select", (ll) => { touchGlobe(); pick(ll); });
  app.flat.on("region", (box) => select({ type: "box", box }));
  app.globe.on("rotate", touchGlobe);
}

// ---------------------------------------------------------------- flourishes
/** Header bar that fills as the page is read. */
function setupProgress() {
  const bar = $("progress");
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
}

/** Panels marked .spot catch a soft light that follows the pointer. */
function setupSpotlight() {
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(".spot");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });
}

/** Wrap each word of the headline so it can rise in on load. */
function splitHeadline() {
  const h1 = $("question");
  let i = 0;
  const wrap = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.append(part); continue; }
          const w = document.createElement("span");
          w.className = "w";
          w.style.setProperty("--w", i++);
          w.textContent = part;
          frag.append(w);
        }
        child.replaceWith(frag);
      } else wrap(child);
    }
  };
  wrap(h1);
  document.body.classList.add("loaded");
}

/** The globe's place on screen, for the starfield's glow and orbit. */
function globeGeometry() {
  if (!app.globe?.state.width) return null;
  const r = $("globe").getBoundingClientRect();
  const [gx, gy, gr] = app.globe.state.globeFit;
  return { cx: r.left + gx, cy: r.top + gy, r: gr, morph: app.globe.state.morph, u: app.stageU };
}

// ---------------------------------------------------------------- boot
const makeWorker = () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

// Apply the URL's state without reloading: used by case links and edited URLs.
async function applyHash() {
  if (!app.meta) return;
  const s = app.state;
  s.sel = { type: "globe" }; s.units = "abs"; s.robustOnly = true;
  readHash();
  if (!app.catalog.datasets.some((d) => d.id === s.ds)) s.ds = app.meta.id;
  const dsSel = $("dataset");
  for (const o of dsSel.options) o.toggleAttribute("selected", o.value === s.ds);
  dsSel.value = s.ds;
  $("robust-only").checked = s.robustOnly;
  if (app.state.mode !== "trend") {
    document.querySelector('input[name="mode"][value="trend"]').checked = true;
    setMode("trend");
  }
  await switchDataset(s.ds, true);
  const geom = selectionGeometry(s.sel);
  app.flat.setSelection(geom);
  app.globe.setSelection(geom);
}

async function boot() {
  initTheme();
  readHash();
  const threads = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
  app.workers = Array.from({ length: threads }, makeWorker);
  app.globe = createMap($("globe"), { mode: "globe" });
  app.flat = createMap($("map"), { mode: "flat" });
  const theme = mapTheme();
  app.globe.setTheme(theme);
  app.flat.setTheme(theme);
  enhanceSegmented($("dataset"), { label: "Variable" });
  enhanceSegmented($("season"), { label: "Season" });
  for (const id of ["start", "end"]) enhanceSelect($(id), { columns: 6, label: $(id).closest(".pick").dataset.label });
  bindControls();
  bindMaps();
  setupStage();
  setupReveals();
  setupProgress();
  setupSpotlight();
  splitHeadline();
  app.cosmos = createCosmos($("cosmos"), $("cosmos-front"), globeGeometry);
  app.cosmos.setTheme(isDark());

  try {
    const [catalog, world] = await Promise.all([loadCatalog(), loadWorld()]);
    app.catalog = catalog;
    if (!catalog.datasets.length) throw new Error("The data catalog is empty. Run scripts/build_data.py.");
    const land = topojson.feature(world, world.objects.land);
    const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
    app.globe.setBasemap(land, null);
    app.flat.setBasemap(land, borders);
    app.gazetteer = createGazetteer(topojson.feature(world, world.objects.countries));

    $("dataset").replaceChildren(...catalog.datasets.map((d) => option(d.id, cap(d.name), false)));
    const ds = catalog.datasets.some((d) => d.id === app.state.ds) ? app.state.ds : catalog.datasets[0].id;
    $("dataset").value = ds;
    $("robust-only").checked = app.state.robustOnly;
    await switchDataset(ds);
    const sel = app.state.sel;
    if (sel.type !== "globe") {
      const geom = selectionGeometry(sel);
      app.flat.setSelection(geom);
      app.globe.setSelection(geom);
    }
    startSpin();
  } catch (error) {
    showError(error.message);
  }

  // State changes made in the app use replaceState, so this fires only for a
  // followed link (a case file) or an edited URL. Apply it in place.
  window.addEventListener("hashchange", applyHash);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (app.field) { renderPlace(); renderPatterns(); renderTimeline(); } }, 150);
  });
}

boot();
