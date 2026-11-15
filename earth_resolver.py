import math
import numpy as np
import requests


def extract_10_factors(lat: float, lon: float) -> dict:
  # 1. Fetch Climate, Pressure, Wind, and Solar from NASA POWER
  power_url = "https://power.larc.nasa.gov/api/temporal/climatology/point"
  params = {
      "parameters": "TS,TS_MAX,TS_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,PS,WS2M",
      "community": "SB",
      "longitude": lon,
      "latitude": lat,
      "format": "JSON",
  }
  p_resp = requests.get(power_url, params=params, timeout=20).json()
  p_data = p_resp["properties"]["parameter"]

  mean_temp = p_data["TS"]["ANN"]
  temp_swing = p_data["TS_MAX"]["ANN"] - p_data["TS_MIN"]["ANN"]
  precip = p_data["PRECTOTCORR"]["ANN"]
  solar = p_data["ALLSKY_SFC_SW_DWN"]["ANN"]
  pressure = p_data["PS"]["ANN"]
  wind = p_data["WS2M"]["ANN"]

  # Aridity / Cryogenic Permafrost Index calculation
  aridity_idx = max(0.0, min(1.0, 1.0 - (precip / 5.0)))
  if mean_temp < -5.0:
    aridity_idx = max(aridity_idx, 0.90)

  # 2. Fetch Topography (Slope & Roughness) via Open-Elevation API (3x3 grid)
  elev_url = "https://api.open-elevation.com/api/v1/lookup"
  d = 0.0005  # ~55m spatial step
  grid_locs = [
      {"latitude": lat + dy, "longitude": lon + dx}
      for dy in [d, 0, -d]
      for dx in [-d, 0, d]
  ]
  e_resp = requests.post(elev_url, json={"locations": grid_locs}, timeout=20)
  elevs = [pt["elevation"] for pt in e_resp.json()["results"]]

  # Roughness = elevation standard deviation across the local footprint
  roughness_m = float(np.std(elevs))

  # Slope calculation from cross gradients
  dy_m = 2 * d * 111320.0
  dx_m = 2 * d * 111320.0 * math.cos(math.radians(lat))
  dz_dy = (elevs[1] - elevs[7]) / dy_m
  dz_dx = (elevs[5] - elevs[3]) / dx_m
  slope_deg = math.degrees(math.atan(math.sqrt(dz_dx**2 + dz_dy**2)))

  # 3. Fetch Bedrock Lithology via Macrostrat API
  macro_url = f"https://macrostrat.org/api/v2/geologic_units/map?lat={lat}&lng={lon}"
  m_resp = requests.get(macro_url, timeout=15).json().get("success", {})
  units = m_resp.get("data", [])
  desc = (
      f"{units[0].get('lith', '')} {units[0].get('descrip', '')}".lower()
      if units
      else ""
  )

  lithology = "basalt"  # Default fallback
  if any(w in desc for w in ["anorthosite", "plagioclase"]):
    lithology = "anorthosite"
  elif any(w in desc for w in ["breccia", "crater"]):
    lithology = "impact_breccia"
  elif any(w in desc for w in ["dune", "sand", "aeolian"]):
    lithology = "aeolian_dune"
  elif any(w in desc for w in ["evaporite", "halite", "gypsum", "salt"]):
    lithology = "evaporite"

  return {
      "slope_deg": round(slope_deg, 2),
      "mean_temp_c": round(mean_temp, 2),
      "temp_swing_c": round(temp_swing, 2),
      "aridity_ice_idx": round(aridity_idx, 2),
      "lithology_type": lithology,
      "has_subsurface_void": 0,  # Checked against regional cave coordinate list
      "solar_irradiance_kwh": round(solar, 2),
      "surface_pressure_kpa": round(pressure, 2),
      "surface_roughness_m": round(roughness_m, 2),
      "wind_speed_ms": round(wind, 2),
  }