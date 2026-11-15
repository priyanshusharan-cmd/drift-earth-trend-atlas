// Loading of the catalog, dataset metadata and packed yearly grids.

const json = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url} (HTTP ${r.status}). Run the data build first.`);
  return r.json();
};

const metas = new Map();
const cubes = new Map();

export const loadCatalog = () => json("data/catalog.json");
export const loadWorld = () => json("data/world-110m.json");

export async function loadMeta(id) {
  if (!metas.has(id)) metas.set(id, json(`data/${id}/meta.json`));
  return metas.get(id);
}

export function cubeUrl(meta, season) {
  return `data/${meta.id}/${meta.seasons[season].file}`;
}

/** Yearly grids for one season as Int16Array [year][lat][lon]. */
export async function loadCube(meta, season) {
  const url = cubeUrl(meta, season);
  if (!cubes.has(url)) {
    cubes.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${url} (HTTP ${r.status}).`);
      return r.arrayBuffer();
    }).then((b) => new Int16Array(b)));
  }
  return cubes.get(url);
}

/** Values of a single cell for every year of a season. */
export function cellSeries(meta, cube, season, cell) {
  const s = meta.seasons[season];
  const size = meta.lat.length * meta.lon.length;
  const years = [], values = [];
  for (let y = s.firstYear, t = 0; y <= s.lastYear; y++, t++) {
    const raw = cube[t * size + cell];
    years.push(y);
    values.push(raw === meta.fill ? NaN : raw * meta.scale);
  }
  return { years, values };
}

/** Grid geometry helpers derived from metadata, never assumed. */
export function grid(meta) {
  const nLat = meta.lat.length, nLon = meta.lon.length;
  const dLat = Math.abs(meta.lat[0] - meta.lat[1]);
  const dLon = Math.abs(meta.lon[1] - meta.lon[0]);
  return {
    nLat, nLon, dLat, dLon, size: nLat * nLon,
    cellAt(lon, lat) {
      let j = Math.round((lon - meta.lon[0]) / dLon);
      j = ((j % nLon) + nLon) % nLon;
      const i = Math.round((meta.lat[0] - lat) / dLat);
      return i < 0 || i >= nLat ? -1 : i * nLon + j;
    },
    center(cell) {
      return [meta.lon[cell % nLon], meta.lat[Math.floor(cell / nLon)]];
    },
    bounds(cell) {
      const [lon, lat] = this.center(cell);
      return [lon - dLon / 2, lat - dLat / 2, lon + dLon / 2, lat + dLat / 2];
    },
    weight(cell) {
      return Math.cos((meta.lat[Math.floor(cell / nLon)] * Math.PI) / 180);
    },
  };
}
