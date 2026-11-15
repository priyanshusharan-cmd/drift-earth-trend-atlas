// Shared behaviour for Drift's content pages: theme, reveals, starfield,
// count-up numbers and the reading progress bar.
import { createCosmos } from "./cosmos.js";

const root = document.documentElement;
const dark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
try { const t = localStorage.getItem("drift-theme"); if (t) root.dataset.theme = t; } catch { /* storage unavailable */ }

let cosmos = null;
const front = document.getElementById("cosmos-front");
try {
  cosmos = createCosmos(document.getElementById("cosmos"), front, () => ({ u: 0, r: 0, morph: 1 }));
  cosmos?.setTheme(dark());
} catch { /* decorative only */ }

document.querySelector(".theme-toggle")?.addEventListener("click", () => {
  root.dataset.theme = dark() ? "light" : "dark";
  try { localStorage.setItem("drift-theme", root.dataset.theme); } catch { /* ignore */ }
  cosmos?.setTheme(dark());
});

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

function countUp(el) {
  const target = parseFloat(el.dataset.count);
  const dec = (el.dataset.count.split(".")[1] || "").length;
  const fmt = (v) => v.toLocaleString("en", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  if (reduce) { el.textContent = fmt(target); return; }
  const t0 = performance.now(), dur = 1400;
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(target * e);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add("in");
    e.target.querySelectorAll("[data-count]").forEach(countUp);
    io.unobserve(e.target);
  }
}, { threshold: 0.15 });
document.querySelectorAll(".reveal, .stats").forEach((el) => io.observe(el));

const bar = document.getElementById("progress");
if (bar) {
  const upd = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? scrollY / h : 0})`;
  };
  addEventListener("scroll", upd, { passive: true });
  upd();
}
