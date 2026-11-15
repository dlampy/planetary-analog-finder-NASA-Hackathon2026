import math
from typing import Dict, Any

LUNAR_PITS = [
    (14.08, -56.77),   # Marius Hills Pit
    (8.33, 33.22),     # Mare Tranquillitatis Pit
    (-35.95, 166.06),  # Mare Ingenii Pit
]

def resolve_moon(lat: float, lon: float, clip_for_knn: bool = False) -> Dict[str, Any]:
    abs_lat = abs(lat)
    lat_rad = math.radians(lat)
    cos_lat = max(0.0, math.cos(lat_rad))
    is_polar_psr = abs_lat >= 82.0
    is_nearside_mare = (-20.0 <= lat <= 55.0) and (-65.0 <= lon <= 60.0)

    # 1. 17 Shared Factors
    if is_polar_psr:
        elevation_m = 1800.0
        mean_slope_deg = 7.2
        roughness_m = 0.85
        terrain_type = "crater_rim"
        lithology = "anorthosite"
        basalt_pct = 5.0
        mineral_class = "feldspar"
        raw_mean_t, raw_min_t, raw_max_t = -205.0, -240.0, -150.0
        water_ice = 1
        ice_pct = 12.0
        albedo = 0.16
        thermal_inertia = 55.0
    elif is_nearside_mare:
        elevation_m = -1800.0
        mean_slope_deg = 2.4
        roughness_m = 0.34
        terrain_type = "volcanic_plain"
        lithology = "basalt"
        basalt_pct = 86.0
        mineral_class = "silicate"
        raw_max_t = -140.0 + 261.0 * (cos_lat ** 0.25)
        raw_min_t = -195.0 + 22.0 * cos_lat
        raw_mean_t = 0.45 * raw_max_t + 0.55 * raw_min_t
        water_ice, ice_pct = 0, 0.0
        albedo = 0.08
        thermal_inertia = 72.0
    else:
        elevation_m = 1200.0
        mean_slope_deg = 5.8
        roughness_m = 0.72
        terrain_type = "crater_rim"
        lithology = "anorthosite"
        basalt_pct = 10.0
        mineral_class = "feldspar"
        raw_max_t = -140.0 + 261.0 * (cos_lat ** 0.25)
        raw_min_t = -195.0 + 22.0 * cos_lat
        raw_mean_t = 0.45 * raw_max_t + 0.55 * raw_min_t
        water_ice, ice_pct = 0, 0.0
        albedo = 0.15
        thermal_inertia = 55.0

    mean_t = max(-40.0, min(50.0, raw_mean_t)) if clip_for_knn else raw_mean_t
    min_t = max(-60.0, min(35.0, raw_min_t)) if clip_for_knn else raw_min_t
    max_t = max(-25.0, min(60.0, raw_max_t)) if clip_for_knn else raw_max_t

    has_void = int(any(math.hypot(lat - plat, lon - plon) <= 2.0 for plat, plon in LUNAR_PITS))

    shared_17 = {
        "elevation_m": elevation_m,
        "mean_slope_deg": mean_slope_deg,
        "terrain_roughness_m": roughness_m,
        "terrain_type": terrain_type,
        "dominant_lithology": lithology,
        "basalt_fraction_pct": basalt_pct,
        "surface_mineral_class": mineral_class,
        "surface_thermal_inertia": thermal_inertia,
        "mean_surface_temp_c": round(mean_t, 2),
        "min_surface_temp_c": round(min_t, 2),
        "max_surface_temp_c": round(max_t, 2),
        "water_ice_presence": water_ice,
        "surface_ice_fraction_pct": ice_pct,
        "dust_cover_class": "moderate",
        "surface_albedo": albedo,
        "has_subsurface_void": has_void,
        "mean_wind_speed_m_s": 0.0,
    }

    # 2. Moon-Exclusive Factors (for Engineering Testbed Protocols)
    exclusive_moon = {
        "permanently_shadowed_region": int(is_polar_psr),
        "solar_illumination_fraction": 0.85 if is_polar_psr else round(cos_lat * 0.5, 2),
        "regolith_thickness_m": 4.5 if is_nearside_mare else 11.0,
        "surface_atmospheric_pressure_pa": 0.0,
        "atmosphere_composition": "hard_vacuum",
    }

    return {"body": "Moon", "lat": lat, "lon": lon, "shared_17": shared_17, "exclusive": exclusive_moon}