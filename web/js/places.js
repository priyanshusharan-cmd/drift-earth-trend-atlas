// Turns coordinates into readable place names using the Natural Earth
// country polygons that are already loaded for the map.

const d3 = globalThis.d3;

export function createGazetteer(countries) {
  const features = countries.features.filter((f) => f.properties?.name);
  const centroids = features.map((f) => d3.geoCentroid(f));
  const bounds = features.map((f) => d3.geoBounds(f));

  const inBounds = (b, [lon, lat]) => {
    const [[x0, y0], [x1, y1]] = b;
    if (lat < y0 || lat > y1) return false;
    return x0 <= x1 ? lon >= x0 && lon <= x1 : lon >= x0 || lon <= x1;
  };

  function containing(point) {
    for (let i = 0; i < features.length; i++) {
      if (inBounds(bounds[i], point) && d3.geoContains(features[i], point)) return features[i].properties.name;
    }
    return null;
  }

  function nearest(point) {
    let best = null, dist = Infinity;
    for (let i = 0; i < features.length; i++) {
      const d = d3.geoDistance(point, centroids[i]);
      if (d < dist) { dist = d; best = features[i].properties.name; }
    }
    return { name: best, km: dist * 6371 };
  }

  const coords = ([lon, lat]) =>
    `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? "E" : "W"}`;

  // Approximate ocean basins from the IHO convention: the Atlantic meets the
  // Indian Ocean at 20°E and the Pacific at Drake Passage (≈ 68°W); the
  // Indian Ocean meets the Pacific along Indonesia and Tasmania (≈ 147°E).
  function basin([lon, lat]) {
    if (lat > 66) return "the Arctic Ocean";
    if (lat < -60) return "the Southern Ocean";
    const hemi = lat >= 0 ? "North" : "South";
    if (lon >= 20 && (lon <= 100 || (lat < -8 && lon <= 147)) && lat < 30) return "the Indian Ocean";
    if (lat >= 8 ? lon >= -100 && lon < 20 : lon >= -68 && lon < 20) return `the ${hemi} Atlantic`;
    return `the ${hemi} Pacific`;
  }

  /** A short human name for a point: a country, waters near one, or an ocean. */
  function name(point) {
    const inside = containing(point);
    if (inside) return inside;
    if (point[1] > 66) return "the Arctic";
    const near = nearest(point);
    if (near.km < 1800) return `waters near ${near.name}`;
    return basin(point);
  }

  return { name, coords, containing };
}
