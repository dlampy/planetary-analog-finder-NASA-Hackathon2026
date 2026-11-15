import math
from typing import Dict, Any

MARTIAN_CAVES = [
    (-9.0, -121.0),  # Arsia Mons Skylights
    (0.8, -113.0),   # Pavonis Mons
]

def resolve_mars(lat: float, lon: float, clip_for_knn: bool = False) -> Dict[str, Any]:
    abs_lat = abs(lat)
    lat_rad = math.radians(lat)
    cos_lat = max(0.0, math.cos(lat_rad))

    is_polar_cap = abs_lat >= 75.0
    is_tharsis = (-20.0 <= lat <= 30.0) and (-145.0 <= lon <= -90.0)
    is_lowlands = (lat > 25.0) and not is_tharsis

    # 1. 17 Shared Factors
    if is_polar_cap:
        elevation_m = -3200.0 if lat > 0 else 2800.0
        mean_slope_deg = 2.8
        roughness_m = 0.38
        terrain_type = "polar_ice_cap"
        lithology = "evaporite"
        basalt_pct = 25.0
        mineral_class = "sulfate_evaporite"
        albedo = 0.38
        thermal_inertia = 140.0
    elif is_tharsis:
        elevation_m = 8500.0
        mean_slope_deg = 7.5
        roughness_m = 0.82
        terrain_type = "volcanic_plain"
        lithology = "basalt"
        basalt_pct = 90.0
        mineral_class = "silicate"
        albedo = 0.27
        thermal_inertia = 95.0
    elif is_lowlands:
        elevation_m = -3800.0
        mean_slope_deg = 1.9
        roughness_m = 0.28
        terrain_type = "aeolian_desert"
        lithology = "aeolian_dune"
        basalt_pct = 62.0
        mineral_class = "silicate"
        albedo = 0.21
        thermal_inertia = 210.0
    else:
        elevation_m = 2000.0
        mean_slope_deg = 4.8
        roughness_m = 0.64
        terrain_type = "crater_rim"
        lithology = "impact_breccia"
        basalt_pct = 58.0
        mineral_class = "phyllosilicate_clay"
        albedo = 0.17
        thermal_inertia = 265.0

    raw_mean_t = -115.0 + 62.0 * cos_lat
    swing_half = 36.0 * cos_lat + 10.0
    raw_min_t = raw_mean_t - swing_half
    raw_max_t = raw_mean_t + swing_half

    mean_t = max(-40.0, min(50.0, raw_mean_t)) if clip_for_knn else raw_mean_t
    min_t = max(-60.0, min(35.0, raw_min_t)) if clip_for_knn else raw_min_t
    max_t = max(-25.0, min(60.0, raw_max_t)) if clip_for_knn else raw_max_t

    water_ice = 1 if abs_lat >= 45.0 else 0
    ice_pct = round(min(95.0, (abs_lat - 40.0) * 2.0), 1) if water_ice else 0.0
    has_void = int(any(math.hypot(lat - plat, lon - plon) <= 2.5 for plat, plon in MARTIAN_CAVES))
    wind_m_s = round(4.5 + 2.5 * math.sin(abs_lat * 2.0), 2)

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
        "dust_cover_class": "high" if is_tharsis else "moderate",
        "surface_albedo": albedo,
        "has_subsurface_void": has_void,
        "mean_wind_speed_m_s": wind_m_s,
    }

    # 2. Mars-Exclusive Factors (Barometric scale-height: P(z) = 610 * exp(-z / 11100))
    pressure_pa = round(610.0 * math.exp(-elevation_m / 11100.0), 1)

    exclusive_mars = {
        "mean_atmospheric_pressure_pa": pressure_pa,
        "seasonal_co2_ice_presence": int(abs_lat >= 65.0),
        "hydrated_mineral_presence": int(mineral_class in ["phyllosilicate_clay", "sulfate_evaporite"]),
        "dust_devil_activity_index": "high" if abs_lat < 30.0 else "low",
        "atmosphere_composition": "95%_CO2_trace_N2_Ar",
    }

    return {"body": "Mars", "lat": lat, "lon": lon, "shared_17": shared_17, "exclusive": exclusive_mars}