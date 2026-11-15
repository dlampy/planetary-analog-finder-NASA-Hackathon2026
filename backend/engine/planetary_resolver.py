"""Planetary condition resolver for Moon and Mars coordinates.

Resolves all 10 geotechnical and environmental factors for any arbitrary
(lat, lon) coordinate on the Moon or Mars. Uses a pre-binned orbital lookup
grid (backend/data/planetary_targets.csv via scipy.spatial.cKDTree) when
available, and seamlessly falls back to continuous planetary physics and
curated orbital province / pit catalogs so all 10 factors are always returned
with zero missing values.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_TARGETS_CSV = DATA_DIR / "planetary_targets.csv"

MOON_RADIUS_KM = 1737.4
MARS_RADIUS_KM = 3389.5

TEN_FACTORS: Tuple[str, ...] = (
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

KNOWN_LUNAR_LANDMARKS: List[Dict[str, Any]] = [
    {"name": "Marius Hills Pit", "lat": 14.08, "lon": -56.77, "radius_km": 35.0, "void": 1, "lith": "basalt", "slope": 6.5, "rough": 0.60},
    {"name": "Mare Tranquillitatis Pit", "lat": 8.33, "lon": 33.22, "radius_km": 35.0, "void": 1, "lith": "basalt", "slope": 3.8, "rough": 0.40},
    {"name": "Mare Ingenii Pit", "lat": -35.95, "lon": 166.06, "radius_km": 35.0, "void": 1, "lith": "basalt", "slope": 4.5, "rough": 0.50},
    {"name": "Lacustris Pit", "lat": 49.33, "lon": 56.49, "radius_km": 35.0, "void": 1, "lith": "basalt", "slope": 5.0, "rough": 0.55},
    {"name": "Shackleton Crater Rim", "lat": -89.54, "lon": 0.00, "radius_km": 45.0, "void": 0, "lith": "anorthosite", "slope": 11.2, "rough": 1.15},
    {"name": "Malapert Massif Peak", "lat": -86.00, "lon": -2.00, "radius_km": 50.0, "void": 0, "lith": "anorthosite", "slope": 9.4, "rough": 0.95},
    {"name": "Aristarchus Plateau", "lat": 23.70, "lon": -47.40, "radius_km": 90.0, "void": 0, "lith": "basalt", "slope": 7.8, "rough": 0.85},
]

KNOWN_MARS_LANDMARKS: List[Dict[str, Any]] = [
    {"name": "Arsia Mons Caves", "lat": -9.00, "lon": -121.00, "radius_km": 150.0, "void": 1, "lith": "basalt", "slope": 8.9, "rough": 1.15, "elev": 12000.0},
    {"name": "Pavonis Mons Skylights", "lat": 0.80, "lon": -113.00, "radius_km": 120.0, "void": 1, "lith": "basalt", "slope": 8.2, "rough": 1.05, "elev": 10500.0},
    {"name": "Ascraeus Mons Pits", "lat": 11.90, "lon": -104.50, "radius_km": 120.0, "void": 1, "lith": "basalt", "slope": 8.5, "rough": 1.10, "elev": 11000.0},
    {"name": "Jezero Crater Delta", "lat": 18.38, "lon": 77.58, "radius_km": 80.0, "void": 0, "lith": "basalt", "slope": 4.6, "rough": 0.55, "elev": -2500.0},
    {"name": "Gale Crater (Aeolis Mons)", "lat": -5.40, "lon": 137.80, "radius_km": 85.0, "void": 0, "lith": "impact_breccia", "slope": 5.8, "rough": 0.70, "elev": -4500.0},
    {"name": "Arcadia Planitia Ice Sheet", "lat": 46.70, "lon": -172.00, "radius_km": 200.0, "void": 0, "lith": "aeolian_dune", "slope": 1.8, "rough": 0.25, "elev": -3900.0},
]

# Lazy cache for pre-binned orbital KD-trees keyed by (csv_path, body)
_GRID_CACHE: Dict[Tuple[str, str], Tuple[Any, List[Dict[str, Any]]]] = {}


def _normalize_coords(lat: float, lon: float) -> Tuple[float, float]:
    lat_clamped = max(-90.0, min(90.0, float(lat)))
    lon_wrapped = ((float(lon) + 180.0) % 360.0) - 180.0
    if lon_wrapped == -180.0 and float(lon) > 0:
        lon_wrapped = 180.0
    return lat_clamped, lon_wrapped


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float, radius_km: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return 2.0 * radius_km * math.asin(min(1.0, math.sqrt(a)))


def _latlon_to_unit_xyz(lat: float, lon: float) -> Tuple[float, float, float]:
    lat_r = math.radians(lat)
    lon_r = math.radians(lon)
    cos_lat = math.cos(lat_r)
    return (cos_lat * math.cos(lon_r), cos_lat * math.sin(lon_r), math.sin(lat_r))


def _load_orbital_grid(body_key: str, grid_csv: Path) -> Optional[Tuple[Any, List[Dict[str, Any]]]]:
    """Load pre-binned planetary_targets.csv and build a 3D spherical cKDTree."""
    if not grid_csv.exists():
        return None
    cache_key = (str(grid_csv.resolve()), body_key)
    if cache_key in _GRID_CACHE:
        return _GRID_CACHE[cache_key]

    try:
        from scipy.spatial import cKDTree  # type: ignore
    except ImportError:
        return None

    rows: List[Dict[str, Any]] = []
    xyz: List[Tuple[float, float, float]] = []
    with grid_csv.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            row_body = (row.get("body") or row.get("planet") or "").strip().lower()
            if row_body != body_key:
                continue
            try:
                rlat = float(row["lat"])
                rlon = float(row["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            rows.append(row)
            xyz.append(_latlon_to_unit_xyz(rlat, rlon))

    if not rows:
        return None

    tree = cKDTree(xyz)
    _GRID_CACHE[cache_key] = (tree, rows)
    return tree, rows


def _resolve_moon_physics(lat: float, lon: float) -> Dict[str, Any]:
    lat_rad = math.radians(lat)
    abs_lat = abs(lat)

    # 1. Atmospheric Pressure & Wind (Lunar hard vacuum)
    pressure_kpa = 0.0
    wind_speed_ms = 0.0

    # 2. Solar Irradiance: Solar constant 1361 W/m^2 (~8.5 kWh/m^2/day at equator)
    solar_kwh = max(0.0, 8.5 * math.cos(lat_rad))
    if abs_lat > 85.0:
        solar_kwh = min(solar_kwh, 1.5)

    # 3. Surface Temperature & Diurnal Thermal Swing (clipped to Earth testbed bounds)
    if abs_lat > 80.0:
        mean_temp_c = -35.0
        temp_swing_c = 20.0
    else:
        mean_temp_c = max(-35.0, -25.0 + 35.0 * math.cos(lat_rad))
        temp_swing_c = 45.0

    # 4. Aridity / Ice Index (PSRs hold water ice; equator is vacuum-arid)
    aridity_idx = 1.00

    # 5. Geomorphology & Lithology: Lunar Maria vs. Highlands
    is_nearside = -90.0 <= lon <= 90.0
    is_mare_lat = -35.0 <= lat <= 45.0

    if is_nearside and is_mare_lat:
        lithology = "basalt"
        slope_deg = 2.8 + 0.8 * abs(math.sin(math.radians(lon * 2.0)))
        roughness_m = 0.35
        parent_biome = "Lunar Mare Basin"
    elif lat < -50.0 and (-180.0 <= lon <= 180.0):
        lithology = "anorthosite"
        slope_deg = 7.5 if abs_lat > 80.0 else 6.2
        roughness_m = 0.90
        parent_biome = "Lunar South Polar Highlands"
    else:
        lithology = "anorthosite"
        slope_deg = 6.5
        roughness_m = 0.85
        parent_biome = "Lunar Highlands / Polar Rim"

    # 6. Subsurface Void & Landmark Matching (great-circle km check)
    has_subsurface_void = 0
    micro_site_name = f"Lunar Surface ({lat:.2f}°, {lon:.2f}°)"

    for lm in KNOWN_LUNAR_LANDMARKS:
        dist_km = _haversine_km(lat, lon, lm["lat"], lm["lon"], MOON_RADIUS_KM)
        if dist_km <= lm["radius_km"]:
            micro_site_name = lm["name"]
            lithology = lm["lith"]
            slope_deg = lm["slope"]
            roughness_m = lm["rough"]
            if lm["void"] == 1:
                has_subsurface_void = 1
                temp_swing_c = 5.0
            break

    return {
        "body": "Moon",
        "parent_biome": parent_biome,
        "micro_site_name": micro_site_name,
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "slope_deg": round(slope_deg, 2),
        "mean_temp_c": round(mean_temp_c, 2),
        "temp_swing_c": round(temp_swing_c, 2),
        "aridity_ice_idx": round(aridity_idx, 2),
        "lithology_type": lithology,
        "has_subsurface_void": has_subsurface_void,
        "solar_irradiance_kwh": round(solar_kwh, 2),
        "surface_pressure_kpa": pressure_kpa,
        "surface_roughness_m": round(roughness_m, 2),
        "wind_speed_ms": wind_speed_ms,
    }


def _resolve_mars_physics(lat: float, lon: float) -> Dict[str, Any]:
    lat_rad = math.radians(lat)
    abs_lat = abs(lat)

    # 1. Topographic Elevation Approximation (MOLA Dichotomy & Volcanic Provinces)
    if -20.0 <= lat <= 0.0 and -95.0 <= lon <= -40.0:
        elevation_m = -4000.0
        lithology = "basalt"
        slope_deg = 9.5
        roughness_m = 1.25
        parent_biome = "Valles Marineris Canyon System"
    elif abs_lat < 25.0 and -130.0 <= lon <= -70.0:
        elevation_m = 7000.0
        lithology = "basalt"
        slope_deg = 7.5
        roughness_m = 1.10
        parent_biome = "Tharsis Volcanic Plateau"
    elif 10.0 <= lat <= 25.0 and 70.0 <= lon <= 90.0:
        elevation_m = -2500.0
        lithology = "basalt"
        slope_deg = 4.1
        roughness_m = 0.55
        parent_biome = "Isidis Planitia / Jezero Basin"
    elif -55.0 <= lat <= -30.0 and 45.0 <= lon <= 95.0:
        elevation_m = -6000.0
        lithology = "evaporite"
        slope_deg = 3.2
        roughness_m = 0.45
        parent_biome = "Hellas Impact Basin"
    elif lat < 0.0:
        elevation_m = 2000.0
        lithology = "impact_breccia"
        slope_deg = 5.2
        roughness_m = 0.75
        parent_biome = "Southern Cratered Highlands"
    else:
        elevation_m = -3500.0
        lithology = "aeolian_dune"
        slope_deg = 2.6
        roughness_m = 0.38
        parent_biome = "Northern Lowlands (Vastitas Borealis)"

    # 2. Subsurface Voids & Known Martian Landmarks
    has_subsurface_void = 0
    micro_site_name = f"Martian Surface ({lat:.2f}°, {lon:.2f}°)"

    for lm in KNOWN_MARS_LANDMARKS:
        dist_km = _haversine_km(lat, lon, lm["lat"], lm["lon"], MARS_RADIUS_KM)
        if dist_km <= lm["radius_km"]:
            micro_site_name = lm["name"]
            lithology = lm["lith"]
            slope_deg = lm["slope"]
            roughness_m = lm["rough"]
            elevation_m = lm["elev"]
            if lm["void"] == 1:
                has_subsurface_void = 1
            break

    # 3. Atmospheric Pressure: Barometric Scale Height (P0 = 0.61 kPa, H = 11.1 km)
    pressure_kpa = 0.61 * math.exp(-elevation_m / 11100.0)

    # 4. Solar Irradiance (Mars 1.52 AU solar constant: ~3.8 kWh/m^2/day at equator)
    solar_kwh = max(0.0, 3.8 * math.cos(lat_rad))

    # 5. Temperature & Thermal Swing (Clipped to operational test bounds)
    mean_temp_c = max(-35.0, -15.0 - (45.0 * (abs_lat / 90.0)))
    temp_swing_c = 10.0 if has_subsurface_void else 45.0

    # 6. Aridity / Cryogenic Permafrost (Subsurface ground ice beyond 50 deg latitude)
    aridity_idx = 0.95 if abs_lat < 50.0 else 0.99

    # 7. Surface Wind Speed (Viking/Curiosity baseline: 2.0 to 7.0 m/s)
    wind_speed_ms = round(4.5 + 2.5 * math.sin(math.radians(abs_lat * 2.0)), 2)

    return {
        "body": "Mars",
        "parent_biome": parent_biome,
        "micro_site_name": micro_site_name,
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "slope_deg": round(slope_deg, 2),
        "mean_temp_c": round(mean_temp_c, 2),
        "temp_swing_c": round(temp_swing_c, 2),
        "aridity_ice_idx": round(aridity_idx, 2),
        "lithology_type": lithology,
        "has_subsurface_void": has_subsurface_void,
        "solar_irradiance_kwh": round(solar_kwh, 2),
        "surface_pressure_kpa": round(pressure_kpa, 2),
        "surface_roughness_m": round(roughness_m, 2),
        "wind_speed_ms": wind_speed_ms,
    }


def resolve_planetary_coordinate(
    body: str,
    lat: float,
    lon: float,
    grid_csv: Optional[Path] = DEFAULT_TARGETS_CSV,
) -> Dict[str, Any]:
    """Resolve all 10 geotechnical and environmental factors for ANY Moon/Mars coordinate.

    If a pre-binned orbital lookup CSV (planetary_targets.csv) is present,
    snaps to the nearest orbital grid cell via cKDTree and fills any missing
    factors from the continuous planetary physics baseline.
    """
    body_key = body.strip().lower()
    if body_key not in ("moon", "mars"):
        raise ValueError(f"Unsupported planetary body '{body}'. Expected 'Moon' or 'Mars'.")

    lat_norm, lon_norm = _normalize_coords(lat, lon)
    physics_result = (
        _resolve_moon_physics(lat_norm, lon_norm)
        if body_key == "moon"
        else _resolve_mars_physics(lat_norm, lon_norm)
    )

    if grid_csv is not None:
        loaded = _load_orbital_grid(body_key, grid_csv)
        if loaded is not None:
            tree, rows = loaded
            _, idx = tree.query(_latlon_to_unit_xyz(lat_norm, lon_norm))
            snapped = rows[int(idx)]
            for key in ("parent_biome", "micro_site_name"):
                if snapped.get(key):
                    physics_result[key] = str(snapped[key])
            for factor in TEN_FACTORS:
                raw_val = snapped.get(factor)
                if raw_val is None or str(raw_val).strip() == "":
                    continue
                if factor == "lithology_type":
                    physics_result[factor] = str(raw_val).strip()
                elif factor == "has_subsurface_void":
                    physics_result[factor] = int(float(raw_val))
                else:
                    physics_result[factor] = round(float(raw_val), 2)
            physics_result["snapped_lat"] = round(float(snapped["lat"]), 4)
            physics_result["snapped_lon"] = round(float(snapped["lon"]), 4)

    return physics_result


def generate_planetary_grid(
    step_deg: float = 5.0,
    output_csv: Path = DEFAULT_TARGETS_CSV,
) -> int:
    """Generate a pre-binned global Moon + Mars grid CSV with all 10 factors."""
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "target_id",
        "body",
        "parent_biome",
        "micro_site_name",
        "lat",
        "lon",
        *TEN_FACTORS,
    ]
    rows: List[Dict[str, Any]] = []
    lat_vals = [round(-87.5 + i * step_deg, 3) for i in range(int(180.0 / step_deg))]
    lon_vals = [round(-177.5 + j * step_deg, 3) for j in range(int(360.0 / step_deg))]

    for body in ("Moon", "Mars"):
        counter = 1
        for lat_v in lat_vals:
            if not (-90.0 <= lat_v <= 90.0):
                continue
            for lon_v in lon_vals:
                if not (-180.0 <= lon_v <= 180.0):
                    continue
                rec = resolve_planetary_coordinate(body, lat_v, lon_v, grid_csv=None)
                rec["target_id"] = f"{body.upper()}_{counter:05d}"
                rows.append(rec)
                counter += 1

    with output_csv.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    _GRID_CACHE.clear()
    return len(rows)


def _main() -> None:
    parser = argparse.ArgumentParser(description="Resolve Moon/Mars 10-factor conditions.")
    parser.add_argument("--body", default="Moon", choices=["Moon", "Mars", "moon", "mars"])
    parser.add_argument("--lat", type=float, default=-89.5)
    parser.add_argument("--lon", type=float, default=12.4)
    parser.add_argument("--generate-grid", action="store_true", help="Pre-bin Moon & Mars grid to planetary_targets.csv")
    parser.add_argument("--step-deg", type=float, default=5.0, help="Grid step in degrees when generating grid")
    args = parser.parse_args()

    if args.generate_grid:
        count = generate_planetary_grid(step_deg=args.step_deg)
        print(f"Generated {count} pre-binned Moon/Mars rows in {DEFAULT_TARGETS_CSV}")
        return

    res = resolve_planetary_coordinate(args.body, args.lat, args.lon)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    _main()
