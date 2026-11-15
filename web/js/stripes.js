// The full record as one stripe per year, and a ticker of the strongest
// regions. Both are drawn from the current result.

import { fmt } from "./chart.js";

/**
 * d: { years, values, mean, color(v - mean) → css, start, end, units, digits }
 * Stripes outside the analysis window are dimmed; the window gets brackets.
 */
export function renderStripes(el, readout, d, { animate = false } = {}) {
  const n = d.years.length;
  const frag = document.createDocumentFragment();
  d.years.forEach((year, i) => {
    const v = d.values[i];
    const s = document.createElement("span");
    s.className = "stripe";
    s.style.setProperty("--i", i);
    s.style.background = v === v ? d.color(v - d.mean) : "transparent";
    if (year < d.start || year > d.end) s.classList.add("out");
    s.dataset.i = i;
    frag.append(s);
  });
  const win = document.createElement("span");
  win.className = "stripes-window";
  win.style.left = `${((d.start - d.years[0]) / n) * 100}%`;
  win.style.width = `${((d.end - d.start + 1) / n) * 100}%`;
  win.innerHTML = `<i>${d.start}</i><i>${d.end}</i>`;
  frag.append(win);
  el.replaceChildren(frag);
  el.style.setProperty("--n", n);
  el.classList.toggle("sweep", animate);
  if (animate) {
    // Restart the sweep: drop the class, force a style pass, add it back.
    el.classList.remove("sweeping");
    void el.offsetWidth;
    el.classList.add("sweeping");
  }

  const idle = `Hover a stripe to read its year. Window ${d.start}–${d.end} outlined; colours show departure from its mean.`;
  readout.textContent = idle;
  const show = (i) => {
    const v = d.values[i];
    readout.innerHTML = v === v
      ? `<b>${d.years[i]}</b> ${fmt(v - d.mean, d.digits)} ${d.units} against the ${d.start}–${d.end} mean`
      : `<b>${d.years[i]}</b> not enough of the globe had data`;
  };
  el.onpointermove = (e) => {
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
    if (el.dataset.hover !== String(i)) {
      el.querySelector(".stripe.on")?.classList.remove("on");
      el.children[i].classList.add("on");
      el.dataset.hover = i;
      show(i);
    }
  };
  el.onpointerleave = () => {
    el.querySelector(".stripe.on")?.classList.remove("on");
    delete el.dataset.hover;
    readout.textContent = idle;
  };
}

/** items: [{ label, value, color }] — rendered twice so the loop is seamless. */
export function renderTicker(track, items) {
  const html = items.map((it) =>
    `<span class="tick"><i style="background:${it.color}"></i>${it.label} <b>${it.value}</b></span>`).join("");
  track.innerHTML = `<span class="tick-run">${html}</span><span class="tick-run" aria-hidden="true">${html}</span>`;
  // Same reading speed whatever the content length.
  const width = track.firstElementChild.scrollWidth;
  track.style.setProperty("--dur", `${Math.max(20, width / 60)}s`);
}
