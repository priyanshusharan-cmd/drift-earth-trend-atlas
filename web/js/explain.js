// "How Drift reads a place": the four steps of the method, drawn from the
// series that is currently selected, so the explanation is always the real
// calculation rather than a diagram of one.

const d3 = globalThis.d3;
const W = 300, H = 150, M = { top: 10, right: 8, bottom: 20, left: 8 };

function svgIn(el) {
  return d3.select(el).selectAll("svg").data([0]).join("svg")
    .attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet")
    .call((s) => s.selectAll("*").remove());
}

/** Draw a path from left to right when `animate` is on. */
function drawIn(sel, animate, delay = 0, duration = 900) {
  if (!animate) return sel;
  sel.each(function () {
    const len = this.getTotalLength?.() || 0;
    d3.select(this).attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
      .transition().delay(delay).duration(duration).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0)
      .on("end", function () { d3.select(this).attr("stroke-dasharray", null); });
  });
  return sel;
}

function fade(sel, animate, delay = 0, duration = 400) {
  if (!animate) return sel;
  return sel.attr("opacity", 0).transition().delay(delay).duration(duration).attr("opacity", 1);
}

export function renderExplainer(root, d, animate) {
  const steps = root.querySelectorAll(".explain-fig");
  const notes = root.querySelectorAll(".explain-text");
  const pts = d.years.map((y, i) => ({ y, v: d.values[i] })).filter((p) => p.v === p.v);
  if (pts.length < 8 || !(d.fit.slope === d.fit.slope)) {
    notes.forEach((n) => { n.textContent = "Pick a place with more years of data to see each step."; });
    steps.forEach((s) => svgIn(s));
    return;
  }
  const x = d3.scaleLinear().domain(d3.extent(pts, (p) => p.y)).range([M.left, W - M.right]);
  const ext = d3.extent(pts, (p) => p.v);
  const pad = (ext[1] - ext[0]) * 0.1 || 0.5;
  const y = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([H - M.bottom, M.top]);
  const axis = (svg) => svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.bottom})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format("d")).tickSizeOuter(0));
  const per10 = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 10).toFixed(Math.abs(v * 10) < 0.1 ? 3 : 2)}`;

  // 1. One value per year
  {
    const svg = svgIn(steps[0]);
    axis(svg);
    const line = svg.append("path").attr("class", "ex-line")
      .attr("d", d3.line().x((p) => x(p.y)).y((p) => y(p.v))(pts));
    drawIn(line, animate);
    svg.append("g").selectAll("circle").data(pts).join("circle").attr("class", "ex-dot")
      .attr("cx", (p) => x(p.y)).attr("cy", (p) => y(p.v)).attr("r", 2.2)
      .call((c) => animate && c.attr("r", 0).transition().delay((p, i) => 150 + i * (700 / pts.length)).duration(200).attr("r", 2.2));
    notes[0].innerHTML = `${pts.length} years of ${d.name}, ${pts[0].y}–${pts[pts.length - 1].y}. Months are averaged into one value per year${d.season}.`;
  }

  // 2. Every pair of years votes
  {
    const svg = svgIn(steps[1]);
    axis(svg);
    const pairs = [];
    let up = 0, total = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        total++;
        if (pts[j].v > pts[i].v) up++;
      }
    }
    // A readable sample of the pairs: evenly spread starting years and gaps.
    const stride = Math.max(1, Math.floor(pts.length / 9));
    for (let i = 0; i < pts.length; i += stride) {
      for (let j = i + stride; j < pts.length; j += stride) pairs.push([pts[i], pts[j]]);
    }
    svg.append("g").selectAll("line").data(pairs).join("line")
      .attr("class", (p) => (p[1].v > p[0].v ? "ex-pair up" : "ex-pair down"))
      .attr("x1", (p) => x(p[0].y)).attr("y1", (p) => y(p[0].v))
      .attr("x2", (p) => x(p[1].y)).attr("y2", (p) => y(p[1].v))
      .call((l) => fade(l, animate, 0, 250).delay?.((p, i) => i * (600 / pairs.length)));
    const xm = (pts[0].y + pts[pts.length - 1].y) / 2;
    const ym = d.fit.intercept + d.fit.slope * xm;
    const x0 = pts[0].y, x1 = pts[pts.length - 1].y;
    const sen = svg.append("line").attr("class", "ex-sen")
      .attr("x1", x(x0)).attr("y1", y(ym + d.fit.slope * (x0 - xm)))
      .attr("x2", x(x1)).attr("y2", y(ym + d.fit.slope * (x1 - xm)));
    drawIn(sen, animate, 700, 600);
    notes[1].innerHTML = `Each pair of years gives a slope. ${Math.round((up / total) * 100)}% of the ${total.toLocaleString()} pairs rise. Their median, <b>${per10(d.fit.slope)} ${d.units} per decade</b>, is Sen's slope.`;
  }

  // 3. Could it be chance?
  {
    const svg = svgIn(steps[2]);
    const z = d.fit.z;
    const lim = Math.min(9, Math.max(4, Math.abs(z) + 1));
    const xs = d3.scaleLinear().domain([-lim, lim]).range([M.left, W - M.right]);
    const ys = d3.scaleLinear().domain([0, 0.42]).range([H - M.bottom, M.top + 6]);
    const pdf = (v) => Math.exp(-v * v / 2) / Math.sqrt(2 * Math.PI);
    const grid = d3.range(-lim, lim + 0.001, lim / 80);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.bottom})`)
      .call(d3.axisBottom(xs).ticks(5).tickSizeOuter(0));
    const tail = (a, b) => d3.area().x((v) => xs(v)).y0(ys(0)).y1((v) => ys(pdf(v)))(grid.filter((v) => v >= a && v <= b));
    svg.append("path").attr("class", "ex-tail").attr("d", tail(Math.abs(z), lim)).call((p) => fade(p, animate, 500));
    svg.append("path").attr("class", "ex-tail").attr("d", tail(-lim, -Math.abs(z))).call((p) => fade(p, animate, 500));
    drawIn(svg.append("path").attr("class", "ex-curve").attr("d", d3.line().x((v) => xs(v)).y((v) => ys(pdf(v)))(grid)), animate, 0, 700);
    const marker = svg.append("g").attr("transform", `translate(${xs(Math.max(-lim, Math.min(lim, z)))},0)`);
    marker.append("line").attr("class", "ex-z").attr("y1", M.top).attr("y2", H - M.bottom);
    marker.append("text").attr("class", "ex-label").attr("y", M.top + 8).attr("x", z > 0 ? -5 : 5)
      .attr("text-anchor", z > 0 ? "end" : "start").text(`z = ${z.toFixed(1)}`);
    fade(marker, animate, 650);
    const p = d.fit.p;
    notes[2].innerHTML = `If nothing were changing, a score this far out would happen ${p < 0.001 ? "less than 1 time in 1,000" : `${(p * 100).toFixed(p < 0.01 ? 1 : 0)}% of the time`}. Year-to-year persistence makes ${pts.length} years count as about <b>${Math.round(d.fit.nEff)} independent years</b>, and the test allows for that.`;
  }

  // 4. Thousands of tests at once
  {
    const svg = svgIn(steps[3]);
    const bins = 20;
    const counts = new Array(bins).fill(0);
    let n = 0, robust = 0;
    for (const p of d.fieldP) {
      if (!(p === p)) continue;
      n++;
      if (p <= d.threshold) robust++;
      counts[Math.min(bins - 1, Math.floor(p * bins))]++;
    }
    const xs = d3.scaleLinear().domain([0, 1]).range([M.left, W - M.right]);
    const ys = d3.scaleLinear().domain([0, d3.max(counts) || 1]).range([H - M.bottom, M.top]);
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.bottom})`)
      .call(d3.axisBottom(xs).ticks(4).tickFormat((v) => `p ${v}`).tickSizeOuter(0));
    svg.append("g").selectAll("rect").data(counts).join("rect")
      .attr("class", (c, i) => (i / bins < d.threshold ? "ex-bar on" : "ex-bar"))
      .attr("x", (c, i) => xs(i / bins) + 0.5).attr("width", (W - M.left - M.right) / bins - 1)
      .attr("y", ys(0)).attr("height", 0)
      .transition().duration(animate ? 600 : 0).delay((c, i) => (animate ? i * 25 : 0))
      .attr("y", (c) => ys(c)).attr("height", (c) => ys(0) - ys(c));
    if (d.threshold > 0) {
      const tx = xs(d.threshold);
      svg.append("line").attr("class", "ex-z").attr("x1", tx).attr("x2", tx).attr("y1", M.top).attr("y2", H - M.bottom);
      svg.append("text").attr("class", "ex-label").attr("x", tx + 5).attr("y", M.top + 8).text(`cut-off ${d.threshold.toPrecision(2)}`);
    }
    notes[3].innerHTML = `The map runs ${n.toLocaleString()} tests at once, so some would pass by luck. Controlling the false discovery rate keeps <b>${robust.toLocaleString()} cells</b> as robust and limits the share of false alarms among them to about 10%.`;
  }
}
