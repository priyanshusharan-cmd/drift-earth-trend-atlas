// Summaries derived from a computed trend field: area shares, the zonal
// profile and connected clusters of robust change.

/** Share of valid surface area (by cos-latitude weight) in each category. */
export function areaShares(field, g, threshold) {
  let up = 0, down = 0, flat = 0, total = 0, weighted = 0;
  for (let c = 0; c < g.size; c++) {
    const s = field.slope[c];
    if (!(s === s)) continue;
    const w = g.weight(c);
    total += w;
    weighted += s * w;
    if (field.p[c] <= threshold) (s > 0 ? (up += w) : (down += w));
    else flat += w;
  }
  return total ? { up: up / total, down: down / total, flat: flat / total, meanSlope: weighted / total, coverage: total } : null;
}

/** Area-weighted mean slope and robust share for each latitude row. */
export function zonalProfile(field, g, lat, threshold) {
  const rows = [];
  for (let i = 0; i < g.nLat; i++) {
    let acc = 0, n = 0, robust = 0;
    for (let j = 0; j < g.nLon; j++) {
      const c = i * g.nLon + j;
      const s = field.slope[c];
      if (!(s === s)) continue;
      acc += s; n++;
      if (field.p[c] <= threshold) robust++;
    }
    rows.push({ lat: lat[i], slope: n ? acc / n : NaN, robust: n ? robust / n : 0, cells: n });
  }
  return rows;
}

/**
 * Connected regions (4-neighbour, wrapping in longitude) of cells with a
 * robust trend of the same sign. Each cluster is scored by area times mean
 * magnitude so that both large and intense regions surface.
 */
export function clusters(field, g, threshold, { minCells = 4, floor = [0, 0] } = {}) {
  const seen = new Uint8Array(g.size);
  const out = [];
  // floor[0] / floor[1]: smallest magnitude for decreasing / increasing cells.
  const sign = (c) => {
    const s = field.slope[c];
    if (!(s === s) || field.p[c] > threshold) return 0;
    return Math.abs(s) >= floor[s > 0 ? 1 : 0] ? Math.sign(s) : 0;
  };
  for (let start = 0; start < g.size; start++) {
    const sg = sign(start);
    if (!sg || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const cells = [];
    while (stack.length) {
      const c = stack.pop();
      cells.push(c);
      const i = Math.floor(c / g.nLon), j = c % g.nLon;
      const nbrs = [
        i > 0 ? c - g.nLon : -1,
        i < g.nLat - 1 ? c + g.nLon : -1,
        i * g.nLon + ((j + 1) % g.nLon),
        i * g.nLon + ((j - 1 + g.nLon) % g.nLon),
      ];
      for (const nb of nbrs) {
        if (nb >= 0 && !seen[nb] && sign(nb) === sg) { seen[nb] = 1; stack.push(nb); }
      }
    }
    if (cells.length < minCells) continue;
    let area = 0, acc = 0, peak = cells[0];
    let x = 0, y = 0, z = 0;
    for (const c of cells) {
      const w = g.weight(c);
      area += w;
      acc += field.slope[c] * w;
      if (Math.abs(field.slope[c]) > Math.abs(field.slope[peak])) peak = c;
      // Centroid on the sphere so clusters across the dateline stay correct.
      const [lon, lat] = g.center(c).map((d) => (d * Math.PI) / 180);
      x += w * Math.cos(lat) * Math.cos(lon);
      y += w * Math.cos(lat) * Math.sin(lon);
      z += w * Math.sin(lat);
    }
    const centroid = [(Math.atan2(y, x) * 180) / Math.PI, (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI];
    const mean = acc / area;
    out.push({ sign: sg, cells, area, mean, peak, centroid, score: area * Math.abs(mean) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Hotspots: when one direction covers much of the field, its connected
 * region can span most of the planet and say nothing. For any direction
 * covering more than `widespread` of the valid area, clusters only include
 * its fastest-changing cells (the top `share` of its robust area by
 * magnitude). Rarer directions keep every robust cell, so places that went
 * the other way still surface.
 */
export function hotspots(field, g, threshold, { share = 0.15, widespread = 0.1 } = {}) {
  let valid = 0;
  const mags = [[], []];
  for (let c = 0; c < g.size; c++) {
    const s = field.slope[c];
    if (!(s === s)) continue;
    const w = g.weight(c);
    valid += w;
    if (field.p[c] <= threshold) mags[s > 0 ? 1 : 0].push([Math.abs(s), w]);
  }
  const floor = mags.map((list) => {
    const area = list.reduce((acc, m) => acc + m[1], 0);
    if (area <= widespread * valid) return 0;
    list.sort((a, b) => b[0] - a[0]);
    let acc = 0;
    for (const [m, w] of list) { acc += w; if (acc >= share * area) return m; }
    return 0;
  });
  return clusters(field, g, threshold, { floor, minCells: 3 });
}

/** Fraction of the globe's surface represented by a cos-latitude weight sum. */
export function areaFraction(weightSum, g) {
  // Sum of weights over a full grid approximates the sphere area.
  let full = 0;
  for (let i = 0; i < g.nLat; i++) full += g.weight(i * g.nLon) * g.nLon;
  return weightSum / full;
}
