// Detective case files: guided investigations. Each case is just a Drift
// link (variable, season, years, region), so it opens the same live analysis
// a user could build by hand. Nothing here is pre-computed.

export const CASES = [
  {
    id: "arctic", no: "01", icon: "ice",
    title: "The fastest-warming place on Earth",
    question: "Is the Arctic really warming faster than the rest of the planet?",
    look: "Compare the Arctic trend in the panel with the global +°C per decade in the headline. Then check the latitude profile under Patterns.",
    hash: "d=gistemp&s=annual&y=1981-2025&p=b-180.0,66.0,180.0,90.0",
  },
  {
    id: "siberia", no: "02", icon: "thermo",
    title: "Winter is changing faster than summer",
    question: "Does Siberia warm more in Dec–Feb than in the year as a whole?",
    look: "Read the trend for this winter view, then switch Season to Whole year and compare the two numbers.",
    hash: "d=gistemp&s=djf&y=1981-2026&p=b60.0,50.0,140.0,72.0",
  },
  {
    id: "blob", no: "03", icon: "blob",
    title: "The North Atlantic cold blob",
    question: "Why is one patch of ocean south of Greenland barely warming?",
    look: "Over 125 years most of the map runs red. Look for the pale or blue cells south of Greenland and read their verdict.",
    hash: "d=gistemp&s=annual&y=1900-2025&p=b-50.0,45.0,-20.0,62.0",
  },
  {
    id: "monsoon", no: "04", icon: "rain",
    title: "India's summer monsoon",
    question: "Has June–August rainfall over India changed since 1979?",
    look: "Check whether the trend is robust. Switch the units to % of mean to compare the change with how much rain normally falls.",
    hash: "d=gpcp&s=jja&y=1979-2025&p=b68.0,8.0,90.0,28.0",
  },
  {
    id: "sahel", no: "05", icon: "sprout",
    title: "The Sahel's rainfall recovery",
    question: "After the droughts of the 1970s and 80s, is the Sahel getting wetter?",
    look: "Find the year of the largest shift in the panel. A step change can look like a trend; the Pettitt test tells you when it happened.",
    hash: "d=gpcp&s=jja&y=1983-2025&p=b-15.0,10.0,35.0,18.0",
  },
  {
    id: "tropics", no: "06", icon: "storm",
    title: "Opposite trends, one ocean",
    question: "Can rainfall rise in one part of the Pacific while falling in another?",
    look: "Look at the map, not just the box. Under Patterns, the regions of change list wetting and drying side by side.",
    hash: "d=gpcp&s=annual&y=1979-2025&p=b120.0,-10.0,160.0,10.0",
  },
];

const ICONS = {
  ice: `<svg viewBox="0 0 64 64" class="ci ci-ice"><circle cx="32" cy="32" r="22" class="ci-ring"/><path class="ci-cap" d="M14 26c6-10 30-10 36 0-6 3-30 3-36 0z"/><path class="ci-drip" d="M27 30v6M37 30v9M32 31v4"/><path class="ci-arrow" d="M48 46V36m-4 4l4-4 4 4"/></svg>`,
  thermo: `<svg viewBox="0 0 64 64" class="ci ci-thermo"><rect x="26" y="8" width="12" height="38" rx="6" class="ci-ring"/><circle cx="32" cy="48" r="9" class="ci-bulb"/><rect x="29.5" y="20" width="5" height="28" rx="2.5" class="ci-mercury"/><path class="ci-flake" d="M50 14v12M44 20h12M46 16l8 8M54 16l-8 8"/></svg>`,
  blob: `<svg viewBox="0 0 64 64" class="ci ci-blob"><path class="ci-wave" d="M6 40c6-4 10-4 16 0s10 4 16 0 10-4 16 0 6 4 6 4"/><path class="ci-wave w2" d="M6 50c6-4 10-4 16 0s10 4 16 0 10-4 16 0 6 4 6 4"/><circle cx="32" cy="24" r="9" class="ci-cold"/><circle cx="32" cy="24" r="9" class="ci-pulse"/></svg>`,
  rain: `<svg viewBox="0 0 64 64" class="ci ci-rain"><path class="ci-cloud" d="M18 34a10 10 0 0 1 2-19.8A13 13 0 0 1 45 18a8 8 0 0 1 1 16z"/><path class="ci-drop d1" d="M22 42l-2 6"/><path class="ci-drop d2" d="M32 42l-2 6"/><path class="ci-drop d3" d="M42 42l-2 6"/></svg>`,
  sprout: `<svg viewBox="0 0 64 64" class="ci ci-sprout"><circle cx="46" cy="16" r="7" class="ci-sun"/><path class="ci-rays" d="M46 3v4M46 25v4M33 16h4M55 16h4M37 7l3 3M52 22l3 3M55 7l-3 3M40 22l-3 3"/><path class="ci-ground" d="M8 52h48"/><path class="ci-stem" d="M24 52V34"/><path class="ci-leaf l1" d="M24 40c-8 0-11-5-11-9 7 0 11 3 11 9z"/><path class="ci-leaf l2" d="M24 36c7-1 11-6 11-11-7 0-11 4-11 11z"/></svg>`,
  storm: `<svg viewBox="0 0 64 64" class="ci ci-storm"><path class="ci-cloud" d="M16 32a10 10 0 0 1 2-19.8A13 13 0 0 1 43 16a8 8 0 0 1 1 16z"/><path class="ci-bolt" d="M34 34l-6 10h6l-4 10 10-14h-6l4-6z"/><path class="ci-arrow up" d="M12 52V42m-4 4l4-4 4 4"/><path class="ci-arrow down" d="M52 40v10m-4-4l4 4 4-4"/></svg>`,
};

function renderCases() {
  const host = document.getElementById("case-grid");
  if (!host) return;
  host.innerHTML = CASES.map((c, i) => `
    <li class="case spot reveal" style="--i:${i % 3}">
      <a class="case-link" href="#${c.hash}&k=${c.id}" aria-label="Open case ${c.no}: ${c.title}">
        <div class="case-top"><span class="case-no">Case ${c.no}</span>${ICONS[c.icon]}</div>
        <h3>${c.title}</h3>
        <p class="case-q">${c.question}</p>
        <span class="case-open">Open the case <span aria-hidden="true">→</span></span>
      </a>
    </li>`).join("");
}

// A case link changes the hash; Drift applies it in place (no reload). This
// shows the case file and brings the atlas into view while it recomputes.
function caseFromHash() {
  const id = new URLSearchParams(location.hash.slice(1)).get("k");
  return CASES.find((x) => x.id === id);
}

function showCase(c) {
  document.querySelector(".case-banner")?.remove();
  const card = document.createElement("aside");
  card.className = "case-banner";
  card.setAttribute("role", "status");
  card.innerHTML = `
    <div class="case-banner-head"><span class="case-no">Case ${c.no} · open</span>
      <button type="button" class="case-close" aria-label="Close the case file">×</button></div>
    <h3>${c.title}</h3>
    <p>${c.question}</p>
    <p class="case-look"><strong>What to look for.</strong> ${c.look}</p>
    <a class="case-go" href="#atlas">See the evidence <span aria-hidden="true">↑</span></a>`;
  document.body.append(card);
  requestAnimationFrame(() => card.classList.add("in"));
  card.querySelector(".case-close").addEventListener("click", () => {
    card.classList.remove("in");
    setTimeout(() => card.remove(), 400);
  });
  card.querySelector(".case-go").addEventListener("click", (e) => {
    e.preventDefault();
    toAtlas();
  });
}

const toAtlas = () => document.getElementById("atlas").scrollIntoView({ behavior: "smooth", block: "start" });

// Clicking a case card: the hash change applies the analysis, we scroll now.
document.getElementById("case-grid")?.addEventListener("click", (e) => {
  const a = e.target.closest(".case-link");
  if (!a) return;
  const id = new URLSearchParams(a.hash.slice(1)).get("k");
  const c = CASES.find((x) => x.id === id);
  if (c) { showCase(c); toAtlas(); }
});

// Opening a shared case link: wait for the first result, then scroll.
function showActiveCase() {
  const c = caseFromHash();
  if (!c) return;
  showCase(c);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const live = document.getElementById("live-text");
  if (!live) return;
  const watch = new MutationObserver(() => {
    if (/trends computed/i.test(live.textContent)) { watch.disconnect(); setTimeout(toAtlas, 500); }
  });
  watch.observe(live, { childList: true, subtree: true, characterData: true });
}

renderCases();
showActiveCase();
