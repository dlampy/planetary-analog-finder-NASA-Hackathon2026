"""
backend/engine/planetary_resolver.py
Unified dispatcher routing coordinate queries to 100-zone Moon & Mars grids (cKDTree)
with feature enrichment for preprocessor.ACTIVE_FEATURES.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, Optional
import pandas as pd
from scipy.spatial import cKDTree

# Robust data directory discovery
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR.parent / "data"
if not DATA_DIR.exists():
    DATA_DIR = BASE_DIR / "data"


class PlanetaryZoneLookup:
    """Caches 100-zone planetary datasets and provides <1 ms spatial coordinate snapping."""

    def __init__(self, data_dir: Path = DATA_DIR):
        self.data_dir = data_dir
        self.dfs: Dict[str, pd.DataFrame] = {}
        self.trees: Dict[str, cKDTree] = {}
        self._load_datasets()

    def _load_datasets(self) -> None:
        file_mapping = {
            "Moon": ["Moon.csv", "moon_zones_100_populated.csv"],
            "Mars": ["mars.csv", "mars_zones_100_populated.csv"],
        }
        for body, filenames in file_mapping.items():
            for fname in filenames:
                path = self.data_dir / fname
                if path.exists():
                    df = pd.read_csv(path)
                    lat_col = "latitude" if "latitude" in df.columns else "lat"
                    lon_col = "longitude" if "longitude" in df.columns else "lon"
                    self.dfs[body] = df
                    self.trees[body] = cKDTree(df[[lat_col, lon_col]].values)
                    break

    def get_zone_for_point(self, body: str, lat: float, lon: float) -> Dict[str, Any]:
        clean_body = body.strip().capitalize()
        if clean_body not in self.dfs or clean_body not in self.trees:
            # Fallback to analytical physics if CSV missing
            return self._fallback_analytical_resolve(clean_body, lat, lon)

        df = self.dfs[clean_body]
        tree = self.trees[clean_body]

        dist, idx = tree.query([lat, lon])
        row = df.iloc[idx].to_dict()

        lat_col = "latitude" if "latitude" in row else "lat"
        lon_col = "longitude" if "longitude" in row else "lon"

        shared_17 = {
            "elevation_m": float(row.get("elevation_m", 0.0)),
            "mean_slope_deg": float(row.get("mean_slope_deg", 0.0)),
            "terrain_roughness_m": float(row.get("terrain_roughness_m", 0.0)),
            "terrain_type": str(row.get("terrain_type", "crater_rim")),
            "dominant_lithology": str(row.get("dominant_lithology", "anorthosite")),
            "basalt_fraction_pct": float(row.get("basalt_fraction_pct", 0.0)),
            "surface_mineral_class": str(row.get("surface_mineral_class", "feldspar")),
            "surface_thermal_inertia": float(row.get("surface_thermal_inertia", 50.0)),
            "mean_surface_temp_c": float(row.get("mean_surface_temp_c", -50.0)),
            "min_surface_temp_c": float(row.get("min_surface_temp_c", -100.0)),
            "max_surface_temp_c": float(row.get("max_surface_temp_c", 0.0)),
            "water_ice_presence": int(row.get("water_ice_presence", 0)),
            "surface_ice_fraction_pct": float(row.get("surface_ice_fraction_pct", 0.0)),
            "dust_cover_class": str(row.get("dust_cover_class", "moderate")),
            "surface_albedo": float(row.get("surface_albedo", 0.15)),
            "has_subsurface_void": int(row.get("has_subsurface_void", 0)),
            "mean_wind_speed_m_s": float(row.get("mean_wind_speed_m_s", 0.0)),
        }

        return {
            "body": clean_body,
            "site_id": str(row.get("site_id", "")),
            "site_name": str(row.get("site_name", f"{clean_body} Zone")),
            "lat": float(row.get(lat_col, lat)),
            "lon": float(row.get(lon_col, lon)),
            "shared_17": shared_17,
            "exclusive": {
                "snapped_distance_deg": round(float(dist), 2),
                "target_zone_id": str(row.get("site_id", "")),
                "solar_illumination_fraction": max(0.05, math.cos(math.radians(lat))),
            },
        }

    def _fallback_analytical_resolve(self, body: str, lat: float, lon: float) -> Dict[str, Any]:
        try:
            if body == "Moon":
                from .resolvers.moon_resolver import resolve_moon
                return resolve_moon(lat=lat, lon=lon)
            else:
                from .resolvers.mars_resolver import resolve_mars
                return resolve_mars(lat=lat, lon=lon)
        except ImportError:
            raise FileNotFoundError(
                f"Neither {body}.csv in {self.data_dir} nor analytical {body.lower()}_resolver.py was found."
            )


# Global instance
_LOOKUP = PlanetaryZoneLookup()


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
    raw_profile = _LOOKUP.get_zone_for_point(clean_body, lat, lon)
    return _ensure_preprocessor_keys(raw_profile, lat)