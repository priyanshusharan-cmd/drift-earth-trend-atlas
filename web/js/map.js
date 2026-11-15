// Map renderer. Grid cells are drawn with WebGL so the globe can spin and
// unfold at full frame rate; coastlines, outlines and selections are drawn
// with d3 on a 2D canvas laid over it. Both use the same projection maths.
//
// The unfold is not a blended projection (that folds the far hemisphere over
// the near one). Each point moves in screen space from its globe position to
// its Equal Earth position; points on the far side start on the globe's limb
// and fade in, so the back of the planet peels outward as the map opens.

const d3 = globalThis.d3;
const sphere = { type: "Sphere" };
const graticule = d3.geoGraticule10();
const RAD = Math.PI / 180;

function rectRing(x0, y0, x1, y1, step = 2) {
  // Clockwise (SW → NW → NE → SE) as d3-geo expects for exteriors. Parallels
  // are densified because d3 joins vertices along great circles.
  const ring = [[x0, y0], [x0, y1]];
  for (let x = x0 + step; x < x1; x += step) ring.push([x, y1]);
  ring.push([x1, y1], [x1, y0]);
  for (let x = x1 - step; x > x0; x -= step) ring.push([x, y0]);
  ring.push([x0, y0]);
  return ring;
}

export function boxPolygon([x0, y0, x1, y1]) {
  return { type: "Polygon", coordinates: [rectRing(x0, y0, x1, y1)] };
}

// Equal Earth (Šavrič, Patterson & Jenny 2018), identical to d3.geoEqualEarthRaw.
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
function equalEarth(lambda, phi) {
  const l = Math.asin(M * Math.sin(phi)), l2 = l * l, l6 = l2 * l2 * l2;
  return [
    (lambda * Math.cos(l)) / (M * (A1 + 3 * A2 * l2 + l6 * (7 * A3 + 9 * A4 * l2))),
    l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)),
  ];
}

/** Screen position of a rotated point (radians) at unfold t, in CSS pixels. */
function morphPoint(lambda, phi, t, globe, flat) {
  const cp = Math.cos(phi);
  const cosc = cp * Math.cos(lambda);
  const f = equalEarth(lambda, phi);
  let ox = cp * Math.sin(lambda), oy = Math.sin(phi);
  if (cosc < 0) {
    // Far side: pin to the limb, in the direction the point will travel.
    const on = Math.hypot(ox, oy), fn = Math.hypot(f[0], f[1]) || 1;
    const w = Math.min(1, Math.max(0, (on - 0.05) / 0.25));
    const dx = (ox / (on || 1)) * w + (f[0] / fn) * (1 - w);
    const dy = (oy / (on || 1)) * w + (f[1] / fn) * (1 - w);
    const dn = Math.hypot(dx, dy) || 1;
    ox = dx / dn; oy = dy / dn;
  }
  const gx = globe[0] + globe[2] * ox, gy = globe[1] - globe[2] * oy;
  const fx = flat[0] + flat[2] * f[0], fy = flat[1] - flat[2] * f[1];
  return [gx + (fx - gx) * t, gy + (fy - gy) * t];
}

const VERT = `
precision highp float;
attribute vec2 a_ll;
attribute vec2 a_center;
attribute vec3 a_colA;
attribute vec3 a_colB;
uniform vec2 u_rot;
uniform float u_t;
uniform vec3 u_globe;
uniform vec3 u_flat;
uniform vec2 u_size;
uniform float u_mix;
varying vec3 v_col;
varying float v_cos;
const float PI = 3.141592653589793;
const float A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = 0.8660254037844386;

vec2 rotate(vec2 ll) {
  float lam = mod(ll.x + u_rot.x + PI, 2.0 * PI) - PI;
  float cp = cos(ll.y);
  float x = cos(lam) * cp, y = sin(lam) * cp, z = sin(ll.y);
  float cd = cos(u_rot.y), sd = sin(u_rot.y);
  float k = z * cd + x * sd;
  return vec2(atan(y, x * cd - z * sd), asin(clamp(k, -1.0, 1.0)));
}
vec2 equalEarth(vec2 r) {
  float l = asin(M * sin(r.y)), l2 = l * l, l6 = l2 * l2 * l2;
  return vec2(r.x * cos(l) / (M * (A1 + 3.0 * A2 * l2 + l6 * (7.0 * A3 + 9.0 * A4 * l2))),
              l * (A1 + A2 * l2 + l6 * (A3 + A4 * l2)));
}
void main() {
  vec2 r = rotate(radians(a_ll));
  vec2 rc = rotate(radians(a_center));
  // Keep a cell in one piece where it straddles the rotated antimeridian.
  if (r.x - rc.x > PI) r.x -= 2.0 * PI;
  else if (rc.x - r.x > PI) r.x += 2.0 * PI;
  float cp = cos(r.y);
  float cosc = cp * cos(r.x);
  vec2 f = equalEarth(r);
  vec2 o = vec2(cp * sin(r.x), sin(r.y));
  if (cosc < 0.0) {
    float on = length(o);
    float w = clamp((on - 0.05) / 0.25, 0.0, 1.0);
    o = normalize(o / max(on, 1e-6) * w + f / max(length(f), 1e-6) * (1.0 - w));
  }
  vec2 g = vec2(u_globe.x + u_globe.z * o.x, u_globe.y - u_globe.z * o.y);
  vec2 p = vec2(u_flat.x + u_flat.z * f.x, u_flat.y - u_flat.z * f.y);
  vec2 px = mix(g, p, u_t);
  gl_Position = vec4(px.x / u_size.x * 2.0 - 1.0, 1.0 - px.y / u_size.y * 2.0, 0.0, 1.0);
  v_cos = cosc;
  v_col = mix(a_colA, a_colB, u_mix);
}`;

const FRAG = `
precision mediump float;
varying vec3 v_col;
varying float v_cos;
uniform float u_pass;
uniform float u_backAlpha;
void main() {
  if (u_pass < 0.5) {
    if (v_cos >= 0.0) discard;
    gl_FragColor = vec4(v_col, u_backAlpha);
  } else {
    if (v_cos < 0.0) discard;
    gl_FragColor = vec4(v_col, 1.0);
  }
}`;

function parseColor(css) {
  if (!css) return null;
  if (css[0] === "#") {
    const n = parseInt(css.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = css.match(/[\d.]+/g);
  return m ? [+m[0], +m[1], +m[2]] : null;
}

function createGL(canvas) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: false, antialias: true, alpha: true });
  if (!gl) return null;
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const loc = (n) => gl.getUniformLocation(prog, n);
  return {
    gl, prog,
    u: Object.fromEntries(["u_rot", "u_t", "u_globe", "u_flat", "u_size", "u_mix", "u_pass", "u_backAlpha"].map((n) => [n, loc(n)])),
    a: Object.fromEntries(["a_ll", "a_center", "a_colA", "a_colB"].map((n) => [n, gl.getAttribLocation(prog, n)])),
    geo: gl.createBuffer(), colA: gl.createBuffer(), colB: gl.createBuffer(), count: 0,
  };
}

export function createMap(canvas, { mode = "flat", interactive = true } = {}) {
  // The cells canvas is `canvas`; the overlay sits exactly on top of it.
  const overlay = document.createElement("canvas");
  overlay.className = "map-overlay";
  overlay.setAttribute("aria-hidden", "true");
  canvas.after(overlay);
  const ctx = overlay.getContext("2d");
  let glr = null;
  try { glr = createGL(canvas); } catch (error) { console.warn("WebGL unavailable, drawing with canvas 2D", error); }
  const ctx2d = glr ? null : canvas.getContext("2d");

  const state = {
    mode, width: 0, height: 0, dpr: 1,
    projection: null, path: null,
    rings: null, land: null, borders: null,
    selection: null, hover: null, draft: null,
    rotation: mode === "flat" ? [0, 0, 0] : [-20, -15, 0],
    morph: mode === "flat" ? 1 : 0,  // 0 = globe, 1 = flat map
    extent: null,                     // optional (t) => [[x0, y0], [x1, y1]]
    globeFit: [0, 0, 1], flatFit: [0, 0, 1],
    colors: null, rgb: null, mix: 1, fade: null,
    theme: {},
    handlers: {},
  };

  function fits() {
    const { width: w, height: h } = state;
    const pad = 6;
    const box = (t) => (state.extent ? state.extent(t) : [[pad, pad], [w - pad, h - pad]]);
    const [[gx0, gy0], [gx1, gy1]] = box(0);
    state.globeFit = [(gx0 + gx1) / 2, (gy0 + gy1) / 2, Math.min(gx1 - gx0, gy1 - gy0) / 2];
    const ee = d3.geoEqualEarth().fitExtent(box(1), sphere);
    state.flatFit = [...ee.translate(), ee.scale()];
  }

  function setProjection() {
    if (!state.width || !state.height) return;
    const t = state.mode === "flat" ? 1 : state.morph;
    const [gx, gy, gr] = state.globeFit;
    const [fx, fy, fs] = state.flatFit;
    if (t <= 0) {
      state.projection = d3.geoOrthographic().rotate(state.rotation).clipAngle(90).scale(gr).translate([gx, gy]).precision(0.5);
    } else if (t >= 1) {
      state.projection = d3.geoEqualEarth().rotate(state.rotation).scale(fs).translate([fx, fy]).precision(0.4);
    } else {
      const raw = (l, p) => {
        const [x, y] = morphPoint(l, p, t, state.globeFit, state.flatFit);
        return [x, -y];
      };
      // d3 places raw(0, 0) at the translate point, so translate to it to keep raw pixels as they are.
      const origin = morphPoint(0, 0, t, state.globeFit, state.flatFit);
      state.projection = d3.geoProjection(raw).rotate(state.rotation).scale(1).translate(origin).precision(0.5);
    }
    state.path = d3.geoPath(state.projection, ctx);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = rect.width;
    state.height = rect.height;
    for (const c of [canvas, overlay]) {
      c.width = Math.round(rect.width * state.dpr);
      c.height = Math.round(rect.height * state.dpr);
    }
    // The overlay copies the canvas box, whether it is in the flow or fixed.
    const cs = getComputedStyle(canvas);
    const fixed = cs.position === "fixed";
    Object.assign(overlay.style, {
      position: fixed ? "fixed" : "absolute", pointerEvents: "none", zIndex: cs.zIndex,
      left: `${fixed ? rect.left : canvas.offsetLeft}px`, top: `${fixed ? rect.top : canvas.offsetTop}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
    fits();
    setProjection();
    draw();
  }

  function setGrid(meta, g) {
    state.rings = Array.from({ length: g.size }, (_, c) => {
      const [x0, y0, x1, y1] = g.bounds(c);
      return rectRing(x0, Math.max(-90, y0), x1, Math.min(90, y1), g.dLon);
    });
    if (!glr) return;
    const { gl } = glr;
    // Two triangles per cell; every vertex also carries its cell centre.
    const data = new Float32Array(g.size * 6 * 4);
    let k = 0;
    for (let c = 0; c < g.size; c++) {
      const [x0, y0r, x1, y1r] = g.bounds(c);
      // At exactly ±90° a vertex has no longitude, and the shader would place
      // it anywhere along the pole line; stop just short of the pole.
      const y0 = Math.max(-89.9, y0r), y1 = Math.min(89.9, y1r);
      const [cx, cy] = g.center(c);
      for (const [x, y] of [[x0, y0], [x0, y1], [x1, y1], [x0, y0], [x1, y1], [x1, y0]]) {
        data[k++] = x; data[k++] = y; data[k++] = cx; data[k++] = cy;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, glr.geo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    glr.count = g.size * 6;
    state.rgb = null;
  }

  function colorBuffer(colors) {
    const nodata = parseColor(state.theme.nodata) || [200, 200, 200];
    const out = new Uint8Array(colors.length * 6 * 3);
    let k = 0;
    for (const css of colors) {
      const rgb = parseColor(css) || nodata;
      for (let v = 0; v < 6; v++) { out[k++] = rgb[0]; out[k++] = rgb[1]; out[k++] = rgb[2]; }
    }
    return out;
  }

  /**
   * colors: CSS colour per cell (null = no data). With fade, the old colours
   * dissolve into the new ones.
   */
  function setColors(colors, { fade = false } = {}) {
    state.colors = colors;
    if (!glr) { draw(); return; }
    const { gl } = glr;
    const next = colorBuffer(colors);
    const animate = fade && state.rgb && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate) {
      gl.bindBuffer(gl.ARRAY_BUFFER, glr.colA);
      gl.bufferData(gl.ARRAY_BUFFER, state.rgb, gl.DYNAMIC_DRAW);
      state.fade = { start: performance.now(), duration: 520 };
      state.mix = 0;
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, glr.colA);
      gl.bufferData(gl.ARRAY_BUFFER, next, gl.DYNAMIC_DRAW);
      state.fade = null;
      state.mix = 1;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, glr.colB);
    gl.bufferData(gl.ARRAY_BUFFER, next, gl.DYNAMIC_DRAW);
    state.rgb = next;
    if (animate) tickFade(); else draw();
  }

  function tickFade() {
    if (!state.fade) return;
    const k = Math.min(1, (performance.now() - state.fade.start) / state.fade.duration);
    state.mix = d3.easeCubicInOut(k);
    draw();
    if (k < 1) requestAnimationFrame(tickFade);
    else state.fade = null;
  }

  function drawCellsGL(t) {
    const { gl, u, a } = glr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!glr.count || !state.rgb) return;
    gl.useProgram(glr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, glr.geo);
    gl.enableVertexAttribArray(a.a_ll);
    gl.vertexAttribPointer(a.a_ll, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(a.a_center);
    gl.vertexAttribPointer(a.a_center, 2, gl.FLOAT, false, 16, 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, glr.colA);
    gl.enableVertexAttribArray(a.a_colA);
    gl.vertexAttribPointer(a.a_colA, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, glr.colB);
    gl.enableVertexAttribArray(a.a_colB);
    gl.vertexAttribPointer(a.a_colB, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.uniform2f(u.u_rot, state.rotation[0] * RAD, state.rotation[1] * RAD);
    gl.uniform1f(u.u_t, t);
    gl.uniform3fv(u.u_globe, state.globeFit);
    gl.uniform3fv(u.u_flat, state.flatFit);
    gl.uniform2f(u.u_size, state.width, state.height);
    gl.uniform1f(u.u_mix, state.mix);
    // Far side first, fading in as the globe opens; then the near side.
    const back = t >= 1 ? 1 : Math.min(1, Math.max(0, t / 0.35));
    if (back > 0) {
      gl.uniform1f(u.u_pass, 0);
      gl.uniform1f(u.u_backAlpha, back);
      gl.drawArrays(gl.TRIANGLES, 0, glr.count);
    }
    gl.uniform1f(u.u_pass, 1);
    gl.drawArrays(gl.TRIANGLES, 0, glr.count);
  }

  function drawCells2D() {
    // Fallback without WebGL: the same cells as vector paths (slower).
    const c = ctx2d;
    c.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    c.clearRect(0, 0, state.width, state.height);
    if (!state.colors) return;
    const path = d3.geoPath(state.projection, c);
    const buckets = new Map();
    state.colors.forEach((col, i) => {
      const key = col || state.theme.nodata;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push([state.rings[i]]);
    });
    for (const [color, polys] of buckets) {
      c.beginPath(); path({ type: "MultiPolygon", coordinates: polys });
      c.fillStyle = color; c.fill();
    }
  }

  function draw() {
    if (!state.path) return;
    const t = state.mode === "flat" ? 1 : state.morph;
    if (glr) drawCellsGL(t); else drawCells2D();

    const th = state.theme;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);

    // Mid-unfold the graticule's long parallels cut across the seam; leave it out.
    if (t <= 0 || t >= 1) {
      ctx.beginPath(); state.path(graticule);
      ctx.strokeStyle = th.graticule; ctx.lineWidth = 0.5; ctx.stroke();
    }
    if (state.borders && t >= 1) {
      ctx.beginPath(); state.path(state.borders);
      ctx.strokeStyle = th.border; ctx.lineWidth = 0.4; ctx.stroke();
    }
    if (state.land) {
      ctx.beginPath(); state.path(state.land);
      ctx.strokeStyle = th.coast; ctx.lineWidth = 0.9; ctx.stroke();
    }
    if (t < 0.25) {
      // A soft limb so the sphere reads as a solid body; it fades as it opens.
      const [cx, cy, r] = state.globeFit;
      const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
      shade.addColorStop(0, "rgba(255,255,255,0.12)");
      shade.addColorStop(0.7, "rgba(255,255,255,0)");
      shade.addColorStop(1, "rgba(0,0,0,0.3)");
      ctx.globalAlpha = 1 - t / 0.25;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fillStyle = shade; ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (t <= 0 || t >= 1) {
      ctx.beginPath(); state.path(sphere);
      ctx.strokeStyle = th.outline; ctx.lineWidth = 1; ctx.stroke();
    }

    const outline = (geom, color, width, dash) => {
      ctx.beginPath(); state.path(geom);
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
      ctx.setLineDash([]);
    };
    if (state.hover) outline(state.hover, th.hover, 1.2);
    if (state.selection) {
      outline(state.selection, th.halo, 4.5);
      outline(state.selection, th.select, 2);
    }
    if (state.draft) outline(state.draft, th.select, 1.5, [5, 4]);
  }

  // Interaction ------------------------------------------------------------
  let drag = null;
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const invert = (pt) => {
    const t = state.mode === "flat" ? 1 : state.morph;
    if (t > 0 && t < 1) return null;
    const ll = state.projection?.invert(pt);
    if (!ll || !Number.isFinite(ll[0])) return null;
    if (t === 0) {
      // Orthographic invert also answers for the far side; reject it.
      if (d3.geoDistance(ll, [-state.rotation[0], -state.rotation[1]]) > Math.PI / 2) return null;
    } else {
      const back = state.projection(ll);
      if (!back || Math.hypot(back[0] - pt[0], back[1] - pt[1]) > 1) return null;
    }
    return ll;
  };
  const spinnable = () => state.mode === "globe" && state.morph === 0;

  if (interactive) {
    canvas.addEventListener("pointerdown", (e) => {
      const pt = local(e);
      stopInertia();
      drag = { start: pt, last: pt, geo: invert(pt), moved: false, rotation: state.rotation.slice(), vx: 0, vy: 0, time: performance.now() };
      if (spinnable() || state.mode === "flat") canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      const pt = local(e);
      if (!drag) {
        state.handlers.hover?.(invert(pt), pt);
        return;
      }
      const dx = pt[0] - drag.start[0], dy = pt[1] - drag.start[1];
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      if (spinnable()) {
        const k = 75 / state.globeFit[2];
        const now = performance.now(), dt = Math.max(1, now - drag.time);
        // Smoothed angular velocity in degrees per millisecond.
        drag.vx = 0.7 * (((pt[0] - drag.last[0]) * k) / dt) + 0.3 * drag.vx;
        drag.vy = 0.7 * ((-(pt[1] - drag.last[1]) * k) / dt) + 0.3 * drag.vy;
        drag.last = pt; drag.time = now;
        setRotation([drag.rotation[0] + dx * k, Math.max(-80, Math.min(80, drag.rotation[1] - dy * k)), 0]);
        state.handlers.rotate?.();
      } else if (state.mode === "flat" && drag.geo) {
        const end = invert(pt);
        if (end) {
          drag.box = [Math.min(drag.geo[0], end[0]), Math.min(drag.geo[1], end[1]), Math.max(drag.geo[0], end[0]), Math.max(drag.geo[1], end[1])];
          state.draft = boxPolygon(drag.box);
          draw();
        }
      }
    });
    const finish = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) {
        const ll = invert(local(e));
        if (ll) state.handlers.select?.(ll);
      } else if (spinnable() && performance.now() - d.time < 80) {
        startInertia(d.vx, d.vy);
      } else if (d.box) {
        state.draft = null;
        const [x0, y0, x1, y1] = d.box;
        if (x1 - x0 >= 1 && y1 - y0 >= 1) state.handlers.region?.(d.box);
        draw();
      }
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", () => { drag = null; state.draft = null; draw(); });
    canvas.addEventListener("pointerleave", () => { if (!drag) state.handlers.hover?.(null); });
  }

  function setRotation(rotation) {
    state.rotation = rotation;
    state.projection?.rotate(rotation);
    draw();
  }

  // After a flick the globe keeps turning and slows down.
  let inertia = null;
  function startInertia(vx, vy) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || Math.hypot(vx, vy) < 0.01) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(48, now - last);
      last = now;
      const decay = Math.pow(0.996, dt);
      vx *= decay; vy *= decay;
      setRotation([state.rotation[0] + vx * dt, Math.max(-80, Math.min(80, state.rotation[1] + vy * dt)), 0]);
      state.handlers.rotate?.();
      inertia = Math.hypot(vx, vy) > 0.002 && spinnable() ? requestAnimationFrame(step) : null;
    };
    inertia = requestAnimationFrame(step);
  }
  function stopInertia() { if (inertia) cancelAnimationFrame(inertia); inertia = null; }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  if (canvas.parentElement) observer.observe(canvas.parentElement);

  return {
    state,
    draw,
    resize,
    setGrid,
    setColors,
    on(name, fn) { state.handlers[name] = fn; return this; },
    setTheme(theme) {
      state.theme = theme;
      if (state.colors && glr) setColors(state.colors); else draw();
    },
    setBasemap(land, borders) { state.land = land; state.borders = borders; draw(); },
    setSelection(geom) { state.selection = geom; draw(); },
    setHover(geom) { if (geom !== state.hover) { state.hover = geom; draw(); } },
    rotate(rotation) { if (state.mode === "globe") setRotation(rotation); },
    /** Unfold the globe (0) into the flat map (1). */
    setMorph(t, rotation) {
      state.morph = t;
      if (rotation) state.rotation = rotation;
      setProjection();
      draw();
    },
    setExtent(extent) { state.extent = extent; fits(); setProjection(); draw(); },
    stopInertia,
    isBusy: () => !!drag || !!inertia,
    isDragging: () => !!drag,
  };
}
