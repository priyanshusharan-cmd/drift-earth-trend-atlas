"""Download NASA gridded products and pack them for the browser.

Every dataset in datasets.json is reduced from monthly grids to one value per
year and season, then written as little-endian int16 arrays laid out
[year][lat][lon] with latitude running north to south and longitude from
-180 to 180. Nothing is interpolated or filled: a season without enough valid
months stays missing.

    python scripts/build_data.py            # all datasets
    python scripts/build_data.py gpcp       # one dataset
    python scripts/build_data.py --refresh  # ignore cached downloads
"""

from __future__ import annotations

import argparse
import calendar
import concurrent.futures as futures
import datetime as dt
import gzip
import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path

import netCDF4
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
OUT = ROOT / "web" / "data"
FILL = -32768
USER_AGENT = "drift-trend-atlas/1.0 (NASA Space Apps)"


def fetch(url: str, dest: Path, refresh: bool) -> Path:
    if dest.exists() and not refresh:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as fh:
        shutil.copyfileobj(resp, fh)
    tmp.replace(dest)
    return dest


def list_links(url: str) -> list[str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        html = resp.read().decode("utf-8", "replace")
    return re.findall(r'href="([^"?#]+)"', html)


def to_monthly_cube(values: np.ndarray, lat: np.ndarray, lon: np.ndarray):
    """Return values with latitude north->south and longitude -180..180."""
    lon = np.where(lon > 180, lon - 360, lon)
    order = np.argsort(lon)
    values, lon = values[..., order], lon[order]
    if lat[0] < lat[-1]:
        values, lat = values[:, ::-1, :], lat[::-1]
    return values, lat, lon


def load_single_netcdf(ds: dict, refresh: bool):
    src = ds["source"]
    name = src["url"].rsplit("/", 1)[-1]
    path = fetch(src["url"], RAW / ds["id"] / name, refresh)
    if path.suffix == ".gz":
        plain = path.with_suffix("")
        if refresh or not plain.exists():
            with gzip.open(path, "rb") as fin, open(plain, "wb") as fout:
                shutil.copyfileobj(fin, fout)
        path = plain
    with netCDF4.Dataset(path) as nc:
        var = nc[src["variable"]]
        var.set_auto_maskandscale(True)
        data = np.ma.filled(var[:].astype("f8"), np.nan)
        lat = np.asarray(nc[src["lat"]][:], dtype="f8")
        lon = np.asarray(nc[src["lon"]][:], dtype="f8")
        tvar = nc[src["time"]]
        dates = netCDF4.num2date(tvar[:], tvar.units, getattr(tvar, "calendar", "standard"))
    months = [(d.year, d.month) for d in dates]
    return data, lat, lon, months, {"files": [src["url"]]}


def load_monthly_index(ds: dict, refresh: bool):
    src = ds["source"]
    pattern = re.compile(src["filePattern"])
    years = sorted({h.strip("/") for h in list_links(src["index"]) if re.fullmatch(r"\d{4}/?", h)})
    jobs = []
    for year in years:
        for href in list_links(src["index"] + year + "/"):
            m = pattern.fullmatch(href)
            if m:
                jobs.append(((int(m[1]), int(m[2])), src["index"] + year + "/" + href))
    # Several revisions of one month can be listed; keep the last one.
    latest = {}
    for key, url in sorted(jobs):
        latest[key] = url
    print(f"  {len(latest)} monthly files listed")

    def grab(item):
        (y, mo), url = item
        return (y, mo), fetch(url, RAW / ds["id"] / url.rsplit("/", 1)[-1], refresh)

    with futures.ThreadPoolExecutor(max_workers=8) as pool:
        paths = dict(pool.map(grab, sorted(latest.items())))

    months = sorted(paths)
    grids = []
    lat = lon = None
    for key in months:
        with netCDF4.Dataset(paths[key]) as nc:
            var = nc[src["variable"]]
            var.set_auto_maskandscale(True)
            grid = np.ma.filled(var[:].astype("f8"), np.nan)[0]
            if lat is None:
                lat = np.asarray(nc[src["lat"]][:], dtype="f8")
                lon = np.asarray(nc[src["lon"]][:], dtype="f8")
        grids.append(grid)
    return np.stack(grids), lat, lon, months, {"files": [src["index"]], "fileCount": len(months)}


LOADERS = {"single-netcdf": load_single_netcdf, "monthly-netcdf-index": load_monthly_index}


def aggregate(data, months, season: dict, min_year: int):
    """Day-weighted seasonal means. DJF takes December from the previous year."""
    index = {ym: i for i, ym in enumerate(months)}
    wanted = season["months"]
    first = max(min_year, months[0][0])
    last = months[-1][0]
    years, layers = [], []
    for year in range(first, last + 1):
        acc = np.zeros(data.shape[1:])
        wsum = np.zeros(data.shape[1:])
        count = np.zeros(data.shape[1:], dtype=int)
        for mo in wanted:
            y = year - 1 if (mo == 12 and wanted[0] == 12) else year
            i = index.get((y, mo))
            if i is None:
                continue
            grid = data[i]
            ok = np.isfinite(grid)
            w = calendar.monthrange(y, mo)[1]
            acc[ok] += grid[ok] * w
            wsum[ok] += w
            count += ok
        if count.max() < season["minMonths"]:
            continue
        mean = np.where(count >= season["minMonths"], acc / np.where(wsum == 0, 1, wsum), np.nan)
        years.append(year)
        layers.append(mean)
    return years, np.stack(layers)


def pack(cube: np.ndarray, scale: float) -> bytes:
    q = np.round(cube / scale)
    q = np.where(np.isfinite(q), np.clip(q, -32767, 32767), FILL).astype("<i2")
    return q.tobytes()


def build(ds: dict, seasons: dict, refresh: bool) -> dict:
    print(f"[{ds['id']}] {ds['product']}")
    data, lat, lon, months, provenance = LOADERS[ds["source"]["type"]](ds, refresh)
    data, lat, lon = to_monthly_cube(data, lat, lon)
    target = OUT / ds["id"]
    target.mkdir(parents=True, exist_ok=True)

    season_meta = {}
    for key, season in seasons.items():
        years, cube = aggregate(data, months, season, ds.get("minYear", 0))
        (target / f"{key}.bin").write_bytes(pack(cube, ds["storeScale"]))
        valid = np.isfinite(cube).mean(axis=(1, 2))
        season_meta[key] = {
            "label": season["label"],
            "months": season["months"],
            "minMonths": season["minMonths"],
            "file": f"{key}.bin",
            "firstYear": years[0],
            "lastYear": years[-1],
            "coverage": [round(float(v), 4) for v in valid],
        }
        print(f"  {key}: {years[0]}–{years[-1]}  ({len(years)} years)")

    meta = {
        key: ds[key]
        for key in ("id", "name", "title", "product", "institution", "units", "kind", "palette",
                    "resolution", "defaultWindow", "citation", "landing", "words", "relativeUnits")
    }
    meta.update({
        "baseline": ds.get("baseline"),
        "scale": ds["storeScale"],
        "fill": FILL,
        "lat": [round(float(v), 3) for v in lat],
        "lon": [round(float(v), 3) for v in lon],
        "lastMonth": f"{months[-1][0]}-{months[-1][1]:02d}",
        "firstMonth": f"{months[0][0]}-{months[0][1]:02d}",
        "seasons": season_meta,
        "retrieved": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "provenance": provenance,
    })
    (target / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
    return {"id": ds["id"], "name": ds["name"], "title": ds["title"], "product": ds["product"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*", help="dataset ids to build (default: all)")
    parser.add_argument("--refresh", action="store_true", help="download again even if cached")
    args = parser.parse_args()

    registry = json.loads((ROOT / "datasets.json").read_text())
    chosen = [d for d in registry["datasets"] if not args.ids or d["id"] in args.ids]
    if args.ids and len(chosen) != len(args.ids):
        known = ", ".join(d["id"] for d in registry["datasets"])
        print(f"Unknown dataset id. Known ids: {known}", file=sys.stderr)
        return 2

    for ds in chosen:
        build(ds, registry["seasons"], args.refresh)

    # The catalog lists whatever has been built so far, in registry order.
    catalog = []
    for ds in registry["datasets"]:
        meta_path = OUT / ds["id"] / "meta.json"
        if meta_path.exists():
            catalog.append({"id": ds["id"], "name": ds["name"], "title": ds["title"], "product": ds["product"]})
    (OUT / "catalog.json").write_text(json.dumps({"datasets": catalog}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
