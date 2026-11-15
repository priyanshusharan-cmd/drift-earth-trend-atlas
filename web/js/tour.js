// Guided tour: a spotlight that walks a first-time visitor through Drift.

const STEPS = [
  { sel: "#controls", title: "Ask a question", text: "Choose a NASA variable, a season and any window of years. Every change recomputes about 16,000 trends in your browser." },
  { sel: "#answer", title: "Read the answer", text: "This sentence is written from the live result: the global trend, how much of Earth changed robustly, and where change is strongest." },
  { sel: "#globe-slot", title: "Spin the planet", text: "The globe is painted with the result. Drag to spin it, or click any place to read its trend." },
  { sel: ".map-figure", title: "The atlas", text: "Each cell shows Sen's slope per decade. Cells without a statistically robust trend fade, so the real signal stands out. Drag a box to outline a region." },
  { sel: "#place", title: "Inspect a place", text: "The time series, the fitted trend with its 95% band, the year of the largest shift, and the full statistics. Download any series as CSV." },
  { sel: ".timeline-wrap", title: "Choose the period", text: "Drag the window over the global record to pick the years you want to test." },
  { sel: "#cases", title: "Open a case file", text: "Six guided investigations, from Arctic warming to India's monsoon. Each one opens the live analysis with a question to answer." },
  { sel: "#stripes", title: "One stripe per year", text: "The whole record at a glance, coloured by how far each year sat from the window's average." },
  { sel: "#patterns", title: "Opposite trends", text: "A variable can rise in one region and fall in another. The latitude profile and the regions list show both directions." },
  { sel: "#explain", title: "See the method", text: "Four steps show how Drift decides whether a change is real, using the place you selected. The Field Guide explains every term." },
];

let i = 0, root, hole, card;

function place() {
  const el = document.querySelector(STEPS[i].sel);
  if (!el) return next();
  const r = el.getBoundingClientRect();
  const pad = 10;
  Object.assign(hole.style, {
    left: `${r.left - pad}px`, top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`, height: `${Math.min(r.height + pad * 2, innerHeight - 20)}px`,
  });
  const below = r.bottom + 220 < innerHeight;
  const top = below ? r.bottom + 18 : Math.max(16, r.top - 18 - card.offsetHeight);
  const left = Math.min(Math.max(16, r.left), innerWidth - card.offsetWidth - 16);
  Object.assign(card.style, { top: `${Math.max(16, Math.min(top, innerHeight - card.offsetHeight - 16))}px`, left: `${left}px` });
}

function show() {
  const s = STEPS[i];
  card.querySelector(".tour-count").textContent = `${i + 1} / ${STEPS.length}`;
  card.querySelector("h3").textContent = s.title;
  card.querySelector("p").textContent = s.text;
  card.querySelector(".tour-back").disabled = i === 0;
  card.querySelector(".tour-next").textContent = i === STEPS.length - 1 ? "Finish" : "Next";
  card.querySelector(".tour-dots").innerHTML = STEPS.map((_, k) => `<span class="${k === i ? "on" : ""}"></span>`).join("");
  const el = document.querySelector(s.sel);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  root.classList.remove("settled");
  clearTimeout(show.t);
  show.t = setTimeout(() => { place(); root.classList.add("settled"); }, 650);
}

function next() { if (i < STEPS.length - 1) { i++; show(); } else end(); }
function back() { if (i > 0) { i--; show(); } }

function end() {
  root?.classList.remove("on");
  removeEventListener("resize", place);
  removeEventListener("scroll", place);
  removeEventListener("keydown", keys);
  setTimeout(() => root?.remove(), 300);
  root = null;
}

function keys(e) {
  if (e.key === "Escape") end();
  if (e.key === "ArrowRight") next();
  if (e.key === "ArrowLeft") back();
}

export function startTour() {
  if (root) return;
  i = 0;
  root = document.createElement("div");
  root.className = "tour";
  root.innerHTML = `
    <div class="tour-hole"></div>
    <div class="tour-card" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div class="tour-head"><span class="tour-count"></span><button type="button" class="tour-x" aria-label="End the tour">×</button></div>
      <h3></h3><p></p>
      <div class="tour-foot"><span class="tour-dots" aria-hidden="true"></span>
        <button type="button" class="tour-back">Back</button><button type="button" class="tour-next">Next</button></div>
    </div>`;
  document.body.append(root);
  hole = root.querySelector(".tour-hole");
  card = root.querySelector(".tour-card");
  root.querySelector(".tour-next").addEventListener("click", next);
  root.querySelector(".tour-back").addEventListener("click", back);
  root.querySelector(".tour-x").addEventListener("click", end);
  addEventListener("resize", place);
  addEventListener("scroll", place, { passive: true });
  addEventListener("keydown", keys);
  requestAnimationFrame(() => root.classList.add("on"));
  show();
  card.querySelector(".tour-next").focus();
}

document.querySelectorAll("[data-tour]").forEach((b) => b.addEventListener("click", startTour));
if (new URLSearchParams(location.search).has("tour")) setTimeout(startTour, 2500);
