// SVG charts: the time series of a place, the zonal profile, and the
// timeline used to choose the analysis window.

const d3 = globalThis.d3;

const fmt = (v, digits = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(digits);

function frame(el, height, margin) {
  const width = Math.max(240, el.clientWidth);
  const svg = d3.select(el).selectAll("svg").data([0]).join("svg")
    .attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height);
  svg.selectAll("*").remove();
  return { svg, width, inner: [margin.left, width - margin.right, margin.top, height - margin.bottom] };
}

/**
 * Yearly values for a place with the Sen fit, its 95% band and the Pettitt
 * change point. `scale` colours the stripe row by departure from the window mean.
 */
export function seriesChart(el, d) {
  const margin = { top: 34, right: 12, bottom: 26, left: 44 };
  const { svg, inner: [x0, x1, y0, y1] } = frame(el, 280, margin);
  const pts = d.years.map((y, i) => ({ y, v: d.values[i] })).filter((p) => p.v === p.v);
  if (pts.length < 2) {
    svg.append("text").attr("class", "chart-empty").attr("x", x0).attr("y", 120)
      .text("Not enough years with data at this place.");
    return;
  }
  const inWin = (p) => p.y >= d.start && p.y <= d.end;
  const x = d3.scaleLinear().domain(d3.extent(d.years)).range([x0, x1]);
  const ext = d3.extent(pts, (p) => p.v);
  const pad = (ext[1] - ext[0]) * 0.08 || 0.5;
  const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).nice().range([y1, y0]);

  // Window shading
  svg.append("rect").attr("class", "win").attr("x", x(d.start - 0.5)).attr("width", x(d.end + 0.5) - x(d.start - 0.5))
    .attr("y", y0).attr("height", y1 - y0);

  // Stripes: one bar per year coloured by departure from the window mean.
  const bw = Math.max(1, (x1 - x0) / d.years.length);
  svg.append("g").selectAll("rect").data(pts).join("rect")
    .attr("x", (p) => x(p.y) - bw / 2).attr("width", bw + 0.4)
    .attr("y", 6).attr("height", 18)
    .attr("fill", (p) => d.stripe(p.v - d.windowMean))
    .attr("opacity", (p) => (inWin(p) ? 1 : 0.45));

  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y1})`)
    .call(d3.axisBottom(x).ticks(Math.min(8, (x1 - x0) / 60)).tickFormat(d3.format("d")).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${x0},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSize(-(x1 - x0)).tickFormat((v) => d3.format("~r")(v)))
    .call((g) => g.select(".domain").remove());

  const fit = d.fit;
  if (fit && fit.slope === fit.slope) {
    const xm = (d.start + d.end) / 2;
    const ym = fit.intercept + fit.slope * xm;
    const band = [d.start, d.end].map((yr) => {
      const a = ym + fit.lower * (yr - xm), b = ym + fit.upper * (yr - xm);
      return { yr, lo: Math.min(a, b), hi: Math.max(a, b) };
    });
    svg.append("path").attr("class", "band")
      .attr("d", d3.area().x((p) => x(p.yr)).y0((p) => y(p.lo)).y1((p) => y(p.hi))(band));
    svg.append("line").attr("class", "fit")
      .attr("x1", x(d.start)).attr("x2", x(d.end))
      .attr("y1", y(fit.intercept + fit.slope * d.start)).attr("y2", y(fit.intercept + fit.slope * d.end));
  }

  const line = svg.append("path").attr("class", "series")
    .attr("d", d3.line().defined((p) => p.v === p.v).x((p) => x(p.y)).y((p) => y(p.v))(d.years.map((yr, i) => ({ y: yr, v: d.values[i] }))));
  const dots = svg.append("g").selectAll("circle").data(pts.filter(inWin)).join("circle")
    .attr("class", "dot").attr("r", 2).attr("cx", (p) => x(p.y)).attr("cy", (p) => y(p.v));

  if (d.animate) {
    // The record draws itself left to right, then the fit settles in.
    const len = line.node().getTotalLength();
    line.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
      .transition().duration(900).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
      .on("end", () => line.attr("stroke-dasharray", null));
    dots.attr("opacity", 0).transition().delay((p) => 200 + ((x(p.y) - x0) / (x1 - x0)) * 700).duration(150).attr("opacity", 1);
    svg.selectAll(".fit, .band").attr("opacity", 0).transition().delay(650).duration(400).attr("opacity", 1);
    svg.selectAll("g > rect").attr("opacity", 0).transition().delay((_, i, n) => (i / n.length) * 600).duration(200)
      .attr("opacity", (p) => (inWin(p) ? 1 : 0.45));
  }

  const cp = d.changePoint;
  if (cp && cp.p < 0.05) {
    const xc = x(cp.lastBefore + 0.5);
    svg.append("line").attr("class", "cp").attr("x1", xc).attr("x2", xc).attr("y1", y0).attr("y2", y1);
    svg.append("line").attr("class", "cp-mean").attr("x1", x(d.start)).attr("x2", xc).attr("y1", y(cp.before)).attr("y2", y(cp.before));
    svg.append("line").attr("class", "cp-mean").attr("x1", xc).attr("x2", x(d.end)).attr("y1", y(cp.after)).attr("y2", y(cp.after));
    const right = xc < (x0 + x1) / 2;
    svg.append("text").attr("class", "cp-label").attr("x", xc + (right ? 6 : -6)).attr("y", y0 + 12)
      .attr("text-anchor", right ? "start" : "end").text(`shift after ${cp.lastBefore}`);
  }

  svg.append("text").attr("class", "unit").attr("x", x0 - 36).attr("y", y0 - 6).text(d.units);
}

/** Mean trend for each latitude row; opacity shows how much of it is robust. */
export function zonalChart(el, rows, color, units, animate = false) {
  const margin = { top: 8, right: 14, bottom: 28, left: 36 };
  const { svg, inner: [x0, x1, y0, y1] } = frame(el, 300, margin);
  const valid = rows.filter((r) => r.slope === r.slope);
  if (!valid.length) return;
  const lo = Math.min(0, d3.min(valid, (r) => r.slope));
  const hi = Math.max(0, d3.max(valid, (r) => r.slope));
  const pad = (hi - lo) * 0.05 || 0.1;
  const x = d3.scaleLinear().domain([lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0]).nice().range([x0, x1]);
  const y = d3.scaleLinear().domain([-90, 90]).range([y1, y0]);
  const h = Math.max(1, (y1 - y0) / rows.length);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y1})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat((v) => fmt(v, 1)).tickSizeOuter(0));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${x0},0)`)
    .call(d3.axisLeft(y).tickValues([-60, -30, 0, 30, 60]).tickFormat((v) => (v === 0 ? "Eq" : `${Math.abs(v)}°${v > 0 ? "N" : "S"}`)).tickSize(-(x1 - x0)))
    .call((g) => g.select(".domain").remove());
  svg.append("line").attr("class", "zero").attr("x1", x(0)).attr("x2", x(0)).attr("y1", y0).attr("y2", y1);
  const bars = svg.append("g").selectAll("rect").data(valid).join("rect")
    .attr("y", (r) => y(r.lat) - h / 2).attr("height", h + 0.3)
    .attr("fill", (r) => color(r.slope)).attr("opacity", (r) => 0.35 + 0.65 * r.robust);
  // Bars grow out from zero, pole to pole.
  (animate ? bars.attr("x", x(0)).attr("width", 0)
    .transition().delay((r, i) => i * (700 / valid.length)).duration(500).ease(d3.easeCubicOut) : bars)
    .attr("x", (r) => Math.min(x(0), x(r.slope))).attr("width", (r) => Math.abs(x(r.slope) - x(0)));
  bars.append("title").text((r) => `${r.lat}°: ${fmt(r.slope)} ${units} per decade, ${Math.round(r.robust * 100)}% robust`);
}

/**
 * Global mean series with a brush to choose the analysis window.
 * Calls onChange([start, end]) with whole years when the brush settles.
 */
export function timeline(el, d, onChange) {
  const margin = { top: 6, right: 10, bottom: 22, left: 10 };
  const { svg, inner: [x0, x1, y0, y1] } = frame(el, 76, margin);
  const x = d3.scaleLinear().domain([d.years[0], d.years[d.years.length - 1]]).range([x0, x1]);
  const vals = d.values.filter((v) => v === v);
  const y = d3.scaleLinear().domain(d3.extent(vals)).nice().range([y1, y0]);
  const bw = (x1 - x0) / d.years.length;
  const [lo, hi] = y.domain();
  const base = lo < 0 && hi > 0 ? y(0) : y1;
  svg.append("g").selectAll("rect").data(d.years.map((yr, i) => ({ yr, v: d.values[i] })).filter((p) => p.v === p.v)).join("rect")
    .attr("class", "tl-bar").attr("x", (p) => x(p.yr) - bw / 2).attr("width", Math.max(1, bw - 0.6))
    .attr("y", (p) => Math.min(base, y(p.v))).attr("height", (p) => Math.max(1, Math.abs(base - y(p.v))))
    .attr("fill", (p) => d.stripe(p.v - d.mean));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${y1})`)
    .call(d3.axisBottom(x).ticks(Math.min(12, (x1 - x0) / 70)).tickFormat(d3.format("d")).tickSizeOuter(0));

  const snap = (px) => Math.round(x.invert(px));
  const brush = d3.brushX().extent([[x0, y0 - 2], [x1, y1]])
    .on("brush", (e) => {
      if (!e.sourceEvent || !e.selection) return;
      const [a, b] = e.selection.map(snap);
      d.onPreview?.([a, b]);
    })
    .on("end", (e) => {
      if (!e.sourceEvent) return;
      if (!e.selection) { g.call(brush.move, [x(d.start - 0.5), x(d.end + 0.5)]); return; }
      let [a, b] = e.selection.map(snap);
      if (b - a < d.minSpan - 1) b = Math.min(d.years[d.years.length - 1], a + d.minSpan - 1), a = b - d.minSpan + 1;
      g.call(brush.move, [x(a - 0.5), x(b + 0.5)]);
      onChange([a, b]);
    });
  const g = svg.append("g").attr("class", "brush").call(brush);
  g.call(brush.move, [x(d.start - 0.5), x(d.end + 0.5)]);

  // A marker for the year shown in year-by-year mode.
  const marker = svg.append("line").attr("class", "tl-marker").attr("y1", y0 - 4).attr("y2", y1).attr("hidden", "");
  return (year) => {
    if (year == null) { marker.attr("hidden", ""); return; }
    marker.attr("hidden", null).attr("x1", x(year)).attr("x2", x(year));
  };
}

export { fmt };
