"""
backend/engine/terrain_fetcher.py
Extracts 3D terrain heightmap patches (DEM) for Earth, Moon, and Mars.

Sources:
- Earth: AWS Terrain Tiles (Mapzen Terrarium RGB PNG) -> Open-Meteo Copernicus DEM 90m -> Offline synthesis
- Moon: USGS Astrogeology LRO LOLA 118m COG (if rasterio installed) / NASA Moon Trek WMTS + resolve_moon profile
- Mars: USGS Astrogeology HRSC+MOLA 200m COG (if rasterio installed) / NASA Mars Trek WMTS + resolve_mars profile
"""

from __future__ import annotations

from functools import lru_cache
from io import BytesIO
import math
from typing import Any, Dict, Tuple
from urllib.parse import urlparse

import numpy as np
import requests

from .planetary_resolver import resolve_planetary_point

BODY_RADII_KM = {
    "earth": 6371.0088,
    "moon": 1737.4,
    "mars": 3389.5,
}

TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/elevation"
MOON_COG_URL = "https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
MARS_COG_URL = "https://planetarymaps.usgs.gov/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"

ALLOWED_TILE_HOSTS = {
    "s3.amazonaws.com",
    "server.arcgisonline.com",
    "cartocdn-gusc.global.ssl.fastly.net",
    "trek.nasa.gov",
    "planetarymaps.usgs.gov",
    "gibs.earthdata.nasa.gov",
    "tile.openstreetmap.org",
}


def compute_patch_bounds(lat: float, lon: float, radius_km: float, planet: str) -> Dict[str, float]:
    """Compute lat/lon bounding box around a coordinate for a given physical radius in km."""
    body_r = BODY_RADII_KM.get(planet, 6371.0088)
    dlat = math.degrees(radius_km / body_r)
    cos_lat = max(0.15, math.cos(math.radians(lat)))
    dlon = math.degrees(radius_km / (body_r * cos_lat))
    return {
        "lat_min": max(-89.5, lat - dlat),
        "lat_max": min(89.5, lat + dlat),
        "lon_min": lon - dlon,
        "lon_max": lon + dlon,
        "span_m": float(radius_km * 2000.0),
    }


def _wrap_lon(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def _bilinear_resize(grid: np.ndarray, target_size: int) -> np.ndarray:
    """Resample a 2D numpy float array to (target_size, target_size) via bilinear interpolation."""
    src_h, src_w = grid.shape
    if src_h == target_size and src_w == target_size:
        return grid.astype(np.float64)

    y_idx = np.linspace(0, src_h - 1, target_size)
    x_idx = np.linspace(0, src_w - 1, target_size)
    y0 = np.floor(y_idx).astype(int)
    x0 = np.floor(x_idx).astype(int)
    y1 = np.minimum(y0 + 1, src_h - 1)
    x1 = np.minimum(x0 + 1, src_w - 1)
    wy = (y_idx - y0)[:, None]
    wx = (x_idx - x0)[None, :]

    top = grid[np.ix_(y0, x0)] * (1.0 - wx) + grid[np.ix_(y0, x1)] * wx
    bot = grid[np.ix_(y1, x0)] * (1.0 - wx) + grid[np.ix_(y1, x1)] * wx
    return top * (1.0 - wy) + bot * wy


def _deg_to_mercator_px(lat: float, lon: float, zoom: int) -> Tuple[float, float]:
    scale = 256.0 * (1 << zoom)
    siny = max(-0.9999, min(0.9999, math.sin(math.radians(lat))))
    px = ((lon + 180.0) / 360.0) * scale
    py = (0.5 - math.log((1.0 + siny) / (1.0 - siny)) / (4.0 * math.pi)) * scale
    return px, py


def _fetch_earth_terrarium(bounds: Dict[str, float], grid_size: int, radius_km: float) -> Tuple[np.ndarray, str] | None:
    """Fetch Earth elevation grid from AWS Mapzen Terrarium PNG tiles (requires Pillow)."""
    try:
        from PIL import Image
    except ImportError:
        return None

    zoom = 12 if radius_km <= 8.0 else (11 if radius_km <= 18.0 else 10)
    px_min, py_max = _deg_to_mercator_px(bounds["lat_min"], bounds["lon_min"], zoom)
    px_max, py_min = _deg_to_mercator_px(bounds["lat_max"], bounds["lon_max"], zoom)
    max_tile = (1 << zoom) - 1

    tx0 = max(0, int(px_min // 256))
    tx1 = min(max_tile, int(px_max // 256))
    ty0 = max(0, int(py_min // 256))
    ty1 = min(max_tile, int(py_max // 256))

    if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 9:
        return None

    tile_cache: Dict[Tuple[int, int], np.ndarray] = {}
    session = requests.Session()
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            url = TERRARIUM_URL.format(z=zoom, x=tx, y=ty)
            resp = session.get(url, timeout=4.0)
            if resp.status_code != 200:
                return None
            img = Image.open(BytesIO(resp.content)).convert("RGB")
            arr = np.asarray(img, dtype=np.float64)
            elev = (arr[:, :, 0] * 256.0 + arr[:, :, 1] + arr[:, :, 2] / 256.0) - 32768.0
            tile_cache[(tx, ty)] = elev

    stitched_w = (tx1 - tx0 + 1) * 256
    stitched_h = (ty1 - ty0 + 1) * 256
    stitched = np.zeros((stitched_h, stitched_w), dtype=np.float64)
    for (tx, ty), tile in tile_cache.items():
        ox = (tx - tx0) * 256
        oy = (ty - ty0) * 256
        stitched[oy : oy + 256, ox : ox + 256] = tile

    lx0 = max(0, min(stitched_w - 2, int(round(px_min - tx0 * 256))))
    lx1 = max(lx0 + 2, min(stitched_w, int(round(px_max - tx0 * 256))))
    ly0 = max(0, min(stitched_h - 2, int(round(py_min - ty0 * 256))))
    ly1 = max(ly0 + 2, min(stitched_h, int(round(py_max - ty0 * 256))))

    crop = stitched[ly0:ly1, lx0:lx1]
    return _bilinear_resize(crop, grid_size), "AWS Mapzen Terrarium DEM (SRTM/Copernicus)"


def _fetch_earth_open_meteo(bounds: Dict[str, float], grid_size: int) -> Tuple[np.ndarray, str] | None:
    """Query a 10x10 Copernicus DEM 90m grid from Open-Meteo (100 points/call) and resample."""
    coarse = 10
    lats = np.linspace(bounds["lat_max"], bounds["lat_min"], coarse)
    lons = np.linspace(bounds["lon_min"], bounds["lon_max"], coarse)
    lat_params = []
    lon_params = []
    for la in lats:
        for lo in lons:
            lat_params.append(f"{la:.5f}")
            lon_params.append(f"{_wrap_lon(lo):.5f}")

    resp = requests.get(
        OPEN_METEO_URL,
        params={"latitude": ",".join(lat_params), "longitude": ",".join(lon_params)},
        timeout=5.0,
    )
    if resp.status_code != 200:
        return None
    payload = resp.json()
    elevs = payload.get("elevation")
    if not isinstance(elevs, list) or len(elevs) != coarse * coarse:
        return None

    arr = np.asarray([float(v) if v is not None else 0.0 for v in elevs], dtype=np.float64).reshape(coarse, coarse)
    return _bilinear_resize(arr, grid_size), "Open-Meteo Elevation API (Copernicus DEM 90m)"


def _fetch_usgs_cog_patch(planet: str, bounds: Dict[str, float], grid_size: int) -> Tuple[np.ndarray, str] | None:
    """Stream windowed LOLA / HRSC+MOLA GeoTIFF DEM via rasterio if installed in environment."""
    try:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.windows import from_bounds
    except ImportError:
        return None

    url = MOON_COG_URL if planet == "moon" else MARS_COG_URL
    source_name = (
        "USGS LRO LOLA Global LDEM 118m (COG)"
        if planet == "moon"
        else "USGS Mars HRSC+MOLA Blended DEM 200m (COG)"
    )

    try:
        with rasterio.open(url) as ds:
            # Handle datasets encoded in 0..360 or -180..180 seamlessly
            lon_min, lon_max = bounds["lon_min"], bounds["lon_max"]
            if ds.bounds.right > 181.0 and lon_min < 0:
                lon_min = (lon_min + 360.0) % 360.0
                lon_max = (lon_max + 360.0) % 360.0
                if lon_max < lon_min:
                    lon_max = lon_min + max(0.05, bounds["lon_max"] - bounds["lon_min"])

            window = from_bounds(lon_min, bounds["lat_min"], lon_max, bounds["lat_max"], ds.transform)
            data = ds.read(1, window=window, out_shape=(grid_size, grid_size), resampling=Resampling.bilinear)
            arr = data.astype(np.float64)
            if ds.nodata is not None:
                valid = arr != float(ds.nodata)
                if not valid.any():
                    return None
                fill_val = float(np.median(arr[valid]))
                arr = np.where(valid, arr, fill_val)
            return arr, source_name
    except Exception:
        return None


def _synthesize_relief_from_profile(
    planet: str,
    lat: float,
    lon: float,
    bounds: Dict[str, float],
    grid_size: int,
) -> Tuple[np.ndarray, str]:
    """Deterministic multi-octave geomorphology DEM calibrated by planetary resolver telemetry."""
    if planet in ("moon", "mars"):
        prof = resolve_planetary_point(planet, lat, lon, clip_for_knn=False)["shared_17"]
        base_elev = float(prof.get("elevation_m", 0.0))
        slope_deg = float(prof.get("mean_slope_deg", 5.0))
        roughness = float(prof.get("terrain_roughness_m", 0.5))
        terrain_type = str(prof.get("terrain_type", "crater_rim"))
        has_void = int(prof.get("has_subsurface_void", 0))
    else:
        base_elev = 450.0
        slope_deg = 9.5
        roughness = 0.7
        terrain_type = "mountain_valley"
        has_void = 0

    span_m = bounds["span_m"]
    relief_scale = max(85.0, span_m * math.tan(math.radians(max(2.0, slope_deg))) * 0.42)
    coords = np.linspace(-1.0, 1.0, grid_size)
    xx, yy = np.meshgrid(coords, coords)
    rr = np.sqrt(xx**2 + yy**2)

    seed_phase = math.radians((lat * 13.37 + lon * 7.91) % 360.0)
    ridges = (
        0.48 * np.sin(xx * 3.4 + seed_phase) * np.cos(yy * 2.9 - seed_phase)
        + 0.28 * np.sin((xx + yy) * 6.5 + seed_phase * 2.0)
        + 0.14 * np.cos((xx - yy) * 12.0 - seed_phase)
        + 0.08 * np.sin(xx * 21.0 + yy * 19.0) * (0.5 + roughness)
    )

    if terrain_type == "crater_rim":
        crater_profile = -0.75 * np.exp(-((rr * 1.9) ** 2)) + 0.52 * np.exp(-(((rr - 0.52) * 5.0) ** 2))
        shape = 0.55 * crater_profile + 0.45 * ridges
    elif terrain_type == "volcanic_plain":
        lava_dome = 0.35 * np.exp(-((rr * 1.4) ** 2))
        pit = -0.95 * np.exp(-((rr * 6.5) ** 2)) if has_void else 0.0
        shape = 0.5 * ridges * 0.65 + lava_dome + pit
    elif terrain_type == "aeolian_desert":
        dunes = 0.55 * np.sin(xx * 9.5 + np.sin(yy * 3.5) * 1.4)
        shape = 0.6 * dunes + 0.4 * ridges
    else:
        shape = 0.75 * ridges + 0.25 * (xx * 0.4 - yy * 0.35)

    elev = base_elev + shape * relief_scale
    src = f"Orbital Profile + Geomorphic Relief ({planet.upper()} Resolver)"
    return elev, src


def _compute_mean_slope(grid: np.ndarray, span_m: float) -> float:
    n = grid.shape[0]
    cell_m = max(1.0, span_m / max(1, n - 1))
    dy, dx = np.gradient(grid, cell_m)
    slope_rad = np.arctan(np.hypot(dx, dy))
    return float(np.mean(np.degrees(slope_rad)))


@lru_cache(maxsize=64)
def _cached_extract(planet: str, lat_q: float, lon_q: float, radius_q: float, grid_size: int) -> Dict[str, Any]:
    bounds = compute_patch_bounds(lat_q, lon_q, radius_q, planet)
    result: Tuple[np.ndarray, str] | None = None

    if planet == "earth":
        try:
            result = _fetch_earth_terrarium(bounds, grid_size, radius_q)
        except Exception:
            result = None
        if result is None:
            try:
                result = _fetch_earth_open_meteo(bounds, grid_size)
            except Exception:
                result = None
    elif planet in ("moon", "mars"):
        result = _fetch_usgs_cog_patch(planet, bounds, grid_size)

    if result is None:
        elev_grid, source = _synthesize_relief_from_profile(planet, lat_q, lon_q, bounds, grid_size)
    else:
        elev_grid, source = result

    min_m = float(np.min(elev_grid))
    max_m = float(np.max(elev_grid))
    mean_slope = _compute_mean_slope(elev_grid, bounds["span_m"])

    return {
        "planet": planet,
        "lat": lat_q,
        "lon": lon_q,
        "radius_km": radius_q,
        "grid_size": grid_size,
        "span_m": round(bounds["span_m"], 1),
        "bounds": bounds,
        "min_elevation_m": round(min_m, 2),
        "max_elevation_m": round(max_m, 2),
        "relief_m": round(max_m - min_m, 2),
        "mean_slope_deg": round(mean_slope, 2),
        "source": source,
        "elevations_m": np.round(elev_grid, 2).ravel().tolist(),
    }


def extract_terrain_patch(
    planet: str,
    lat: float,
    lon: float,
    radius_km: float = 10.0,
    grid_size: int = 72,
) -> Dict[str, Any]:
    """Return a clean dict with gridded elevations (row-major north-to-south, west-to-east)."""
    body = planet.strip().lower()
    if body not in BODY_RADII_KM:
        raise ValueError("planet must be 'earth', 'moon', or 'mars'")
    clamped_grid = max(24, min(128, int(grid_size)))
    clamped_radius = max(1.0, min(80.0, float(radius_km)))
    return _cached_extract(body, round(float(lat), 3), round(float(lon), 3), round(clamped_radius, 1), clamped_grid)


def is_allowed_tile_url(url: str) -> bool:
    """Strict allowlist guard for optional HTTPS tile proxying."""
    try:
        parsed = urlparse(url)
        return parsed.scheme == "https" and (parsed.hostname or "").lower() in ALLOWED_TILE_HOSTS
    except Exception:
        return False
