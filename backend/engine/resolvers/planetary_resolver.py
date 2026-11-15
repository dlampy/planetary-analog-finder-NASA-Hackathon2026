"""
backend/engine/resolvers/planetary_resolver.py
Unified dispatcher routing coordinate queries to Moon or Mars engines.
"""
import math
from typing import Dict, Any
from .moon_resolver import resolve_moon
from .mars_resolver import resolve_mars


def _ensure_preprocessor_keys(profile: Dict[str, Any], lat: float) -> Dict[str, Any]:
    """Ensure shared_17 contains all keys expected by preprocessor.ACTIVE_FEATURES
    and aligns thermal inertia units with the official merged_earth_features_clean.csv scale.
    """
    shared = profile.get("shared_17", {})
    body = profile.get("body", "Moon")
    if "temp_swing_c" not in shared:
        max_t = float(shared.get("max_surface_temp_c", 0.0))
        min_t = float(shared.get("min_surface_temp_c", 0.0))
        shared["temp_swing_c"] = round(max(0.0, max_t - min_t), 2)
    if "solar_irradiance_kwh" not in shared:
        exclusive = profile.get("exclusive", {})
        illum = float(exclusive.get("solar_illumination_fraction", max(0.05, math.cos(math.radians(lat)))))
        base_kwh = 5.8 if body == "Moon" else 3.2
        shared["solar_irradiance_kwh"] = round(base_kwh * illum, 2)
    if "vegetation_cover_pct" not in shared:
        shared["vegetation_cover_pct"] = 0.0
    if "soil_moisture_fraction" not in shared:
        shared["soil_moisture_fraction"] = 0.0
    if "mean_annual_precipitation_mm" not in shared:
        shared["mean_annual_precipitation_mm"] = 0.0
    if "permafrost_presence" not in shared:
        has_ice = float(shared.get("water_ice_presence", 0.0)) >= 0.5
        mean_t = float(shared.get("mean_surface_temp_c", 0.0))
        shared["permafrost_presence"] = 1 if (has_ice and mean_t < 0.0) else 0
    if float(shared.get("surface_thermal_inertia", 0.0)) > 30.0:
        shared["surface_thermal_inertia"] = 26.0 if body == "Moon" else 22.0
    profile["shared_17"] = shared
    return profile


def resolve_planetary_point(body: str, lat: float, lon: float, clip_for_knn: bool = False) -> Dict[str, Any]:
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        raise ValueError(f"Coordinates out of bounds: lat={lat}, lon={lon}")

    clean_body = body.strip().capitalize()

    if clean_body == "Moon":
        return _ensure_preprocessor_keys(resolve_moon(lat=lat, lon=lon, clip_for_knn=clip_for_knn), lat)
    elif clean_body == "Mars":
        return _ensure_preprocessor_keys(resolve_mars(lat=lat, lon=lon, clip_for_knn=clip_for_knn), lat)
    else:
        raise ValueError(f"Unsupported planetary body '{body}'. Must be 'Moon' or 'Mars'.")