"""Two-stage Planetary Analog matching engine: Weighted BallTree KNN -> Analog TOPSIS.

Note: `lithology_type` is intentionally excluded for now until the team locks its
numerical encoding. Active weights are automatically re-normalized to sum to 1.0.
"""

from __future__ import annotations

from typing import Any, Dict, List

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

FEATURE_META: Dict[str, Dict[str, Any]] = {
    "slope_deg": {
        "weight_col": "w_slope",
        "min": 0.0,
        "max": 45.0,
        "label": "Độ dốc (Slope)",
        "unit": "°",
    },
    "mean_temp_c": {
        "weight_col": "w_temp",
        "min": -30.0,
        "max": 45.0,
        "label": "Nhiệt độ TB",
        "unit": "°C",
    },
    "temp_swing_c": {
        "weight_col": "w_temp_swing",
        "min": 0.0,
        "max": 40.0,
        "label": "Biên độ nhiệt ngày",
        "unit": "°C",
    },
    "aridity_ice_idx": {
        "weight_col": "w_aridity_ice",
        "min": 0.0,
        "max": 1.0,
        "label": "Độ khô hạn / Băng",
        "unit": "",
    },
    "has_subsurface_void": {
        "weight_col": "w_void",
        "min": 0.0,
        "max": 1.0,
        "label": "Hang / Hốc ngầm",
        "unit": "",
    },
}

ACTIVE_FEATURES: List[str] = list(FEATURE_META.keys())


def _normalize_clipped(values: np.ndarray, col: str) -> np.ndarray:
    lo = float(FEATURE_META[col]["min"])
    hi = float(FEATURE_META[col]["max"])
    clipped = np.clip(values.astype(float), lo, hi)
    return (clipped - lo) / (hi - lo)


def _normalize_unclipped(values: np.ndarray, col: str) -> np.ndarray:
    lo = float(FEATURE_META[col]["min"])
    hi = float(FEATURE_META[col]["max"])
    return (values.astype(float) - lo) / (hi - lo)


def compute_mission_weights(mission_row: pd.Series | Dict[str, Any]) -> Dict[str, float]:
    """Extract weights for active features (excluding lithology_type) and normalize to 1.0."""
    raw = {}
    for col in ACTIVE_FEATURES:
        w_col = FEATURE_META[col]["weight_col"]
        val = float(mission_row.get(w_col, 0.0) if isinstance(mission_row, dict) else mission_row[w_col])
        raw[col] = max(0.0, val)

    total = sum(raw.values())
    if total <= 0.0:
        equal = 1.0 / len(ACTIVE_FEATURES)
        return {col: equal for col in ACTIVE_FEATURES}
    return {col: round(val / total, 6) for col, val in raw.items()}


def get_top_analogs(
    earth_df: pd.DataFrame,
    target_row: pd.Series | Dict[str, Any],
    mission_row: pd.Series | Dict[str, Any],
    knn_k: int = 25,
    top_n: int = 10,
) -> List[Dict[str, Any]]:
    """Run Stage 1 Weighted BallTree KNN (top 25) and Stage 2 Analog TOPSIS (top 10)."""
    if earth_df.empty:
        return []

    weights_map = compute_mission_weights(mission_row)
    weights = np.array([weights_map[c] for c in ACTIVE_FEATURES], dtype=float)
    sqrt_weights = np.sqrt(weights)

    # Stage 1: Clipped Min-Max + sqrt(w_i) weighting -> BallTree KNN
    earth_clipped = np.column_stack(
        [_normalize_clipped(earth_df[c].to_numpy(dtype=float), c) for c in ACTIVE_FEATURES]
    )
    target_vals = np.array(
        [float(target_row.get(c) if isinstance(target_row, dict) else target_row[c]) for c in ACTIVE_FEATURES],
        dtype=float,
    )
    target_clipped = np.array(
        [_normalize_clipped(np.array([target_vals[i]]), ACTIVE_FEATURES[i])[0] for i in range(len(ACTIVE_FEATURES))],
        dtype=float,
    )

    earth_knn = earth_clipped * sqrt_weights
    target_knn = (target_clipped * sqrt_weights).reshape(1, -1)

    n_candidates = min(knn_k, len(earth_df))
    nn = NearestNeighbors(n_neighbors=n_candidates, algorithm="ball_tree", metric="euclidean")
    nn.fit(earth_knn)
    _, indices = nn.kneighbors(target_knn)
    cand_idx = indices[0]

    # Stage 2: Analog TOPSIS on candidate differences against unclipped target
    target_unclipped = np.array(
        [_normalize_unclipped(np.array([target_vals[i]]), ACTIVE_FEATURES[i])[0] for i in range(len(ACTIVE_FEATURES))],
        dtype=float,
    )
    cand_clipped = earth_clipped[cand_idx]
    diff_matrix = np.abs(cand_clipped - target_unclipped)

    # Vector-normalize deviation matrix (cost criterion: smaller diff -> closer to ideal A+ = 0)
    col_norms = np.sqrt(np.sum(diff_matrix ** 2, axis=0))
    col_norms = np.where(col_norms < 1e-9, 1.0, col_norms)
    weighted_norm = (diff_matrix / col_norms) * weights

    ideal_best = np.zeros(len(ACTIVE_FEATURES), dtype=float)  # zero deviation from target
    ideal_worst = np.max(weighted_norm, axis=0)

    dist_best = np.sqrt(np.sum((weighted_norm - ideal_best) ** 2, axis=1))
    dist_worst = np.sqrt(np.sum((weighted_norm - ideal_worst) ** 2, axis=1))
    denom = dist_best + dist_worst
    closeness = np.where(denom < 1e-9, 1.0, dist_worst / denom)

    out_of_bounds_flags = []
    for i, col in enumerate(ACTIVE_FEATURES):
        lo = float(FEATURE_META[col]["min"])
        hi = float(FEATURE_META[col]["max"])
        if target_vals[i] < lo or target_vals[i] > hi:
            out_of_bounds_flags.append(
                {
                    "feature": col,
                    "label": FEATURE_META[col]["label"],
                    "target_value": round(float(target_vals[i]), 2),
                    "earth_range": [lo, hi],
                    "unit": FEATURE_META[col]["unit"],
                }
            )

    order = np.argsort(-closeness)[: min(top_n, n_candidates)]
    results: List[Dict[str, Any]] = []

    for rank_pos, local_i in enumerate(order, start=1):
        row = earth_df.iloc[int(cand_idx[local_i])]
        si_map: Dict[str, float] = {}
        earth_features: Dict[str, float] = {}
        for j, col in enumerate(ACTIVE_FEATURES):
            # Fidelity S_i uses bounded unclipped diff clamped to [0, 1] so out-of-range extremes show penalty
            si_val = float(np.clip(1.0 - abs(float(target_unclipped[j]) - float(cand_clipped[local_i, j])), 0.0, 1.0))
            si_map[col] = round(si_val * 100.0, 1)
            earth_features[col] = round(float(row[col]), 3)

        weakest_col = min(ACTIVE_FEATURES, key=lambda c: si_map[c])
        strongest_cols = sorted(ACTIVE_FEATURES, key=lambda c: si_map[c], reverse=True)[:2]

        results.append(
            {
                "rank": rank_pos,
                "site_id": str(row["site_id"]),
                "parent_biome": str(row["parent_biome"]),
                "micro_site_name": str(row["micro_site_name"]),
                "lat": round(float(row["lat"]), 4),
                "lon": round(float(row["lon"]), 4),
                "topsis_score": round(float(closeness[local_i]) * 100.0, 1),
                "features": earth_features,
                "similarity_Si": si_map,
                "weakest_factor": weakest_col,
                "strongest_factors": strongest_cols,
                "out_of_earth_bounds": out_of_bounds_flags,
            }
        )

    return results
