"""Feature normalization, categorical compatibility scoring, and weight preprocessing
across all 17 shared planetary/terrestrial factors.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple
import numpy as np
import pandas as pd

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
        "max": 6000.0,
        "label": "Elevation",
        "unit": "m",
        "domain": "topography",
    },
    "mean_slope_deg": {
        "weight_col": "w_slope",
        "type": "numerical",
        "min": 0.0,
        "max": 45.0,
        "label": "Mean Slope",
        "unit": "°",
        "domain": "topography",
    },
    "terrain_roughness_m": {
        "weight_col": "w_roughness",
        "type": "numerical",
        "min": 0.0,
        "max": 5.0,
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
        "min": -60.0,
        "max": 35.0,
        "label": "Min Surface Temp",
        "unit": "°C",
        "domain": "thermal",
    },
    "max_surface_temp_c": {
        "weight_col": "w_temp_max",
        "type": "numerical",
        "min": -25.0,
        "max": 60.0,
        "label": "Max Surface Temp",
        "unit": "°C",
        "domain": "thermal",
    },
    "temp_swing_c": {
        "weight_col": "w_temp_swing",
        "type": "numerical",
        "min": 0.0,
        "max": 45.0,
        "label": "Diurnal Temp Swing",
        "unit": "°C",
        "domain": "thermal",
    },
    "surface_thermal_inertia": {
        "weight_col": "w_thermal_inertia",
        "type": "numerical",
        "min": 50.0,
        "max": 2000.0,
        "label": "Thermal Inertia",
        "unit": "TIU",
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
LITHOLOGY_MATRIX: Dict[Tuple[str, str], float] = {
    ("basalt", "basalt"): 1.00,
    ("basalt", "anorthosite"): 0.50,
    ("basalt", "impact_breccia"): 0.65,
    ("basalt", "aeolian_dune"): 0.40,
    ("basalt", "volcanic_ash"): 0.75,
    ("basalt", "evaporite"): 0.10,
    ("anorthosite", "anorthosite"): 1.00,
    ("anorthosite", "impact_breccia"): 0.70,
    ("anorthosite", "granite"): 0.55,
    ("anorthosite", "aeolian_dune"): 0.25,
    ("impact_breccia", "impact_breccia"): 1.00,
    ("impact_breccia", "volcanic_ash"): 0.60,
    ("aeolian_dune", "aeolian_dune"): 1.00,
    ("aeolian_dune", "sandstone"): 0.50,
    ("evaporite", "evaporite"): 1.00,
}

MINERAL_MATRIX: Dict[Tuple[str, str], float] = {
    ("silicate", "silicate"): 1.00,
    ("silicate", "oxide"): 0.65,
    ("silicate", "phyllosilicate"): 0.55,
    ("silicate", "sulfate"): 0.30,
    ("silicate", "carbonate"): 0.25,
    ("silicate", "evaporite"): 0.10,
    ("oxide", "oxide"): 1.00,
    ("oxide", "sulfate"): 0.50,
    ("sulfate", "sulfate"): 1.00,
    ("sulfate", "evaporite"): 0.75,
    ("sulfate", "carbonate"): 0.50,
    ("carbonate", "carbonate"): 1.00,
    ("phyllosilicate", "phyllosilicate"): 1.00,
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


def compute_mission_weights(mission_row: pd.Series | Dict[str, Any]) -> Dict[str, float]:
    """Extracts mission weights for all 17 features and normalizes them to sum to 1.0."""
    raw: Dict[str, float] = {}
    for col in ACTIVE_FEATURES:
        w_col = FEATURE_META[col]["weight_col"]
        val = (
            mission_row.get(w_col, 0.0)
            if isinstance(mission_row, dict)
            else mission_row.get(w_col, 0.0)
        )
        raw[col] = max(0.0, float(val))

    total = sum(raw.values())
    if total <= 0.0:
        equal = 1.0 / len(ACTIVE_FEATURES)
        return {col: equal for col in ACTIVE_FEATURES}
    return {col: round(val / total, 6) for col, val in raw.items()}


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