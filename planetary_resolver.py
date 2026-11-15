import math


def resolve_planetary_coordinate(body: str, lat: float, lon: float) -> dict:
  """Resolves the 10 geotechnical and environmental factors for ANY clicked

  coordinate on the Moon or Mars using orbital data baselines and planetary
  physics.
  """
  body_key = body.strip().lower()
  lat_rad = math.radians(lat)
  abs_lat = abs(lat)

  # Standardize longitude to [-180, 180]
  if lon > 180.0:
    lon -= 360.0

  if body_key == "moon":
    # 1. Atmospheric Pressure & Wind (Lunar hard vacuum)
    pressure_kpa = 0.0
    wind_speed_ms = 0.0

    # 2. Solar Irradiance: Solar constant 1361 W/m^2 (~8.5 kWh/m^2/day at equator)
    solar_kwh = max(0.0, 8.5 * math.cos(lat_rad))
    if abs_lat > 85.0:
      solar_kwh = min(solar_kwh, 1.5)  # Polar crater rim grazing light

    # 3. Surface Temperature & Diurnal Thermal Swing
    # Clipped to Earth operational analog test bounds (-35C floor, 45C swing max)
    if abs_lat > 80.0:
      mean_temp_c = -35.0  # Clipped polar cold trap (raw Diviner: -180C to -230C)
      temp_swing_c = 20.0  # Low thermal variation in polar craters
    else:
      mean_temp_c = max(-35.0, -25.0 + 35.0 * math.cos(lat_rad))
      temp_swing_c = 45.0  # Clipped max swing (raw Diviner: > 250C)

    # 4. Aridity / Ice Index (PSRs hold water ice; equator is vacuum-arid)
    aridity_idx = 1.00

    # 5. Geomorphology & Lithology: Lunar Maria vs. Highlands
    # Lunar Maria are predominantly on the nearside (-90 <= lon <= 90) at mid/low latitudes
    is_nearside = -90.0 <= lon <= 90.0
    is_mare_lat = -35.0 <= lat <= 45.0

    if is_nearside and is_mare_lat:
      lithology = "basalt"
      slope_deg = 2.8
      roughness_m = 0.35
      parent_biome = "Lunar Mare Basin"
    else:
      lithology = "anorthosite"
      slope_deg = 6.5
      roughness_m = 0.85
      parent_biome = "Lunar Highlands / Polar Rim"

    # 6. Subsurface Void Check: Proximity to known lunar skylights/pits (~35km buffer)
    known_lunar_pits = [
        {"name": "Marius Hills Pit", "lat": 14.08, "lon": -56.77},
        {"name": "Mare Tranquillitatis Pit", "lat": 8.33, "lon": 33.22},
        {"name": "Mare Ingenii Pit", "lat": -35.95, "lon": 166.06},
        {"name": "Lacustris Pit", "lat": 49.33, "lon": 56.49},
    ]
    has_subsurface_void = 0
    micro_site_name = f"Lunar Surface ({lat:.2f}°, {lon:.2f}°)"

    for pit in known_lunar_pits:
      # Simple Euclidean degree distance approximation (1 deg ~ 30.3 km on Moon)
      dist = math.hypot(lat - pit["lat"], lon - pit["lon"])
      if dist < 1.2:
        has_subsurface_void = 1
        lithology = "basalt"
        temp_swing_c = 5.0  # Constant subterranean thermal buffer
        micro_site_name = pit["name"]
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

  elif body_key == "mars":
    # 1. Topographic Elevation Approximation (MOLA Dichotomy & Volcanic Provinces)
    if abs_lat < 25.0 and -130.0 <= lon <= -70.0:
      elevation_m = 7000.0  # Tharsis Volcanic Rise
      lithology = "basalt"
      slope_deg = 7.5
      roughness_m = 1.10
      parent_biome = "Tharsis Volcanic Plateau"
    elif 10.0 <= lat <= 25.0 and 70.0 <= lon <= 90.0:
      elevation_m = -2500.0  # Isidis / Jezero Delta Basin
      lithology = "basalt"
      slope_deg = 4.1
      roughness_m = 0.55
      parent_biome = "Isidis Planitia / Jezero Basin"
    elif lat < 0.0:
      elevation_m = 2000.0  # Ancient Southern Cratered Highlands
      lithology = "impact_breccia"
      slope_deg = 5.2
      roughness_m = 0.75
      parent_biome = "Southern Cratered Highlands"
    else:
      elevation_m = -3500.0  # Smooth Northern Lowlands
      lithology = "aeolian_dune"
      slope_deg = 2.6
      roughness_m = 0.38
      parent_biome = "Northern Lowlands (Vastitas Borealis)"

    # 2. Atmospheric Pressure: Barometric Scale Height (P0 = 0.61 kPa, H = 11.1 km)
    pressure_kpa = 0.61 * math.exp(-elevation_m / 11100.0)

    # 3. Solar Irradiance (Mars 1.52 AU solar constant: ~3.8 kWh/m^2/day at equator)
    solar_kwh = max(0.0, 3.8 * math.cos(lat_rad))

    # 4. Temperature & Thermal Swing (Clipped to operational test bounds)
    mean_temp_c = max(-35.0, -15.0 - (45.0 * (abs_lat / 90.0)))
    temp_swing_c = 45.0  # Clipped operational max swing (raw ~60C)

    # 5. Aridity / Cryogenic Permafrost (Subsurface ground ice beyond 50° latitude)
    aridity_idx = 0.95 if abs_lat < 50.0 else 0.99

    # 6. Surface Wind Speed (Viking/Curiosity baseline: 4.0 to 8.0 m/s)
    wind_speed_ms = round(4.5 + 2.5 * math.sin(abs_lat * 2), 2)

    # 7. Subsurface Voids: Proximity to known volcanic collapse pits / caves
    known_mars_pits = [
        {"name": "Arsia Mons Caves", "lat": -9.0, "lon": -121.0},
        {"name": "Pavonis Mons Skylights", "lat": 0.8, "lon": -113.0},
        {"name": "Ascraeus Mons Pits", "lat": 11.9, "lon": -104.5},
    ]
    has_subsurface_void = 0
    micro_site_name = f"Martian Surface ({lat:.2f}°, {lon:.2f}°)"

    for pit in known_mars_pits:
      if math.hypot(lat - pit["lat"], lon - pit["lon"]) < 2.5:
        has_subsurface_void = 1
        micro_site_name = pit["name"]
        break

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


# -------------------------------------------------------------------
# Test with random user clicks:
# -------------------------------------------------------------------
if __name__ == "__main__":
  # 1. User clicks somewhere on the Lunar South Pole
  click_1 = resolve_planetary_coordinate("Moon", lat=-89.5, lon=12.4)
  print("User Click 1 (Moon Pole):")
  print(click_1)

  # 2. User clicks somewhere in the Martian Northern Lowlands
  click_2 = resolve_planetary_coordinate("Mars", lat=42.1, lon=-15.3)
  print("\nUser Click 2 (Mars Lowlands):")
  print(click_2)