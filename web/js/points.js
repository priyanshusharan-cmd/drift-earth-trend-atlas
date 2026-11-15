// Point lab: NASA POWER (MERRA-2) monthly records at eight places. Every
// number on the page is computed here from the monthly values.
import { trend, pettitt, fdrThreshold } from "./stats.js";

const d3 = globalThis.d3, topojson = globalThis.topojson;
const $ = (id) => document.getElementById(id);
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SEASONS = { annual: ["Whole year", [1,2,3,4,5,6,7,8,9,10,11,12]], djf: ["Dec–Feb", [12,1,2]], mam: ["Mar–May", [3,4,5]], jja: ["Jun–Aug", [6,7,8]], son: ["Sep–Nov", [9,10,11]] };
const ATLAS = { T2M: "gistemp", PRECTOTCORR: "gpcp" };
const Q = 0.10;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

const st = { par: "T2M", season: "annual", start: 1984, end: 2024, sel: null };
let D, world, results = [];

function seasonal(monthly, season, y0) {
  // One value per year; Dec–Feb belongs to the year of its January.
  const months = SEASONS[season][1], years = [], vals = [];
  for (let y = D.start; y <= D.end; y++) {
    let sum = 0, w = 0, ok = true;
    for (const m of months) {
      const yy = season === "djf" && m === 12 ? y - 1 : y;
      const v = yy < D.start ? null : monthly[(yy - y0) * 12 + m - 1];
      if (v == null) { ok = false; break; }
      sum += v * DAYS[m - 1]; w += DAYS[m - 1];
    }
    years.push(y); vals.push(ok ? sum / w : NaN);
  }
  return { years, vals };
}

function compute() {
  const unit = D.params[st.par].units;
  results = D.points.map((p) => {
    const s = seasonal(p.monthly[st.par], st.season, D.start);
    const i0 = s.years.indexOf(st.start), i1 = s.years.indexOf(st.end) + 1;
    const ys = s.years.slice(i0, i1), vs = s.vals.slice(i0, i1);
    const t = trend(ys, vs);
    const c = pettitt(ys, vs);
    const valid = vs.filter((v) => v === v);
    return { p, all: s, ys, vs, t, c, unit, mean: d3.mean(valid) };
  });
  const ps = results.map((r) => r.t?.p ?? 1);
  const thr = fdrThreshold(ps, Q);
  for (const r of results) r.robust = r.t && r.t.p <= thr;
  if (!st.sel || !results.some((r) => r.p.id === st.sel)) st.sel = results[0].p.id;
}

const per10 = (r) => (r.t ? r.t.slope * 10 : NaN);
const fmt = (v, d = 2) => (v === v ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}` : "–");
const color = (r, max) => {
  if (!r.t) return "var(--nodata)";
  const k = Math.min(1, Math.abs(per10(r)) / max);
  const warm = st.par === "PRECTOTCORR" || st.par === "RH2M" ? (per10(r) > 0 ? "#35978f" : "#bf812d") : (per10(r) > 0 ? "#d6604d" : "#4393c3");
  return r.robust ? d3.interpolateRgb("#f2efe9", warm)(0.35 + 0.65 * k) : "var(--nodata)";
};
const verdict = (r) => !r.t ? "Too few years" : !r.robust ? "No robust trend" : per10(r) > 0 ? "Robust rise" : "Robust fall";

function spark(svgEl, r, max) {
  const w = 240, h = 64, svg = d3.select(svgEl).attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  const pts = r.ys.map((y, i) => [y, r.vs[i]]).filter((d) => d[1] === d[1]);
  if (pts.length < 2) return;
  const x = d3.scaleLinear().domain(d3.extent(pts, (d) => d[0])).range([4, w - 4]);
  const y = d3.scaleLinear().domain(d3.extent(pts, (d) => d[1])).nice().range([h - 6, 6]);
  const path = svg.append("path").attr("class", "pl-spark").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(pts));
  if (r.t) {
    const xm = (st.start + st.end) / 2, f = (yr) => r.t.intercept + r.t.slope * yr;
    svg.append("line").attr("class", "pl-fit").attr("stroke", color(r, max) === "var(--nodata)" ? "var(--ink-3)" : color(r, max))
      .attr("x1", x(st.start)).attr("x2", x(st.end)).attr("y1", y(f(st.start))).attr("y2", y(f(st.end)));
  }
  if (!reduce) {
    const L = path.node().getTotalLength();
    path.attr("stroke-dasharray", L).attr("stroke-dashoffset", L).transition().duration(1200).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0);
  }
}

function renderCards() {
  const max = d3.max(results, (r) => Math.abs(per10(r)) || 0) || 1;
  const host = $("pl-cards");
  host.replaceChildren();
  results.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "pl-card spot" + (r.p.id === st.sel ? " on" : "");
    li.style.setProperty("--i", i);
    const up = per10(r) > 0;
    li.innerHTML = `<button type="button" aria-pressed="${r.p.id === st.sel}">
      <span class="pl-card-head"><span class="pl-name">${r.p.name}</span>
      <span class="pl-arrow ${r.robust ? (up ? "up" : "down") : "flat"}" aria-hidden="true">${r.robust ? (up ? "↗" : "↘") : "→"}</span></span>
      <svg class="pl-sparkline" aria-hidden="true"></svg>
      <span class="pl-rate"><b>${fmt(per10(r))}</b> ${r.unit} per decade</span>
      <span class="pl-verdict ${r.robust ? "yes" : ""}">${verdict(r)} · p ${r.t ? (r.t.p < 0.001 ? "< 0.001" : "= " + r.t.p.toFixed(3)) : "–"}</span></button>`;
    li.querySelector("button").addEventListener("click", () => { st.sel = r.p.id; renderAll(false); $("pl-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); });
    host.append(li);
    spark(li.querySelector("svg"), r, max);
  });
}

function renderMap() {
  const el = $("pl-map"), w = el.clientWidth || 600, h = Math.round(w * 0.5);
  const svg = d3.select(el).attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  const proj = d3.geoEqualEarth().fitSize([w, h], { type: "Sphere" });
  const path = d3.geoPath(proj);
  svg.append("path").attr("class", "pl-sphere").attr("d", path({ type: "Sphere" }));
  svg.append("path").attr("class", "pl-grat").attr("d", path(d3.geoGraticule10()));
  svg.append("path").attr("class", "pl-land").attr("d", path(topojson.feature(world, world.objects.land)));
  const max = d3.max(results, (r) => Math.abs(per10(r)) || 0) || 1;
  const g = svg.selectAll("g.pl-pin").data(results).join("g").attr("class", (r) => "pl-pin" + (r.p.id === st.sel ? " on" : ""))
    .attr("transform", (r) => `translate(${proj([r.p.lon, r.p.lat])})`).style("cursor", "pointer")
    .on("click", (_, r) => { st.sel = r.p.id; renderAll(false); });
  g.append("circle").attr("class", "pl-ring").attr("r", 9).attr("stroke", (r) => color(r, max));
  g.append("circle").attr("r", 7).attr("fill", (r) => color(r, max)).attr("stroke", "var(--ink)").attr("stroke-width", 1.2);
  g.append("text").attr("y", -14).attr("text-anchor", "middle").attr("class", "pl-pin-label").text((r) => r.p.name);
  g.append("title").text((r) => `${r.p.name}: ${fmt(per10(r))} ${r.unit} per decade, ${verdict(r).toLowerCase()}`);
}

function renderRank() {
  const el = $("pl-rank"), rows = [...results].filter((r) => r.t).sort((a, b) => per10(b) - per10(a));
  const w = el.clientWidth || 600, rowH = 34, h = rows.length * rowH + 30, mid = 190;
  const svg = d3.select(el).attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  const ext = d3.max(rows, (r) => Math.max(Math.abs(per10(r)), Math.abs(r.t.upper * 10), Math.abs(r.t.lower * 10))) || 1;
  const x = d3.scaleLinear().domain([-ext, ext]).nice().range([mid, w - 20]);
  svg.append("line").attr("class", "pl-zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 8).attr("y2", h - 18);
  svg.append("g").attr("transform", `translate(0,${h - 18})`).attr("class", "pl-axis").call(d3.axisBottom(x).ticks(5).tickSize(0).tickFormat((v) => fmt(v, 1)));
  const max = d3.max(results, (r) => Math.abs(per10(r)) || 0) || 1;
  const g = svg.selectAll("g.pl-row").data(rows).join("g").attr("class", "pl-row").attr("transform", (_, i) => `translate(0,${8 + i * rowH})`)
    .style("cursor", "pointer").on("click", (_, r) => { st.sel = r.p.id; renderAll(false); });
  g.append("text").attr("x", mid - 12).attr("y", 18).attr("text-anchor", "end").attr("class", (r) => "pl-row-name" + (r.p.id === st.sel ? " on" : "")).text((r) => r.p.name);
  g.append("line").attr("class", "pl-ci").attr("y1", 14).attr("y2", 14).attr("x1", (r) => x(r.t.lower * 10)).attr("x2", (r) => x(r.t.upper * 10));
  const bars = g.append("rect").attr("y", 6).attr("height", 16).attr("rx", 4).attr("fill", (r) => color(r, max))
    .attr("x", x(0)).attr("width", 0);
  const fin = (sel) => sel.attr("x", (r) => Math.min(x(0), x(per10(r)))).attr("width", (r) => Math.abs(x(per10(r)) - x(0)));
  if (reduce) fin(bars); else fin(bars.transition().duration(900).delay((_, i) => i * 70).ease(d3.easeCubicOut));
}

function renderDetail() {
  const r = results.find((x) => x.p.id === st.sel), P = D.params[st.par];
  $("pl-d-name").textContent = r.p.name;
  $("pl-d-coords").textContent = `${Math.abs(r.p.lat).toFixed(1)}°${r.p.lat >= 0 ? "N" : "S"}, ${Math.abs(r.p.lon).toFixed(1)}°${r.p.lon >= 0 ? "E" : "W"} · ${P.name} · ${SEASONS[st.season][0]} · ${st.start}–${st.end}`;
  const t = r.t;
  $("pl-d-verdict").innerHTML = !t ? "Not enough years with data." :
    `<b>${fmt(t.slope * 10)} ${r.unit} per decade.</b> ${r.robust ? (t.slope > 0 ? "A robust rise:" : "A robust fall:") : "Not robust:"} ${r.robust ? "it survives the false discovery test across all eight places." : "a change this size could plausibly be chance."}`;
  // chart
  const el = $("pl-d-chart"), w = el.clientWidth || 640, h = 300, m = { t: 20, r: 16, b: 28, l: 48 };
  const svg = d3.select(el).attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  const all = r.all.years.map((y, i) => [y, r.all.vals[i]]).filter((d) => d[1] === d[1]);
  const x = d3.scaleLinear().domain([D.start, D.end]).range([m.l, w - m.r]);
  const y = d3.scaleLinear().domain(d3.extent(all, (d) => d[1])).nice().range([h - m.b, m.t]);
  svg.append("rect").attr("class", "pl-window").attr("x", x(st.start)).attr("width", x(st.end) - x(st.start)).attr("y", m.t).attr("height", h - m.b - m.t);
  svg.append("g").attr("class", "pl-axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d")).tickSizeOuter(0));
  svg.append("g").attr("class", "pl-axis").attr("transform", `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSizeOuter(0));
  if (t) {
    const xm = d3.mean(r.ys), ym = t.intercept + t.slope * xm;
    const band = [st.start, st.end].flatMap((yr) => [[yr, ym + t.upper * (yr - xm)]]).concat([st.end, st.start].map((yr) => [yr, ym + t.lower * (yr - xm)]));
    svg.append("path").attr("class", "pl-band").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(band) + "Z");
  }
  const line = svg.append("path").attr("class", "pl-line").attr("d", d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(all));
  svg.selectAll("circle.pl-dot").data(all).join("circle").attr("class", (d) => "pl-dot" + (d[0] < st.start || d[0] > st.end ? " out" : ""))
    .attr("cx", (d) => x(d[0])).attr("cy", (d) => y(d[1])).attr("r", 2.8);
  if (t) {
    const f = (yr) => t.intercept + t.slope * yr;
    svg.append("line").attr("class", "pl-trend").attr("x1", x(st.start)).attr("x2", x(st.end)).attr("y1", y(f(st.start))).attr("y2", y(f(st.end)));
  }
  if (r.c && r.c.p < 0.05) {
    const xc = x((r.c.lastBefore + r.c.firstAfter) / 2);
    svg.append("line").attr("class", "pl-shift").attr("x1", xc).attr("x2", xc).attr("y1", m.t).attr("y2", h - m.b);
    svg.append("text").attr("class", "pl-shift-label").attr("x", xc + 5).attr("y", m.t + 12).text(`shift after ${r.c.lastBefore}`);
  }
  if (!reduce) {
    const L = line.node().getTotalLength();
    line.attr("stroke-dasharray", L).attr("stroke-dashoffset", L).transition().duration(1400).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0);
  }
  // stats
  const rows = t ? [
    ["Trend per decade, 95% range", `${fmt(t.lower * 10)} to ${fmt(t.upper * 10)} ${r.unit}`],
    [`Change over ${st.end - st.start} years`, `${fmt(t.slope * (st.end - st.start))} ${r.unit}`],
    ["Mean over the window", `${r.mean.toFixed(2)} ${r.unit}`],
    ["Mann–Kendall τ", t.tau.toFixed(2)],
    ["p-value, persistence-corrected", t.p < 0.001 ? "< 0.001" : t.p.toFixed(3)],
    ["Robust after FDR (8 places, q = 0.10)", r.robust ? "Yes" : "No"],
    ["Largest shift (Pettitt)", r.c ? `after ${r.c.lastBefore}, ${fmt(r.c.after - r.c.before)} ${r.unit}${r.c.p < 0.05 ? "" : " (not significant)"}` : "–"],
    ["Effective number of years", `${t.nEff.toFixed(0)} of ${t.n}`],
  ] : [];
  $("pl-d-stats").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  const ds = ATLAS[st.par];
  const atlas = $("pl-d-atlas");
  if (ds) {
    const b = [r.p.lon - 3, r.p.lat - 3, r.p.lon + 3, r.p.lat + 3].map((v) => v.toFixed(1)).join(",");
    const y0 = Math.max(st.start, ds === "gpcp" ? 1979 : 1900), y1 = Math.min(st.end, 2025);
    atlas.href = `index.html#d=${ds}&s=${st.season}&y=${y0}-${y1}&p=b${b}`;
    atlas.hidden = false;
  } else atlas.hidden = true;
}

function renderSummary() {
  const n = results.filter((r) => r.robust).length, up = results.filter((r) => r.robust && per10(r) > 0).length;
  const top = [...results].filter((r) => r.t).sort((a, b) => Math.abs(per10(b)) - Math.abs(per10(a)))[0];
  const P = D.params[st.par];
  $("pl-summary").innerHTML = `${P.name}, ${SEASONS[st.season][0].toLowerCase()}, ${st.start}–${st.end}: <b>${n} of 8</b> places show a robust trend (${up} rising, ${n - up} falling). The fastest change is in <b>${top.p.name}</b> at <b>${fmt(per10(top))} ${top.unit}</b> per decade.`;
}

function download() {
  const r = results.find((x) => x.p.id === st.sel), P = D.params[st.par];
  const lines = [`# ${r.p.name} (${r.p.lat}, ${r.p.lon}) · ${P.name} (${P.units}) · ${SEASONS[st.season][0]}`,
    `# Source: ${D.source}, retrieved ${D.retrieved}. ${r.p.url}`,
    `# Values are day-weighted means of NASA POWER monthly values; a period needs every month. Trend: Sen's slope, Mann–Kendall with Hamed–Rao correction.`,
    "year,value", ...r.all.years.map((y, i) => `${y},${r.all.vals[i] === r.all.vals[i] ? r.all.vals[i].toFixed(3) : ""}`)];
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: `drift-power-${r.p.id}-${st.par}-${st.season}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}

function renderAll(cards = true) {
  compute();
  if (cards) renderCards(); else document.querySelectorAll(".pl-card").forEach((li, i) => {
    const on = results[i].p.id === st.sel; li.classList.toggle("on", on); li.querySelector("button").setAttribute("aria-pressed", on);
  });
  renderSummary(); renderMap(); renderRank(); renderDetail();
  history.replaceState(null, "", `#v=${st.par}&s=${st.season}&y=${st.start}-${st.end}&p=${st.sel}`);
}

function seg(host, items, value, onPick) {
  host.replaceChildren(...items.map(([k, label]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.className = k === value ? "on" : "";
    b.setAttribute("aria-pressed", k === value);
    b.addEventListener("click", () => { host.querySelectorAll("button").forEach((x) => { x.className = ""; x.setAttribute("aria-pressed", false); }); b.className = "on"; b.setAttribute("aria-pressed", true); onPick(k); });
    return b;
  }));
}

function years() {
  const opts = (lo, hi, v) => d3.range(lo, hi + 1).map((y) => `<option${y === v ? " selected" : ""}>${y}</option>`).join("");
  $("pl-start").innerHTML = opts(D.start, st.end - 9, st.start);
  $("pl-end").innerHTML = opts(st.start + 9, D.end, st.end);
}

async function boot() {
  const h = new URLSearchParams(location.hash.slice(1));
  [D, world] = await Promise.all([fetch("data/power/points.json").then((r) => r.json()), fetch("data/world-110m.json").then((r) => r.json())]);
  if (D.params[h.get("v")]) st.par = h.get("v");
  if (SEASONS[h.get("s")]) st.season = h.get("s");
  const yy = h.get("y")?.match(/^(\d{4})-(\d{4})$/);
  if (yy && +yy[2] - +yy[1] >= 9) { st.start = Math.max(D.start, +yy[1]); st.end = Math.min(D.end, +yy[2]); }
  if (h.get("p")) st.sel = h.get("p");
  seg($("pl-var"), Object.entries(D.params).map(([k, v]) => [k, v.name.replace(/ \(.*\)| at 2 m/g, "")]), st.par, (k) => { st.par = k; renderAll(); });
  seg($("pl-season"), Object.entries(SEASONS).map(([k, v]) => [k, v[0]]), st.season, (k) => { st.season = k; renderAll(); });
  years();
  $("pl-start").addEventListener("change", (e) => { st.start = +e.target.value; years(); renderAll(); });
  $("pl-end").addEventListener("change", (e) => { st.end = +e.target.value; years(); renderAll(); });
  $("pl-download").addEventListener("click", download);
  $("pl-retrieved").textContent = new Date(D.retrieved).toUTCString().slice(5, 16);
  renderAll();
  let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { renderMap(); renderRank(); renderDetail(); }, 150); });
}

boot().catch((e) => { $("pl-summary").textContent = `Could not load the NASA POWER data: ${e.message}`; });
