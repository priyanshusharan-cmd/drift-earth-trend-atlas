// The space around the hero globe: a starfield with depth, an atmosphere
// glow and a satellite on a tilted orbit. Two fixed canvases cover the
// viewport: `back` sits under the globe (stars, glow, far half of the orbit)
// and `front` over it (near half), so the globe itself hides the far side.
// Nothing here is data; it fades out before the atlas.

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * geom() returns the globe in viewport pixels and how far the story has run:
 * { cx, cy, r, morph (0 globe .. 1 map), u (stage progress 0..3) } or null.
 */
export function createCosmos(back, front, geom) {
  const bctx = back.getContext("2d");
  const fctx = front.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let w = 0, h = 0, dpr = 1, stars = [], meteor = null, nextMeteor = 4000;
  let pointer = [0.5, 0.5], eased = [0.5, 0.5];
  let theme = "dark", raf = 0, last = performance.now(), clock = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    for (const c of [back, front]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const n = Math.min(900, Math.round((w * h) / 2200));
    stars = Array.from({ length: n }, () => {
      const z = Math.pow(Math.random(), 1.8);          // most stars are far and faint
      return {
        x: Math.random(), y: Math.random(), z,
        r: 0.35 + z * 1.25,
        a: 0.25 + z * 0.75,
        tw: 0.4 + Math.random() * 1.8,                 // twinkle speed
        ph: Math.random() * TAU,
        tint: Math.random(),
      };
    });
    frame(true);
  }

  function setTheme(dark) { theme = dark ? "dark" : "light"; frame(true); }

  function drawStars(ctx, alpha) {
    const dark = theme === "dark";
    const sy = window.scrollY;
    const [px, py] = eased;
    for (const s of stars) {
      // Near stars drift further with scroll and pointer: depth.
      let x = s.x * w + (px - 0.5) * -18 * s.z;
      let y = (s.y * h - sy * (0.04 + s.z * 0.12) + (py - 0.5) * -12 * s.z) % h;
      if (y < 0) y += h;
      const tw = reduce.matches ? 1 : 0.65 + 0.35 * Math.sin(clock * 0.001 * s.tw + s.ph);
      const a = s.a * tw * alpha;
      if (dark) {
        const c = s.tint < 0.12 ? "255,214,170" : s.tint < 0.3 ? "180,210,255" : "235,242,255";
        ctx.fillStyle = `rgba(${c},${a})`;
      } else {
        ctx.fillStyle = `rgba(15,34,48,${a * 0.28})`;
      }
      if (s.r < 0.9) ctx.fillRect(x, y, s.r * 1.6, s.r * 1.6);
      else {
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, TAU); ctx.fill();
        if (dark && s.z > 0.85) {
          // The brightest few get a soft cross-shaped glint.
          ctx.fillStyle = `rgba(235,242,255,${a * 0.25})`;
          ctx.fillRect(x - s.r * 3, y - 0.3, s.r * 6, 0.6);
          ctx.fillRect(x - 0.3, y - s.r * 3, 0.6, s.r * 6);
        }
      }
    }
  }

  function drawMeteor(ctx, dt, alpha) {
    if (reduce.matches || theme !== "dark") return;
    nextMeteor -= dt;
    if (!meteor && nextMeteor <= 0) {
      const ang = (Math.PI / 180) * (20 + Math.random() * 25);
      meteor = { x: Math.random() * w * 0.7, y: Math.random() * h * 0.35, vx: Math.cos(ang), vy: Math.sin(ang), life: 0, dur: 900 + Math.random() * 500, len: 120 + Math.random() * 120 };
      nextMeteor = 5000 + Math.random() * 7000;
    }
    if (!meteor) return;
    meteor.life += dt;
    const k = meteor.life / meteor.dur;
    if (k >= 1) { meteor = null; return; }
    const speed = 0.9;
    const hx = meteor.x + meteor.vx * meteor.life * speed, hy = meteor.y + meteor.vy * meteor.life * speed;
    const tail = meteor.len * Math.sin(Math.PI * k);
    const g = ctx.createLinearGradient(hx, hy, hx - meteor.vx * tail, hy - meteor.vy * tail);
    g.addColorStop(0, `rgba(255,255,255,${0.85 * alpha})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - meteor.vx * tail, hy - meteor.vy * tail); ctx.stroke();
  }

  function drawGlow(ctx, g, alpha) {
    if (alpha <= 0) return;
    const { cx, cy, r } = g;
    const dark = theme === "dark";
    // Atmosphere: a thin bright rim falling off into a wide haze.
    const halo = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.42);
    halo.addColorStop(0, dark ? `rgba(130,190,255,${0.55 * alpha})` : `rgba(70,140,220,${0.35 * alpha})`);
    halo.addColorStop(0.12, dark ? `rgba(90,160,255,${0.22 * alpha})` : `rgba(70,140,220,${0.14 * alpha})`);
    halo.addColorStop(0.45, dark ? `rgba(60,120,220,${0.07 * alpha})` : `rgba(70,140,220,${0.04 * alpha})`);
    halo.addColorStop(1, "rgba(60,120,220,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.42, 0, TAU); ctx.fill();
  }

  // The orbit is an ellipse tilted in screen space. Points with sin(θ) > 0
  // are on the near side and drawn in front of the globe.
  const TILT = (-16 * Math.PI) / 180;
  function orbitPoint(g, th) {
    const rx = g.r * 1.32, ry = g.r * 0.26;
    const x = rx * Math.cos(th), y = ry * Math.sin(th);
    return [g.cx + x * Math.cos(TILT) - y * Math.sin(TILT), g.cy + x * Math.sin(TILT) + y * Math.cos(TILT)];
  }

  function drawOrbit(ctx, g, alpha, near) {
    if (alpha <= 0) return;
    const dark = theme === "dark";
    const ink = dark ? "200,225,255" : "15,34,48";
    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${ink},${(dark ? 0.35 : 0.28) * alpha})`;
    ctx.beginPath();
    const a0 = near ? 0 : Math.PI, steps = 90;
    for (let i = 0; i <= steps; i++) {
      const [x, y] = orbitPoint(g, a0 + (Math.PI * i) / steps);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // The satellite: one lap every 14 s.
    const th = ((clock / 14000) * TAU) % TAU;
    if ((Math.sin(th) > 0) !== near) return;
    const [sx, sy] = orbitPoint(g, th);
    const [nx, ny] = orbitPoint(g, th + 0.01);
    const ang = Math.atan2(ny - sy, nx - sx);
    // A short trail behind it.
    for (let i = 1; i <= 14; i++) {
      const p = orbitPoint(g, th - i * 0.022);
      if ((Math.sin(th - i * 0.022) > 0) !== near) break;
      ctx.fillStyle = `rgba(${dark ? "150,205,255" : "33,102,172"},${(0.5 - i * 0.033) * alpha})`;
      ctx.beginPath(); ctx.arc(p[0], p[1], 1.6 - i * 0.08, 0, TAU); ctx.fill();
    }
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(ang);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = dark ? "#9fd0ff" : "#2166ac";
    ctx.fillRect(-9, -2, 6, 4); ctx.fillRect(3, -2, 6, 4);      // solar panels
    ctx.fillStyle = dark ? "#ffffff" : "#0f2230";
    ctx.fillRect(-2.5, -2.5, 5, 5);                              // body
    ctx.restore();
    // Blinking beacon.
    if (Math.sin(clock * 0.006) > 0.6) {
      ctx.fillStyle = `rgba(255,120,90,${alpha})`;
      ctx.beginPath(); ctx.arc(sx, sy, 1.4, 0, TAU); ctx.fill();
    }
  }

  function frame(force = false) {
    const now = performance.now();
    const dt = Math.min(64, now - last);
    last = now;
    clock += dt;
    eased = eased.map((v, i) => v + (pointer[i] - v) * (1 - Math.exp(-dt / 400)));

    const g = geom();
    const u = g?.u ?? Math.min(3, window.scrollY / Math.max(1, h));
    const space = 1 - smooth(2.15, 2.85, u);                    // gone once the map lands
    const orbit = g ? (1 - smooth(0.02, 0.45, u)) : 0;          // the orbit belongs to the hero
    const glow = g ? (1 - smooth(0, 0.25, g.morph)) : 0;

    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h);
    fctx.clearRect(0, 0, w, h);
    if (space > 0) {
      drawStars(bctx, space);
      drawMeteor(bctx, dt, space);
      if (g && g.r > 0) {
        drawGlow(bctx, g, glow);
        if (!reduce.matches) {
          drawOrbit(bctx, g, orbit, false);
          drawOrbit(fctx, g, orbit, true);
        }
      }
    }
    back.hidden = front.hidden = space <= 0;
    if (force) return;
    // Past the hero there is nothing to draw; scrolling back up restarts it.
    raf = space > 0 && !document.hidden && !reduce.matches ? requestAnimationFrame(() => frame()) : 0;
  }

  function start() { if (!raf && !reduce.matches) { last = performance.now(); raf = requestAnimationFrame(() => frame()); } }

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", (e) => { pointer = [e.clientX / w, e.clientY / h]; }, { passive: true });
  // With motion reduced the sky is still, so it only needs drawing on scroll.
  window.addEventListener("scroll", () => (reduce.matches ? frame(true) : start()), { passive: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
  reduce.addEventListener("change", () => (reduce.matches ? frame(true) : start()));
  resize();
  start();
  return { setTheme, redraw: () => frame(true) };
}
