"""Feature normalization, categorical compatibility scoring, and weight preprocessing
across all 17 shared planetary/terrestrial factors.
"""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple
import numpy as np
import pandas as pd

DATA_DIR: Path = Path(__file__).resolve().parent.parent / "data"
OFFICIAL_EARTH_CSV: str = "merged_earth_features_clean.csv"
LEGACY_EARTH_CSV: str = "earth_sites_1000.csv"

# ---------------------------------------------------------------------------
# 1. FEATURE METADATA & OPERATIONAL CLIPPING BOUNDS (17 FACTORS)
# ---------------------------------------------------------------------------
# Add inside backend/engine/preprocessor.py

DOMAIN_BUCKETS: Dict[str, List[str]] = {
    "topography": [
        "elevation_m",
        "mean_slope_deg",
        "terrain_roughness_m",
        "has_subsurface_void",
    ],
    "geology": [
        "dominant_lithology",
        "surface_mineral_class",
        "basalt_fraction_pct",
        "dust_cover_class",
    ],
    "thermal": [
        "mean_surface_temp_c",
        "min_surface_temp_c",
        "max_surface_temp_c",
        "temp_swing_c",
        "surface_thermal_inertia",
        "surface_albedo",
        "solar_irradiance_kwh",
    ],
    "cryosphere": [
        "water_ice_presence",
        "surface_ice_fraction_pct",
    ],
}


def apply_domain_bucket_budgets(
    raw_feature_weights: Dict[str, float],
    domain_budgets: Dict[str, float] | None = None,
) -> Dict[str, float]:
    """Optional engine helper: enforces domain-level weight budgets in memory
    so collinear columns (like the 4 temperature metrics) never overpower
    other domains when users customize weights in the UI.
    """
    if not domain_budgets:
        total = sum(max(0.0, float(v)) for v in raw_feature_weights.values())
        if total <= 0.0:
            return {c: 1.0 / len(ACTIVE_FEATURES) for c in ACTIVE_FEATURES}
        return {c: round(max(0.0, float(raw_feature_weights.get(c, 0.0))) / total, 6) for c in ACTIVE_FEATURES}

    # Normalize domain budgets to sum to 1.0
    d_total = sum(max(0.0, float(v)) for v in domain_budgets.values())
    norm_domains = {
        d: (max(0.0, float(v)) / d_total if d_total > 0 else 0.25)
        for d, v in domain_budgets.items()
    }

    final_weights: Dict[str, float] = {}
    for domain, cols in DOMAIN_BUCKETS.items():
        budget = norm_domains.get(domain, 0.0)
        sub_sum = sum(max(0.0, float(raw_feature_weights.get(c, 0.0))) for c in cols)
        for c in cols:
            if sub_sum > 0.0:
                final_weights[c] = round(budget * (max(0.0, float(raw_feature_weights.get(c, 0.0))) / sub_sum), 6)
            else:
                final_weights[c] = round(budget / len(cols), 6)

    return final_weights

FEATURE_META: Dict[str, Dict[str, Any]] = {
    # --- Domain 1: Topography & Subsurface Shelter ---
    "elevation_m": {
        "weight_col": "w_elevation",
        "type": "numerical",
        "min": -430.0,
        "max": 6500.0,
        "label": "Elevation",
        "unit": "m",
        "domain": "topography",
    },
    "mean_slope_deg": {
        "weight_col": "w_slope",
        "type": "numerical",
        "min": 0.0,
        "max": 65.0,
        "label": "Mean Slope",
        "unit": "°",
        "domain": "topography",
    },
    "terrain_roughness_m": {
        "weight_col": "w_roughness",
        "type": "numerical",
        "min": 0.0,
        "max": 90.0,
        "label": "Terrain Roughness",
        "unit": "m",
        "domain": "topography",
    },
    "has_subsurface_void": {
        "weight_col": "w_void",
        "type": "binary",
        "min": 0.0,
        "max": 1.0,
        "label": "Subsurface Void / Cave",
        "unit": "flag",
        "domain": "topography",
    },
    # --- Domain 2: Geology, Mineralogy & Dust ---
    "dominant_lithology": {
        "weight_col": "w_lithology",
        "type": "categorical",
        "min": 0.0,
        "max": 1.0,
        "label": "Dominant Lithology",
        "unit": "compatibility",
        "domain": "geology",
    },
    "surface_mineral_class": {
        "weight_col": "w_mineral",
        "type": "categorical",
        "min": 0.0,
        "max": 1.0,
        "label": "Surface Mineral Class",
        "unit": "compatibility",
        "domain": "geology",
    },
    "basalt_fraction_pct": {
        "weight_col": "w_basalt_pct",
        "type": "numerical",
        "min": 0.0,
        "max": 100.0,
        "label": "Basalt Fraction",
        "unit": "%",
        "domain": "geology",
    },
    "dust_cover_class": {
        "weight_col": "w_dust",
        "type": "categorical",
        "min": 0.0,
        "max": 1.0,
        "label": "Dust Cover Class",
        "unit": "compatibility",
        "domain": "geology",
    },
    # --- Domain 3: Thermal & Radiative Regime ---
    "mean_surface_temp_c": {
        "weight_col": "w_temp_mean",
        "type": "numerical",
        "min": -40.0,
        "max": 50.0,
        "label": "Mean Surface Temp",
        "unit": "°C",
        "domain": "thermal",
    },
    "min_surface_temp_c": {
        "weight_col": "w_temp_min",
        "type": "numerical",
        "min": -65.0,
        "max": 35.0,
        "label": "Min Surface Temp",
        "unit": "°C",
        "domain": "thermal",
    },
    "max_surface_temp_c": {
        "weight_col": "w_temp_max",
        "type": "numerical",
        "min": -25.0,
        "max": 65.0,
        "label": "Max Surface Temp",
        "unit": "°C",
        "domain": "thermal",
    },
    "temp_swing_c": {
        "weight_col": "w_temp_swing",
        "type": "numerical",
        "min": 0.0,
        "max": 90.0,
        "label": "Diurnal Temp Swing",
        "unit": "°C",
        "domain": "thermal",
    },
    "surface_thermal_inertia": {
        "weight_col": "w_thermal_inertia",
        "type": "numerical",
        "min": 0.0,
        "max": 30.0,
        "label": "Diurnal Thermal Index (LST Δ)",
        "unit": "°C",
        "domain": "thermal",
    },
    "surface_albedo": {
        "weight_col": "w_albedo",
        "type": "numerical",
        "min": 0.0,
        "max": 1.0,
        "label": "Surface Albedo",
        "unit": "ratio",
        "domain": "thermal",
    },
    "solar_irradiance_kwh": {
        "weight_col": "w_solar",
        "type": "numerical",
        "min": 0.0,
        "max": 12.0,
        "label": "Solar Irradiance",
        "unit": "kWh/m²/d",
        "domain": "thermal",
    },
    # --- Domain 4: Cryosphere & Volatiles ---
    "water_ice_presence": {
        "weight_col": "w_water_ice",
        "type": "binary",
        "min": 0.0,
        "max": 1.0,
        "label": "Water-Ice Presence",
        "unit": "flag",
        "domain": "cryosphere",
    },
    "surface_ice_fraction_pct": {
        "weight_col": "w_ice_aridity",
        "type": "numerical",
        "min": 0.0,
        "max": 100.0,
        "label": "Surface Ice / Aridity",
        "unit": "%",
        "domain": "cryosphere",
    },
}

ACTIVE_FEATURES: List[str] = list(FEATURE_META.keys())

# ---------------------------------------------------------------------------
# 2. PAIRWISE GEOTECHNICAL & CATEGORICAL COMPATIBILITY MATRICES
# ---------------------------------------------------------------------------
_MAJOR_CLAUSE_RE = re.compile(r"major\s*:+\s*\{([^}]+)\}", re.IGNORECASE)


def canonicalize_lithology(raw_val: Any) -> str:
    """Normalizes rich geological descriptions from merged_earth_features_clean.csv
    and resolver tags into canonical lithology tokens for matrix lookup.
    """
    s = str(raw_val or "").strip().lower()
    if not s or s in ("nan", "none", "unknown"):
        return "unknown"

    exact = {
        "basalt",
        "anorthosite",
        "impact_breccia",
        "aeolian_dune",
        "volcanic_ash",
        "evaporite",
        "granite",
        "sandstone",
        "limestone",
        "shale",
        "andesite",
        "rhyolite",
        "gneiss",
        "conglomerate",
        "siliciclastic",
    }
    if s in exact:
        return s

    m = _MAJOR_CLAUSE_RE.search(s)
    clause = m.group(1).strip().lower() if m else s

    for text in (clause, s):
        if "anorthosit" in text:
            return "anorthosite"
        if "andesit" in text:
            return "andesite"
        if "basalt" in text or "mafic" in text:
            return "basalt"
        if "rhyolit" in text:
            return "rhyolite"
        if "granit" in text:
            return "granite"
        if "impact" in text:
            return "impact_breccia"
        if "volcaniclastic" in text or "pyroclastic" in text or "ash" in text or "tuff" in text:
            return "volcanic_ash"
        if "dune" in text or "aeolian" in text:
            return "aeolian_dune"
        if "evaporit" in text or "halite" in text or "gypsum" in text:
            return "evaporite"
        if "limestone" in text or "dolostone" in text or "carbonate" in text or "chalk" in text:
            return "limestone"
        if "conglomerate" in text:
            return "conglomerate"
        if "sandstone" in text or "quartzarenite" in text or "arkose" in text or "graywacke" in text:
            return "sandstone"
        if "shale" in text or "mudstone" in text or "siltstone" in text or "bentonite" in text or "clastic" in text:
            return "shale"
        if "siliciclastic" in text:
            return "siliciclastic"
        if "gneiss" in text or "metamorphic" in text:
            return "gneiss"
        if "breccia" in text:
            return "impact_breccia"
        if "sedimentary" in text:
            return "sandstone"

    return re.sub(r"[^a-z0-9_]+", "_", clause).strip("_") or "unknown"


def canonicalize_mineral(raw_val: Any) -> str:
    """Normalizes surface mineral class strings into canonical tokens."""
    s = str(raw_val or "").strip().lower()
    if not s or s in ("nan", "none", "unknown"):
        return "unknown"
    if "volcanic" in s or "ash" in s or "pyroclastic" in s:
        return "volcanic_ash"
    if "phyllosilicate" in s or "clay" in s:
        return "phyllosilicate"
    if "carbonate" in s:
        return "carbonate"
    if "evaporite" in s or "halite" in s or "salt" in s:
        return "evaporite"
    if "sulfate" in s or "gypsum" in s:
        return "sulfate"
    if "oxide" in s:
        return "oxide"
    if "silicate" in s:
        return "silicate"
    return re.sub(r"[^a-z0-9_]+", "_", s).strip("_") or "unknown"


LITHOLOGY_MATRIX: Dict[Tuple[str, str], float] = {
    ("basalt", "basalt"): 1.00,
    ("basalt", "andesite"): 0.80,
    ("basalt", "volcanic_ash"): 0.75,
    ("basalt", "impact_breccia"): 0.65,
    ("basalt", "anorthosite"): 0.50,
    ("basalt", "rhyolite"): 0.50,
    ("basalt", "granite"): 0.45,
    ("basalt", "gneiss"): 0.40,
    ("basalt", "aeolian_dune"): 0.40,
    ("basalt", "sandstone"): 0.35,
    ("basalt", "siliciclastic"): 0.35,
    ("basalt", "conglomerate"): 0.35,
    ("basalt", "shale"): 0.30,
    ("basalt", "limestone"): 0.25,
    ("basalt", "evaporite"): 0.10,
    ("anorthosite", "anorthosite"): 1.00,
    ("anorthosite", "impact_breccia"): 0.70,
    ("anorthosite", "granite"): 0.55,
    ("anorthosite", "gneiss"): 0.55,
    ("anorthosite", "andesite"): 0.55,
    ("anorthosite", "rhyolite"): 0.50,
    ("anorthosite", "volcanic_ash"): 0.45,
    ("anorthosite", "sandstone"): 0.30,
    ("anorthosite", "siliciclastic"): 0.30,
    ("anorthosite", "aeolian_dune"): 0.25,
    ("anorthosite", "limestone"): 0.20,
    ("anorthosite", "evaporite"): 0.10,
    ("impact_breccia", "impact_breccia"): 1.00,
    ("impact_breccia", "volcanic_ash"): 0.65,
    ("impact_breccia", "andesite"): 0.60,
    ("impact_breccia", "conglomerate"): 0.60,
    ("impact_breccia", "sandstone"): 0.45,
    ("impact_breccia", "gneiss"): 0.45,
    ("volcanic_ash", "volcanic_ash"): 1.00,
    ("volcanic_ash", "andesite"): 0.75,
    ("volcanic_ash", "rhyolite"): 0.65,
    ("volcanic_ash", "aeolian_dune"): 0.50,
    ("volcanic_ash", "sandstone"): 0.40,
    ("volcanic_ash", "siliciclastic"): 0.40,
    ("volcanic_ash", "shale"): 0.35,
    ("aeolian_dune", "aeolian_dune"): 1.00,
    ("aeolian_dune", "sandstone"): 0.70,
    ("aeolian_dune", "siliciclastic"): 0.65,
    ("aeolian_dune", "evaporite"): 0.45,
    ("aeolian_dune", "shale"): 0.40,
    ("sandstone", "sandstone"): 1.00,
    ("sandstone", "siliciclastic"): 0.85,
    ("sandstone", "conglomerate"): 0.75,
    ("sandstone", "shale"): 0.65,
    ("sandstone", "limestone"): 0.45,
    ("sandstone", "evaporite"): 0.35,
    ("siliciclastic", "siliciclastic"): 1.00,
    ("siliciclastic", "shale"): 0.80,
    ("siliciclastic", "conglomerate"): 0.75,
    ("siliciclastic", "evaporite"): 0.30,
    ("shale", "shale"): 1.00,
    ("shale", "limestone"): 0.55,
    ("shale", "conglomerate"): 0.55,
    ("limestone", "limestone"): 1.00,
    ("limestone", "evaporite"): 0.45,
    ("evaporite", "evaporite"): 1.00,
    ("andesite", "andesite"): 1.00,
    ("andesite", "rhyolite"): 0.70,
    ("rhyolite", "rhyolite"): 1.00,
    ("granite", "granite"): 1.00,
    ("gneiss", "gneiss"): 1.00,
    ("conglomerate", "conglomerate"): 1.00,
}

MINERAL_MATRIX: Dict[Tuple[str, str], float] = {
    ("silicate", "silicate"): 1.00,
    ("silicate", "volcanic_ash"): 0.80,
    ("silicate", "oxide"): 0.65,
    ("silicate", "phyllosilicate"): 0.55,
    ("silicate", "sulfate"): 0.30,
    ("silicate", "carbonate"): 0.25,
    ("silicate", "evaporite"): 0.15,
    ("volcanic_ash", "volcanic_ash"): 1.00,
    ("volcanic_ash", "oxide"): 0.65,
    ("volcanic_ash", "phyllosilicate"): 0.55,
    ("volcanic_ash", "sulfate"): 0.35,
    ("volcanic_ash", "carbonate"): 0.25,
    ("volcanic_ash", "evaporite"): 0.15,
    ("oxide", "oxide"): 1.00,
    ("oxide", "sulfate"): 0.50,
    ("oxide", "phyllosilicate"): 0.50,
    ("oxide", "carbonate"): 0.35,
    ("oxide", "evaporite"): 0.20,
    ("sulfate", "sulfate"): 1.00,
    ("sulfate", "evaporite"): 0.75,
    ("sulfate", "phyllosilicate"): 0.65,
    ("sulfate", "carbonate"): 0.50,
    ("carbonate", "carbonate"): 1.00,
    ("carbonate", "evaporite"): 0.50,
    ("carbonate", "phyllosilicate"): 0.45,
    ("phyllosilicate", "phyllosilicate"): 1.00,
    ("phyllosilicate", "evaporite"): 0.25,
    ("evaporite", "evaporite"): 1.00,
}

# Ordinal mapping for dust cover classes to compute distance-based similarity
DUST_ORDINAL_MAP: Dict[str, float] = {
    "none": 0.00,
    "bare": 0.00,
    "bedrock": 0.00,
    "low": 0.25,
    "thin_veneer": 0.33,
    "moderate": 0.60,
    "regolith": 0.67,
    "high": 0.85,
    "deep_dust": 1.00,
    "dune_sand": 1.00,
}


# ---------------------------------------------------------------------------
# 3. SCALING & ENCODING FUNCTIONS
# ---------------------------------------------------------------------------
def _lookup_pairwise(
    target_val: Any, cand_val: Any, matrix: Dict[Tuple[str, str], float]
) -> float:
    """Evaluates symmetric pairwise compatibility in [0.1, 1.0]."""
    if matrix is LITHOLOGY_MATRIX:
        t_str = canonicalize_lithology(target_val)
        c_str = canonicalize_lithology(cand_val)
    elif matrix is MINERAL_MATRIX:
        t_str = canonicalize_mineral(target_val)
        c_str = canonicalize_mineral(cand_val)
    else:
        t_str = str(target_val).strip().lower()
        c_str = str(cand_val).strip().lower()
    if t_str == c_str:
        return 1.00
    if (t_str, c_str) in matrix:
        return matrix[(t_str, c_str)]
    if (c_str, t_str) in matrix:
        return matrix[(c_str, t_str)]
    return 0.10  # Tier 4 fallback for non-analogous rock/mineral classes


def _score_dust_compatibility(target_val: Any, cand_val: Any) -> float:
    """Computes compatibility between target and candidate dust cover (numeric or string)."""
    def _to_ord(v: Any) -> float:
        try:
            val = float(v)
            return np.clip(val / 100.0 if val > 1.0 else val, 0.0, 1.0)
        except (ValueError, TypeError):
            return DUST_ORDINAL_MAP.get(str(v).strip().lower(), 0.50)

    t_ord = _to_ord(target_val)
    c_ord = _to_ord(cand_val)
    return float(1.0 - abs(t_ord - c_ord))


def normalize_clipped(values: np.ndarray, col: str) -> np.ndarray:
    """Clips continuous or binary values to terrestrial bounds and scales to [0, 1]."""
    lo = float(FEATURE_META[col]["min"])
    hi = float(FEATURE_META[col]["max"])
    clipped = np.clip(values.astype(float), lo, hi)
    return (clipped - lo) / (hi - lo)


def normalize_unclipped(values: np.ndarray, col: str) -> np.ndarray:
    """Scales continuous values without clipping to preserve planetary outlier diagnostics."""
    lo = float(FEATURE_META[col]["min"])
    hi = float(FEATURE_META[col]["max"])
    return (values.astype(float) - lo) / (hi - lo)


def _mission_get(mission_row: pd.Series | Dict[str, Any], key: str, default: float = 0.0) -> float:
    val = mission_row.get(key, default) if isinstance(mission_row, dict) else mission_row.get(key, default)
    try:
        num = float(val)
        return 0.0 if math.isnan(num) else max(0.0, num)
    except (TypeError, ValueError):
        return default


def compute_mission_weights(mission_row: pd.Series | Dict[str, Any]) -> Dict[str, float]:
    """Extracts mission weights for all 17 features and normalizes them to sum to 1.0.
    Also accepts legacy 5-factor mission rows (w_slope, w_temp, w_temp_swing, w_aridity_ice, w_void).
    """
    raw: Dict[str, float] = {}
    for col in ACTIVE_FEATURES:
        w_col = FEATURE_META[col]["weight_col"]
        raw[col] = _mission_get(mission_row, w_col, 0.0)

    has_17_weights = any(
        _mission_get(mission_row, k, 0.0) > 0.0
        for k in ("w_temp_mean", "w_lithology", "w_mineral", "w_elevation", "w_ice_aridity")
    )
    if not has_17_weights and any(
        _mission_get(mission_row, k, 0.0) > 0.0
        for k in ("w_slope", "w_temp", "w_temp_swing", "w_aridity_ice", "w_void")
    ):
        w_slope = _mission_get(mission_row, "w_slope", 0.0)
        w_temp = _mission_get(mission_row, "w_temp", 0.0)
        w_swing = _mission_get(mission_row, "w_temp_swing", 0.0)
        w_arid = _mission_get(mission_row, "w_aridity_ice", 0.0)
        w_void = _mission_get(mission_row, "w_void", 0.0)

        raw["mean_slope_deg"] = 0.70 * w_slope
        raw["terrain_roughness_m"] = 0.30 * w_slope
        raw["has_subsurface_void"] = w_void
        raw["mean_surface_temp_c"] = 0.70 * w_temp
        raw["min_surface_temp_c"] = 0.15 * w_temp
        raw["max_surface_temp_c"] = 0.15 * w_temp
        raw["temp_swing_c"] = 0.60 * w_swing
        raw["surface_thermal_inertia"] = 0.40 * w_swing
        raw["surface_ice_fraction_pct"] = 0.55 * w_arid
        raw["water_ice_presence"] = 0.45 * w_arid

    total = sum(raw.values())
    if total <= 0.0:
        equal = 1.0 / len(ACTIVE_FEATURES)
        return {col: equal for col in ACTIVE_FEATURES}
    return {col: round(val / total, 6) for col, val in raw.items()}


# ---------------------------------------------------------------------------
# 4. OFFICIAL EARTH DATASET PREPROCESSING & LOADING
# ---------------------------------------------------------------------------
_KNOWN_VOLCANIC_TUBE_SITES = {
    "kilauea",
    "mount_etna",
    "galapagos_sierra_negra",
}


def format_site_name(site_id: Any) -> str:
    """Converts snake_case site_id strings into clean display titles."""
    text = str(site_id or "").strip()
    if not text:
        return "Unknown Site"
    if "_" not in text and " " in text:
        return text
    return text.replace("_", " ").title()


def infer_subsurface_void(row: pd.Series | Dict[str, Any]) -> int:
    """Returns explicit has_subsurface_void if present, else infers karst/lava-tube voids."""
    explicit = row.get("has_subsurface_void")
    if explicit is not None and not (isinstance(explicit, float) and math.isnan(explicit)):
        try:
            return 1 if float(explicit) >= 0.5 else 0
        except (TypeError, ValueError):
            pass

    sid = str(row.get("site_id", "")).strip().lower()
    if any(tok in sid for tok in ("cave", "lava_tube", "cenote")) or sid in _KNOWN_VOLCANIC_TUBE_SITES:
        return 1
    return 0


def derive_aridity_ice_idx(row: pd.Series | Dict[str, Any]) -> float:
    """Derives [0, 1] aridity/cryosphere analog index from precipitation, vegetation, and ice."""
    explicit = row.get("aridity_ice_idx")
    if explicit is not None and not (isinstance(explicit, float) and math.isnan(explicit)):
        try:
            return round(min(1.0, max(0.0, float(explicit))), 4)
        except (TypeError, ValueError):
            pass

    def _num(key: str, default: float) -> float:
        v = row.get(key, default)
        try:
            f = float(v)
            return default if math.isnan(f) else f
        except (TypeError, ValueError):
            return default

    ice_frac = min(1.0, max(0.0, _num("surface_ice_fraction_pct", 0.0) / 100.0))
    water_ice = 1.0 if _num("water_ice_presence", 0.0) >= 0.5 else 0.0
    permafrost = 1.0 if _num("permafrost_presence", 0.0) >= 0.5 else 0.0
    precip = max(0.0, _num("mean_annual_precipitation_mm", 500.0))
    veg = min(1.0, max(0.0, _num("vegetation_cover_pct", 0.0) / 100.0))

    aridity_component = max(0.0, min(1.0, 1.0 - min(precip, 2000.0) / 2000.0)) * (1.0 - 0.5 * veg)
    cryo_component = max(ice_frac, 0.75 * water_ice, 0.80 * permafrost)
    combined = 0.85 * max(aridity_component, cryo_component) + 0.15 * (1.0 - veg)
    return round(min(1.0, max(0.0, combined)), 4)


def derive_dust_cover_class(row: pd.Series | Dict[str, Any]) -> str:
    """Derives ordinal dust cover class ('none', 'low', 'moderate', 'high') for official CSV rows."""
    explicit = str(row.get("dust_cover_class", "") or "").strip().lower()
    if explicit and explicit not in ("nan", "none_missing", ""):
        return explicit

    def _num(key: str, default: float) -> float:
        v = row.get(key, default)
        try:
            f = float(v)
            return default if math.isnan(f) else f
        except (TypeError, ValueError):
            return default

    veg = _num("vegetation_cover_pct", 20.0)
    precip = _num("mean_annual_precipitation_mm", 500.0)
    ice_pct = _num("surface_ice_fraction_pct", 0.0)
    lith = canonicalize_lithology(row.get("dominant_lithology", ""))
    mineral = canonicalize_mineral(row.get("surface_mineral_class", ""))

    if ice_pct > 25.0:
        return "low"
    if veg < 15.0 and (precip < 250.0 or lith in ("volcanic_ash", "aeolian_dune", "evaporite") or mineral == "evaporite"):
        return "high" if (precip < 140.0 or lith in ("volcanic_ash", "aeolian_dune")) else "moderate"
    if veg < 35.0:
        return "moderate" if precip < 450.0 else "low"
    return "none" if veg >= 65.0 else "low"


def derive_solar_irradiance_kwh(row: pd.Series | Dict[str, Any]) -> float:
    """Estimates daily mean surface solar irradiance (kWh/m^2/day) from latitude and precipitation."""
    explicit = row.get("solar_irradiance_kwh")
    if explicit is not None and not (isinstance(explicit, float) and math.isnan(explicit)):
        try:
            return round(max(0.1, float(explicit)), 2)
        except (TypeError, ValueError):
            pass

    try:
        lat = float(row.get("latitude_deg", row.get("lat", 0.0)) or 0.0)
    except (TypeError, ValueError):
        lat = 0.0
    try:
        precip = float(row.get("mean_annual_precipitation_mm", 500.0) or 500.0)
    except (TypeError, ValueError):
        precip = 500.0

    clear_sky = 6.8 * max(0.15, math.cos(math.radians(abs(lat))))
    cloud_factor = max(0.55, 1.0 - 0.35 * min(1.0, max(0.0, precip) / 2500.0))
    return round(max(0.5, min(11.5, clear_sky * cloud_factor)), 2)


def infer_parent_biome(row: pd.Series | Dict[str, Any]) -> str:
    """Infers a human-readable geological/biome label when parent_biome is absent."""
    explicit = str(row.get("parent_biome", "") or "").strip()
    if explicit and explicit.lower() != "nan":
        return explicit

    sid = str(row.get("site_id", "")).strip().lower()
    lith = canonicalize_lithology(row.get("dominant_lithology", ""))
    mineral = canonicalize_mineral(row.get("surface_mineral_class", ""))
    void_flag = infer_subsurface_void(row)

    def _num(key: str, default: float) -> float:
        v = row.get(key, default)
        try:
            f = float(v)
            return default if math.isnan(f) else f
        except (TypeError, ValueError):
            return default

    permafrost = _num("permafrost_presence", 0.0)
    mean_temp = _num("mean_surface_temp_c", _num("mean_temp_c", 15.0))
    precip = _num("mean_annual_precipitation_mm", 500.0)
    elev = _num("elevation_m", 0.0)

    if void_flag == 1 and any(tok in sid for tok in ("cave", "lava_tube", "cenote")):
        if lith in ("basalt", "andesite", "volcanic_ash"):
            return "Volcanic Lava Tube System"
        return "Karst Subsurface System"
    if permafrost >= 0.5 or mean_temp < -2.0:
        return "Cryospheric Permafrost"
    if precip < 180.0:
        return "Hyper-Arid Evaporite Basin" if (mineral == "evaporite" or lith == "evaporite") else "Hyper-Arid Desert"
    if lith in ("basalt", "andesite", "volcanic_ash"):
        return "Volcanic Basaltic Terrain"
    if elev >= 3000.0:
        return "High-Altitude Alpine"
    if precip < 600.0:
        return "Semi-Arid Sedimentary"
    if lith == "limestone":
        return "Temperate Karst & Carbonate"
    return "Terrestrial Geologic Analog"


def preprocess_earth_dataframe(raw_df: pd.DataFrame) -> pd.DataFrame:
    """Standardizes either merged_earth_features_clean.csv or legacy 5-factor CSV rows
    so both 5-factor matching and 17-factor TOPSIS/protocol engines operate identically.
    """
    if raw_df.empty:
        return raw_df.copy()

    df = raw_df.copy()
    records = df.to_dict(orient="records")
    enriched: List[Dict[str, Any]] = []

    def _coalesce_num(rec: Dict[str, Any], *keys: str, default: float = 0.0) -> float:
        for k in keys:
            v = rec.get(k)
            if v is not None and not (isinstance(v, float) and math.isnan(v)) and str(v).strip() != "":
                try:
                    f = float(v)
                    if not math.isnan(f):
                        return f
                except (TypeError, ValueError):
                    continue
        return default

    for rec in records:
        r = dict(rec)
        sid = str(r.get("site_id", "unknown_site")).strip()
        r["site_id"] = sid

        lat = _coalesce_num(r, "latitude_deg", "lat", default=0.0)
        lon = _coalesce_num(r, "longitude_deg", "lon", default=0.0)
        r["latitude_deg"] = lat
        r["longitude_deg"] = lon
        r["lat"] = lat
        r["lon"] = lon

        slope = _coalesce_num(r, "mean_slope_deg", "slope_deg", default=0.0)
        r["mean_slope_deg"] = slope
        r["slope_deg"] = slope

        mean_temp = _coalesce_num(r, "mean_surface_temp_c", "mean_temp_c", default=15.0)
        r["mean_surface_temp_c"] = mean_temp
        r["mean_temp_c"] = mean_temp

        thermal_inertia = _coalesce_num(r, "surface_thermal_inertia", default=float("nan"))
        if math.isnan(thermal_inertia):
            thermal_inertia = _coalesce_num(r, "temp_swing_c", default=10.0)
        r["surface_thermal_inertia"] = round(thermal_inertia, 4)

        swing = _coalesce_num(r, "temp_swing_c", default=float("nan"))
        if math.isnan(swing):
            # Official CSV represents diurnal temperature variation via MODIS LST day-night delta
            swing = thermal_inertia
        r["temp_swing_c"] = round(max(0.0, swing), 4)

        min_t = _coalesce_num(r, "min_surface_temp_c", default=round(mean_temp - 0.5 * r["temp_swing_c"], 2))
        max_t = _coalesce_num(r, "max_surface_temp_c", default=round(mean_temp + 0.5 * r["temp_swing_c"], 2))
        r["min_surface_temp_c"] = min_t
        r["max_surface_temp_c"] = max_t

        r["elevation_m"] = _coalesce_num(r, "elevation_m", default=0.0)
        r["terrain_roughness_m"] = _coalesce_num(r, "terrain_roughness_m", default=0.0)
        r["basalt_fraction_pct"] = _coalesce_num(r, "basalt_fraction_pct", default=0.0)
        r["surface_albedo"] = _coalesce_num(r, "surface_albedo", default=0.20)
        r["water_ice_presence"] = 1 if _coalesce_num(r, "water_ice_presence", default=0.0) >= 0.5 else 0
        r["permafrost_presence"] = 1 if _coalesce_num(r, "permafrost_presence", default=0.0) >= 0.5 else 0
        r["vegetation_cover_pct"] = _coalesce_num(r, "vegetation_cover_pct", default=0.0)
        r["mean_annual_precipitation_mm"] = _coalesce_num(r, "mean_annual_precipitation_mm", default=500.0)
        r["mean_wind_speed_m_s"] = _coalesce_num(r, "mean_wind_speed_m_s", default=2.0)

        lith_raw = str(r.get("dominant_lithology") or "unknown").strip()
        r["dominant_lithology"] = lith_raw if lith_raw.lower() != "nan" else "unknown"
        min_raw = str(r.get("surface_mineral_class") or "silicate").strip()
        r["surface_mineral_class"] = min_raw if min_raw.lower() != "nan" else "Silicate"

        r["has_subsurface_void"] = infer_subsurface_void(r)
        r["aridity_ice_idx"] = derive_aridity_ice_idx(r)
        r["dust_cover_class"] = derive_dust_cover_class(r)
        r["solar_irradiance_kwh"] = derive_solar_irradiance_kwh(r)

        ice_pct = _coalesce_num(r, "surface_ice_fraction_pct", default=float("nan"))
        if math.isnan(ice_pct):
            ice_pct = round(r["aridity_ice_idx"] * 100.0, 2)
        r["surface_ice_fraction_pct"] = ice_pct

        existing_name = str(r.get("micro_site_name") or r.get("site_name") or "").strip()
        display_name = existing_name if existing_name and existing_name.lower() != "nan" else format_site_name(sid)
        r["site_name"] = display_name
        r["micro_site_name"] = display_name
        r["parent_biome"] = infer_parent_biome(r)
        enriched.append(r)

    return pd.DataFrame(enriched)


def load_earth_dataset(data_dir: Path | None = None) -> pd.DataFrame:
    """Loads the official merged_earth_features_clean.csv (or legacy fallback) and preprocesses it."""
    base = Path(data_dir) if data_dir is not None else DATA_DIR
    candidates = [
        base / OFFICIAL_EARTH_CSV,
        base / LEGACY_EARTH_CSV,
        base / "placeholderData" / LEGACY_EARTH_CSV,
        base / "earth_analogs.csv",
    ]
    for path in candidates:
        if path.exists():
            return preprocess_earth_dataframe(pd.read_csv(path))
    raise FileNotFoundError(
        f"No Earth dataset found in {base} (checked {OFFICIAL_EARTH_CSV} and fallbacks)."
    )


def load_planetary_targets(data_dir: Path | None = None) -> pd.DataFrame:
    """Loads planetary bases/targets from official or placeholderData folders."""
    base = Path(data_dir) if data_dir is not None else DATA_DIR
    candidates = [
        base / "planetary_targets.csv",
        base / "planetary_bases.csv",
        base / "placeholderData" / "planetary_bases.csv",
    ]
    for path in candidates:
        if path.exists():
            return pd.read_csv(path)
    raise FileNotFoundError(f"No planetary targets CSV found in {base}.")


def prepare_feature_matrices(
    earth_df: pd.DataFrame,
    target_row: pd.Series | Dict[str, Any],
    weights_map: Dict[str, float],
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Builds normalized and sqrt(w)-weighted matrices for KNN and TOPSIS.

    Returns:
    - earth_knn_matrix: (M, 17) clipped & sqrt(w)-scaled matrix for BallTree KNN
    - target_knn_vector: (1, 17) clipped & sqrt(w)-scaled target vector for BallTree KNN
    - earth_norm_matrix: (M, 17) unweighted [0, 1] matrix for Stage 2 TOPSIS
    - target_unclipped_vector: (17,) unweighted unclipped target vector for Stage 2 TOPSIS
    """
    if not all(col in earth_df.columns for col in ACTIVE_FEATURES):
        earth_df = preprocess_earth_dataframe(earth_df)

    n_sites = len(earth_df)
    n_feats = len(ACTIVE_FEATURES)

    earth_norm = np.zeros((n_sites, n_feats), dtype=float)
    target_clipped = np.zeros(n_feats, dtype=float)
    target_unclipped = np.zeros(n_feats, dtype=float)

    for j, col in enumerate(ACTIVE_FEATURES):
        f_type = FEATURE_META[col]["type"]
        t_raw = target_row.get(col) if isinstance(target_row, dict) else target_row[col]

        if f_type in ("numerical", "binary"):
            e_vals = earth_df[col].to_numpy(dtype=float)
            earth_norm[:, j] = normalize_clipped(e_vals, col)
            target_clipped[j] = normalize_clipped(np.array([float(t_raw)]), col)[0]
            target_unclipped[j] = normalize_unclipped(np.array([float(t_raw)]), col)[0]

        elif col == "dominant_lithology":
            earth_norm[:, j] = [
                _lookup_pairwise(t_raw, c_val, LITHOLOGY_MATRIX)
                for c_val in earth_df[col]
            ]
            target_clipped[j] = 1.00
            target_unclipped[j] = 1.00

        elif col == "surface_mineral_class":
            earth_norm[:, j] = [
                _lookup_pairwise(t_raw, c_val, MINERAL_MATRIX)
                for c_val in earth_df[col]
            ]
            target_clipped[j] = 1.00
            target_unclipped[j] = 1.00

        elif col == "dust_cover_class":
            earth_norm[:, j] = [
                _score_dust_compatibility(t_raw, c_val)
                for c_val in earth_df[col]
            ]
            target_clipped[j] = 1.00
            target_unclipped[j] = 1.00

    weights = np.array([weights_map[c] for c in ACTIVE_FEATURES], dtype=float)
    sqrt_w = np.sqrt(weights)

    earth_knn_matrix = earth_norm * sqrt_w
    target_knn_vector = (target_clipped * sqrt_w).reshape(1, -1)

    return earth_knn_matrix, target_knn_vector, earth_norm, target_unclipped