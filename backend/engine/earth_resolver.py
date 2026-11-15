"""Earth condition resolver and batch catalog collector.

Reliably collects all 10 geotechnical and environmental factors for any Earth
(lat, lon) coordinate or batch site list using standard library HTTP/CSV/math
(with optional pandas DataFrame output if installed):
  1. slope_deg            (Open-Meteo Copernicus DEM 3x3 Horn slope; Open-Elevation fallback)
  2. mean_temp_c          (NASA POWER TS annual climatology)
  3. temp_swing_c         (NASA POWER TS_MAX - TS_MIN annual climatology)
  4. aridity_ice_idx      (Derived from NASA POWER PRECTOTCORR + TS cryogenic boost)
  5. lithology_type       (Macrostrat geologic map API + curated fallback)
  6. has_subsurface_void  (Explicit flag or Haversine match to known terrestrial caves/tubes)
  7. solar_irradiance_kwh (NASA POWER ALLSKY_SFC_SW_DWN, kWh/m^2/day)
  8. surface_pressure_kpa (NASA POWER PS, kPa)
  9. surface_roughness_m  (Detrended 3x3 DEM elevation residual RMS, meters)
 10. wind_speed_ms        (NASA POWER WS2M, fallback WS10M scaled to 2m)
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
import json
import math
from pathlib import Path
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
import urllib.error
import urllib.parse
import urllib.request

try:
    import pandas as pd  # type: ignore
except ImportError:
    pd = None  # type: ignore

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_OUTPUT_CSV = DATA_DIR / "earth_analogs.csv"
DEFAULT_CACHE_PATH = DATA_DIR / ".earth_cache.json"

EARTH_RADIUS_KM = 6371.0
MONTH_KEYS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
USER_AGENT = "NASA-SpaceApps-PlanetaryAnalogFinder/1.0"

CSV_FIELDNAMES: Tuple[str, ...] = (
    "site_id",
    "body",
    "parent_biome",
    "micro_site_name",
    "lat",
    "lon",
    "slope_deg",
    "mean_temp_c",
    "temp_swing_c",
    "aridity_ice_idx",
    "lithology_type",
    "has_subsurface_void",
    "solar_irradiance_kwh",
    "surface_pressure_kpa",
    "surface_roughness_m",
    "wind_speed_ms",
)

KNOWN_EARTH_VOIDS: List[Dict[str, Any]] = [
    {"name": "Pisgah Lava Tube", "lat": 34.746, "lon": -116.375, "radius_km": 10.0},
    {"name": "Mauna Loa / Kazumura Caves", "lat": 19.536, "lon": -155.576, "radius_km": 15.0},
    {"name": "Craters of the Moon Caves", "lat": 43.416, "lon": -113.516, "radius_km": 15.0},
    {"name": "Askja Basalt & Caldera Tubes", "lat": 65.033, "lon": -16.750, "radius_km": 15.0},
    {"name": "Lava Beds National Monument", "lat": 41.714, "lon": -121.508, "radius_km": 15.0},
    {"name": "El Malpais Lava Tubes", "lat": 34.958, "lon": -107.989, "radius_km": 15.0},
    {"name": "Undara Lava Tubes", "lat": -18.203, "lon": 144.571, "radius_km": 15.0},
    {"name": "Cueva de los Verdes (Lanzarote)", "lat": 29.161, "lon": -13.439, "radius_km": 10.0},
    {"name": "Manjanggul Lava Tube (Jeju)", "lat": 33.528, "lon": 126.770, "radius_km": 10.0},
]

# Curated starter set covering the 10+ NASA ground-truth analogs + key extremes
DEFAULT_SEED_SITES: List[Dict[str, Any]] = [
    {"site_id": "EARTH_001", "parent_biome": "Mojave Desert", "micro_site_name": "Pisgah Lava Tube", "lat": 34.746, "lon": -116.375, "has_subsurface_void": 1, "default_lith": "basalt"},
    {"site_id": "EARTH_002", "parent_biome": "Canadian High Arctic", "micro_site_name": "Haughton Impact Crater", "lat": 75.383, "lon": -89.667, "has_subsurface_void": 0, "default_lith": "impact_breccia"},
    {"site_id": "EARTH_003", "parent_biome": "Atacama Desert", "micro_site_name": "Yungay Hyper-Arid Core", "lat": -24.088, "lon": -69.913, "has_subsurface_void": 0, "default_lith": "evaporite"},
    {"site_id": "EARTH_004", "parent_biome": "San Francisco Volcanic Field", "micro_site_name": "Black Point Lava Flow", "lat": 35.696, "lon": -111.462, "has_subsurface_void": 0, "default_lith": "basalt"},
    {"site_id": "EARTH_005", "parent_biome": "McMurdo Dry Valleys", "micro_site_name": "Don Juan Pond Basin", "lat": -77.564, "lon": 161.175, "has_subsurface_void": 0, "default_lith": "evaporite"},
    {"site_id": "EARTH_006", "parent_biome": "McMurdo Dry Valleys", "micro_site_name": "University Valley Permafrost", "lat": -77.863, "lon": 160.708, "has_subsurface_void": 0, "default_lith": "sedimentary"},
    {"site_id": "EARTH_007", "parent_biome": "Hawai'i Volcanic Shield", "micro_site_name": "Mauna Loa High Lava Tubes", "lat": 19.536, "lon": -155.576, "has_subsurface_void": 1, "default_lith": "basalt"},
    {"site_id": "EARTH_008", "parent_biome": "Hawai'i Volcanic Shield", "micro_site_name": "Kilauea Ka'u Desert", "lat": 19.373, "lon": -155.344, "has_subsurface_void": 0, "default_lith": "basalt"},
    {"site_id": "EARTH_009", "parent_biome": "Iceland Highlands", "micro_site_name": "Askja Basalt & Caldera", "lat": 65.033, "lon": -16.750, "has_subsurface_void": 1, "default_lith": "basalt"},
    {"site_id": "EARTH_010", "parent_biome": "Snake River Plain", "micro_site_name": "Craters of the Moon Caves", "lat": 43.416, "lon": -113.516, "has_subsurface_void": 1, "default_lith": "basalt"},
    {"site_id": "EARTH_011", "parent_biome": "Altiplano Salt Flats", "micro_site_name": "Salar de Uyuni", "lat": -20.134, "lon": -67.489, "has_subsurface_void": 0, "default_lith": "evaporite"},
    {"site_id": "EARTH_012", "parent_biome": "Anatolian Highlands", "micro_site_name": "Lake Salda Carbonate Shoreline", "lat": 37.547, "lon": 29.680, "has_subsurface_void": 0, "default_lith": "evaporite"},
    {"site_id": "EARTH_013", "parent_biome": "Iberian Pyrite Belt", "micro_site_name": "Rio Tinto Acidic Terrace", "lat": 37.705, "lon": -6.554, "has_subsurface_void": 0, "default_lith": "sedimentary"},
    {"site_id": "EARTH_014", "parent_biome": "Afar Depression", "micro_site_name": "Dallol Hydrothermal Salt Flat", "lat": 14.242, "lon": 40.300, "has_subsurface_void": 0, "default_lith": "evaporite"},
    {"site_id": "EARTH_015", "parent_biome": "Namib Desert", "micro_site_name": "Gobabeb Gravel & Dune Edge", "lat": -23.561, "lon": 15.041, "has_subsurface_void": 0, "default_lith": "aeolian_dune"},
    {"site_id": "EARTH_016", "parent_biome": "High Arctic Archipelago", "micro_site_name": "Adventdalen Permafrost Slope", "lat": 78.196, "lon": 15.921, "has_subsurface_void": 0, "default_lith": "sedimentary"},
    {"site_id": "EARTH_017", "parent_biome": "Kazakhstan Steppe", "micro_site_name": "Zhamanshin Impact Crater", "lat": 48.400, "lon": 60.967, "has_subsurface_void": 0, "default_lith": "impact_breccia"},
]


def _http_json(
    url: str,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    timeout: float = 20.0,
    retries: int = 3,
) -> Dict[str, Any]:
    """Perform GET or POST JSON request with exponential backoff retries."""
    full_url = f"{url}?{urllib.parse.urlencode(params)}" if params else url
    data_bytes: Optional[bytes] = None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if json_body is not None:
        data_bytes = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    last_err: Optional[Exception] = None
    for attempt in range(retries):
        req = urllib.request.Request(full_url, data=data_bytes, headers=headers, method="POST" if data_bytes else "GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last_err = exc
            if exc.code not in (429, 500, 502, 503, 504):
                raise
        except Exception as exc:
            last_err = exc
        if attempt < retries - 1:
            time.sleep(0.8 * (2 ** attempt))

    assert last_err is not None
    raise last_err


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _extract_power_annual(param_block: Optional[Dict[str, Any]]) -> Optional[float]:
    """Extract valid annual value from NASA POWER climatology block, ignoring -999 fill values."""
    if not isinstance(param_block, dict):
        return None
    ann = param_block.get("ANN")
    if ann is not None and float(ann) > -900.0:
        return float(ann)
    monthly = [
        float(param_block[m])
        for m in MONTH_KEYS
        if m in param_block and param_block[m] is not None and float(param_block[m]) > -900.0
    ]
    if monthly:
        return sum(monthly) / len(monthly)
    return None


# ---------------------------------------------------------
# 1. NASA POWER Climate + Solar + Pressure + Wind (6 factors in 1 call)
# ---------------------------------------------------------
def _extract_power_unit(payload: Dict[str, Any], param_name: str) -> str:
    """Read parameter unit string from NASA POWER response header/parameters block."""
    for container_key in ("parameters", "header"):
        block = payload.get(container_key, {})
        if container_key == "header":
            block = block.get("parameters", {})
        if isinstance(block, dict) and param_name in block:
            return str(block[param_name].get("units", "")).lower()
    return ""


def fetch_nasa_power_climate(lat: float, lon: float) -> Dict[str, float]:
    """Fetch temperature, diurnal swing, aridity/ice, solar irradiance, pressure, and wind speed."""
    url = "https://power.larc.nasa.gov/api/temporal/climatology/point"
    params = {
        "parameters": "TS,TS_MAX,TS_MIN,T2M_RANGE,PRECTOTCORR,ALLSKY_SFC_SW_DWN,PS,WS2M,WS10M",
        "community": "SB",
        "longitude": round(float(lon), 4),
        "latitude": round(float(lat), 4),
        "format": "JSON",
    }

    payload: Dict[str, Any] = {}
    data: Dict[str, Any] = {}
    try:
        payload = _http_json(url, params=params, timeout=25.0)
        data = payload.get("properties", {}).get("parameter", {})
    except Exception:
        payload = {}
        data = {}

    ts = _extract_power_annual(data.get("TS"))
    ts_max = _extract_power_annual(data.get("TS_MAX"))
    ts_min = _extract_power_annual(data.get("TS_MIN"))
    t2m_range = _extract_power_annual(data.get("T2M_RANGE"))
    precip = _extract_power_annual(data.get("PRECTOTCORR"))
    solar_raw = _extract_power_annual(data.get("ALLSKY_SFC_SW_DWN"))
    pressure = _extract_power_annual(data.get("PS"))
    ws2m = _extract_power_annual(data.get("WS2M"))
    ws10m = _extract_power_annual(data.get("WS10M"))

    mean_temp_c = ts if ts is not None else (25.0 - 0.55 * abs(lat))
    if t2m_range is not None:
        temp_swing_c = max(0.0, t2m_range)
    elif ts_max is not None and ts_min is not None:
        temp_swing_c = max(0.0, ts_max - ts_min)
    else:
        temp_swing_c = 12.0

    if precip is not None:
        aridity_idx = max(0.0, min(1.0, 1.0 - (max(0.0, precip) / 5.0)))
    else:
        aridity_idx = 0.5
    if mean_temp_c < -5.0:
        aridity_idx = max(aridity_idx, 0.90)

    if solar_raw is not None:
        solar_unit = _extract_power_unit(payload, "ALLSKY_SFC_SW_DWN")
        if "w/m" in solar_unit and "kwh" not in solar_unit:
            solar_kwh = max(0.0, solar_raw * 24.0 / 1000.0)
        elif "mj/m" in solar_unit:
            solar_kwh = max(0.0, solar_raw / 3.6)
        elif solar_raw > 25.0:
            # SB community returns mean W/m^2 (~50-350); convert to kWh/m^2/day
            solar_kwh = max(0.0, solar_raw * 24.0 / 1000.0)
        else:
            solar_kwh = max(0.0, solar_raw)
    else:
        solar_kwh = max(0.5, 6.5 * math.cos(math.radians(lat)))

    surface_pressure_kpa = max(20.0, pressure) if pressure is not None else 101.33

    if ws2m is not None:
        wind_speed_ms = max(0.0, ws2m)
    elif ws10m is not None:
        wind_speed_ms = max(0.0, ws10m * 0.78)
    else:
        wind_speed_ms = 4.0

    return {
        "mean_temp_c": round(mean_temp_c, 2),
        "temp_swing_c": round(temp_swing_c, 2),
        "aridity_ice_idx": round(aridity_idx, 2),
        "solar_irradiance_kwh": round(solar_kwh, 2),
        "surface_pressure_kpa": round(surface_pressure_kpa, 2),
        "wind_speed_ms": round(wind_speed_ms, 2),
    }


# ---------------------------------------------------------
# 2. Global 3x3 DEM Elevation -> Slope & Surface Roughness (2 factors in 1 call)
# ---------------------------------------------------------
def _build_3x3_grid(lat: float, lon: float, step_m: float = 90.0) -> List[Tuple[float, float]]:
    """Return 9 (lat, lon) points in row-major order: NW, N, NE, W, C, E, SW, S, SE."""
    d_lat = step_m / 111320.0
    cos_lat = max(0.15, math.cos(math.radians(lat)))
    d_lon = step_m / (111320.0 * cos_lat)

    points: List[Tuple[float, float]] = []
    for row_sign in (1, 0, -1):  # North to South
        p_lat = max(-89.99, min(89.99, lat + row_sign * d_lat))
        for col_sign in (-1, 0, 1):  # West to East
            p_lon = ((lon + col_sign * d_lon + 180.0) % 360.0) - 180.0
            points.append((round(p_lat, 6), round(p_lon, 6)))
    return points


def _fetch_open_meteo_elevations(points: List[Tuple[float, float]]) -> Optional[List[float]]:
    url = "https://api.open-meteo.com/v1/elevation"
    params = {
        "latitude": ",".join(str(p[0]) for p in points),
        "longitude": ",".join(str(p[1]) for p in points),
    }
    payload = _http_json(url, params=params, timeout=20.0)
    elevs = payload.get("elevation")
    if isinstance(elevs, list) and len(elevs) == len(points) and all(e is not None for e in elevs):
        return [float(e) for e in elevs]
    return None


def _fetch_open_elevation_elevations(points: List[Tuple[float, float]]) -> Optional[List[float]]:
    url = "https://api.open-elevation.com/api/v1/lookup"
    body = {"locations": [{"latitude": p[0], "longitude": p[1]} for p in points]}
    payload = _http_json(url, json_body=body, timeout=20.0)
    results = payload.get("results", [])
    if len(results) == len(points) and all(r.get("elevation") is not None for r in results):
        return [float(r["elevation"]) for r in results]
    return None


def fetch_terrain_metrics(lat: float, lon: float, step_m: float = 90.0) -> Dict[str, float]:
    """Compute Horn's 3x3 slope (deg) and detrended planar residual RMS roughness (m)."""
    points = _build_3x3_grid(lat, lon, step_m=step_m)

    elevs: Optional[List[float]] = None
    for fetcher in (_fetch_open_meteo_elevations, _fetch_open_elevation_elevations):
        try:
            elevs = fetcher(points)
            if elevs is not None:
                break
        except Exception:
            continue

    if elevs is None:
        return {"slope_deg": 3.0, "surface_roughness_m": 0.50}

    # 3x3 row-major: [0..2]=N row, [3..5]=mid row, [6..8]=S row
    z00, z01, z02, z10, _z11, z12, z20, z21, z22 = elevs

    # Horn's 3x3 weighted slope
    dz_dx = ((z02 + 2.0 * z12 + z22) - (z00 + 2.0 * z10 + z20)) / (8.0 * step_m)
    dz_dy = ((z20 + 2.0 * z21 + z22) - (z00 + 2.0 * z01 + z02)) / (8.0 * step_m)
    slope_deg = math.degrees(math.atan(math.hypot(dz_dx, dz_dy)))

    # Closed-form OLS plane fit over orthogonal symmetric 3x3 coordinates
    xs = (-step_m, 0.0, step_m, -step_m, 0.0, step_m, -step_m, 0.0, step_m)
    ys = (step_m, step_m, step_m, 0.0, 0.0, 0.0, -step_m, -step_m, -step_m)
    denom = 6.0 * step_m * step_m
    c = sum(elevs) / 9.0
    a = sum(x * z for x, z in zip(xs, elevs)) / denom
    b = sum(y * z for y, z in zip(ys, elevs)) / denom
    residuals = [z - (a * x + b * y + c) for x, y, z in zip(xs, ys, elevs)]
    roughness_m = math.sqrt(sum(r * r for r in residuals) / 9.0)

    return {
        "slope_deg": round(slope_deg, 2),
        "surface_roughness_m": round(roughness_m, 2),
    }


def fetch_slope_degrees(lat: float, lon: float, step_m: float = 90.0) -> float:
    """Convenience wrapper returning only slope_deg."""
    return fetch_terrain_metrics(lat, lon, step_m=step_m)["slope_deg"]


# ---------------------------------------------------------
# 3. Lithology via Macrostrat API + Expanded Geologic Keyword Classifier
# ---------------------------------------------------------
def fetch_lithology(lat: float, lon: float, fallback: str = "basalt") -> str:
    """Query Macrostrat geologic map API and standardize into project lithology classes."""
    url = "https://macrostrat.org/api/v2/geologic_units/map"
    try:
        payload = _http_json(url, params={"lat": round(float(lat), 4), "lng": round(float(lon), 4)}, timeout=15.0)
        records = payload.get("success", {}).get("data", [])
        if not records:
            return fallback

        combined = " ".join(
            f"{u.get('lith', '')} {u.get('descrip', '')} {u.get('name', '')}"
            for u in records[:3]
        ).lower()

        if any(k in combined for k in ("anorthosite", "plagioclase", "gabbro", "norite", "troctolite", "highland")):
            return "anorthosite"
        if any(k in combined for k in ("breccia", "impact", "crater", "suevite", "melt rock", "gneiss")):
            return "impact_breccia"
        if any(k in combined for k in ("basalt", "volcanic", "mafic", "lava", "diabase", "scoria", "tuff", "andesite", "rhyolite", "pumice")):
            return "basalt"
        if any(k in combined for k in ("evaporite", "halite", "gypsum", "salt", "playa", "salar", "chloride", "nitrate", "saline")):
            return "evaporite"
        if any(k in combined for k in ("dune", "aeolian", "eolian", "erg", "sand", "loess", "alluvium")):
            return "aeolian_dune"
        if any(k in combined for k in ("limestone", "dolomite", "shale", "mudstone", "siltstone", "clay", "sedimentary", "organic", "peat")):
            return "sedimentary"
        return fallback
    except Exception:
        return fallback


# ---------------------------------------------------------
# 4. Subsurface Void Detection
# ---------------------------------------------------------
def detect_subsurface_void(lat: float, lon: float, explicit_flag: Optional[int] = None) -> int:
    """Return 1 if explicit_flag == 1 or within radius of a known terrestrial lava tube / cave."""
    if explicit_flag is not None and not (isinstance(explicit_flag, float) and math.isnan(explicit_flag)):
        return 1 if int(explicit_flag) == 1 else 0
    for site in KNOWN_EARTH_VOIDS:
        if _haversine_km(lat, lon, site["lat"], site["lon"]) <= site["radius_km"]:
            return 1
    return 0


# ---------------------------------------------------------
# 5. Unified 10-Factor Earth Coordinate Resolver & Batch Pipeline
# ---------------------------------------------------------
def resolve_earth_coordinate(
    lat: float,
    lon: float,
    site_id: str = "EARTH_CUSTOM",
    parent_biome: str = "Custom Earth Coordinate",
    micro_site_name: Optional[str] = None,
    has_subsurface_void: Optional[int] = None,
    default_lith: str = "basalt",
) -> Dict[str, Any]:
    """Resolve all 10 environmental & geotechnical factors for any Earth (lat, lon)."""
    lat_c = max(-90.0, min(90.0, float(lat)))
    lon_w = ((float(lon) + 180.0) % 360.0) - 180.0

    climate = fetch_nasa_power_climate(lat_c, lon_w)
    terrain = fetch_terrain_metrics(lat_c, lon_w)
    lithology = fetch_lithology(lat_c, lon_w, fallback=default_lith)
    void_flag = detect_subsurface_void(lat_c, lon_w, explicit_flag=has_subsurface_void)

    return {
        "site_id": str(site_id),
        "body": "Earth",
        "parent_biome": str(parent_biome),
        "micro_site_name": micro_site_name or f"Earth Surface ({lat_c:.3f}°, {lon_w:.3f}°)",
        "lat": round(lat_c, 4),
        "lon": round(lon_w, 4),
        "slope_deg": terrain["slope_deg"],
        "mean_temp_c": climate["mean_temp_c"],
        "temp_swing_c": climate["temp_swing_c"],
        "aridity_ice_idx": climate["aridity_ice_idx"],
        "lithology_type": lithology,
        "has_subsurface_void": void_flag,
        "solar_irradiance_kwh": climate["solar_irradiance_kwh"],
        "surface_pressure_kpa": climate["surface_pressure_kpa"],
        "surface_roughness_m": terrain["surface_roughness_m"],
        "wind_speed_ms": climate["wind_speed_ms"],
    }


def _load_cache(cache_path: Path) -> Dict[str, Dict[str, Any]]:
    if not cache_path.exists():
        return {}
    try:
        return json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_cache(cache_path: Path, cache: Dict[str, Dict[str, Any]]) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=2), encoding="utf-8")


def build_earth_catalog(
    sites: List[Dict[str, Any]],
    output_csv: Path = DEFAULT_OUTPUT_CSV,
    cache_path: Path = DEFAULT_CACHE_PATH,
    use_cache: bool = True,
    max_workers: int = 4,
) -> Any:
    """Batch-resolve a list of Earth sites to all 10 factors with caching and concurrency."""
    cache = _load_cache(cache_path) if use_cache else {}
    cache_lock = threading.Lock()
    ordered_rows: List[Optional[Dict[str, Any]]] = [None] * len(sites)

    def _process(idx: int, site: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        lat = float(site["lat"])
        lon = float(site["lon"])
        key = f"{lat:.4f},{lon:.4f}"

        if use_cache:
            with cache_lock:
                cached = cache.get(key)
            if cached is not None:
                merged = dict(cached)
                merged["site_id"] = str(site.get("site_id", merged["site_id"]))
                merged["parent_biome"] = str(site.get("parent_biome", merged["parent_biome"]))
                merged["micro_site_name"] = str(site.get("micro_site_name", merged["micro_site_name"]))
                if site.get("has_subsurface_void") is not None:
                    merged["has_subsurface_void"] = detect_subsurface_void(lat, lon, site["has_subsurface_void"])
                return idx, merged

        row = resolve_earth_coordinate(
            lat=lat,
            lon=lon,
            site_id=str(site.get("site_id", f"EARTH_{idx + 1:03d}")),
            parent_biome=str(site.get("parent_biome", "Unknown Biome")),
            micro_site_name=site.get("micro_site_name"),
            has_subsurface_void=site.get("has_subsurface_void"),
            default_lith=str(site.get("default_lith") or site.get("lithology_type") or "basalt"),
        )
        time.sleep(0.15)  # Polite pacing per worker
        if use_cache:
            with cache_lock:
                cache[key] = row
        return idx, row

    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
        futures = [pool.submit(_process, i, s) for i, s in enumerate(sites)]
        for fut in as_completed(futures):
            idx, resolved = fut.result()
            ordered_rows[idx] = resolved
            print(f"[{idx + 1}/{len(sites)}] Resolved {resolved['micro_site_name']} ({resolved['lat']}, {resolved['lon']})")

    if use_cache:
        _save_cache(cache_path, cache)

    clean_rows = [r for r in ordered_rows if r is not None]
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDNAMES)
        writer.writeheader()
        writer.writerows(clean_rows)

    return pd.DataFrame(clean_rows) if pd is not None else clean_rows


def _load_sites_from_csv(csv_path: Path) -> List[Dict[str, Any]]:
    sites: List[Dict[str, Any]] = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            void_raw = (row.get("has_subsurface_void") or "").strip()
            void_val = int(float(void_raw)) if void_raw else None
            lith_raw = (row.get("default_lith") or row.get("lithology_type") or "").strip()
            sites.append(
                {
                    "site_id": (row.get("site_id") or f"EARTH_{i + 1:03d}").strip(),
                    "parent_biome": (row.get("parent_biome") or "Unknown Biome").strip(),
                    "micro_site_name": (row.get("micro_site_name") or f"Site {i + 1}").strip(),
                    "lat": float(row["lat"]),
                    "lon": float(row["lon"]),
                    "has_subsurface_void": void_val,
                    "default_lith": lith_raw or "basalt",
                }
            )
    return sites


def _main() -> None:
    parser = argparse.ArgumentParser(description="Collect all 10 Earth condition factors reliably.")
    parser.add_argument("--lat", type=float, default=None, help="Single latitude to resolve")
    parser.add_argument("--lon", type=float, default=None, help="Single longitude to resolve")
    parser.add_argument("--input", type=Path, default=None, help="Optional input CSV of sites (site_id, parent_biome, micro_site_name, lat, lon)")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_CSV, help="Output CSV path")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent worker count")
    parser.add_argument("--no-cache", action="store_true", help="Disable local JSON response cache")
    args = parser.parse_args()

    if args.lat is not None and args.lon is not None:
        res = resolve_earth_coordinate(args.lat, args.lon)
        print(json.dumps(res, indent=2))
        return

    sites = _load_sites_from_csv(args.input) if args.input else DEFAULT_SEED_SITES
    result = build_earth_catalog(
        sites=sites,
        output_csv=args.output,
        use_cache=not args.no_cache,
        max_workers=args.workers,
    )
    print(f"\nSaved {len(result)} rows with all 10 factors to {args.output}")


if __name__ == "__main__":
    _main()
