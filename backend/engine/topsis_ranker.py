"""Stage 2 Multi-Criteria Fine Ranking and Diagnostic Engine (TOPSIS)
across all 17 numerical, binary, and categorical planetary factors.
"""

from __future__ import annotations

from typing import Any, Dict, List
import numpy as np
import pandas as pd

from .preprocessor import (
    ACTIVE_FEATURES,
    DOMAIN_BUCKETS,
    FEATURE_META,
    prepare_feature_matrices,
)

__all__ = ["rank_candidates_topsis"]


def rank_candidates_topsis(
    candidate_df: pd.DataFrame,
    target_row: pd.Series | Dict[str, Any],
    weights_map: Dict[str, float],
    top_n: int = 10,
) -> List[Dict[str, Any]]:
    """Evaluates candidates via vector-normalized TOPSIS relative closeness
    and compiles per-factor and per-domain engineering diagnostics.
    """
    if candidate_df.empty:
        return []

    n_candidates = len(candidate_df)
    n_features = len(ACTIVE_FEATURES)
    weights = np.array([weights_map[c] for c in ACTIVE_FEATURES], dtype=float)

    # 1. Obtain [0, 1] candidate matrix (M, 17) and unclipped target vector (17,)
    # Categorical columns in cand_matrix are already target-relative compatibility scores in [0.1, 1.0]
    _, _, cand_matrix, target_unclipped = prepare_feature_matrices(
        earth_df=candidate_df,
        target_row=target_row,
        weights_map=weights_map,
    )

    # 2. Cost deviation matrix: absolute distance from unclipped planetary target
    diff_matrix = np.abs(cand_matrix - target_unclipped)

    # 3. Vector normalization & mission weight application
    col_norms = np.sqrt(np.sum(diff_matrix ** 2, axis=0))
    col_norms = np.where(col_norms < 1e-9, 1.0, col_norms)
    weighted_norm = (diff_matrix / col_norms) * weights

    # 4. Dual Ideals: A+ = 0.0 deviation from target; A- = worst candidate divergence
    ideal_best = np.zeros(n_features, dtype=float)
    ideal_worst = np.max(weighted_norm, axis=0)

    dist_best = np.sqrt(np.sum((weighted_norm - ideal_best) ** 2, axis=1))
    dist_worst = np.sqrt(np.sum((weighted_norm - ideal_worst) ** 2, axis=1))
    denom = dist_best + dist_worst
    closeness = np.where(denom < 1e-9, 1.0, dist_worst / denom)

    # 5. Flag numerical features where the planetary target exceeds Earth's operational envelope
    out_of_bounds_flags: List[Dict[str, Any]] = []
    for col in ACTIVE_FEATURES:
        if FEATURE_META[col]["type"] == "numerical":
            t_val = float(
                target_row.get(col) if isinstance(target_row, dict) else target_row[col]
            )
            lo = float(FEATURE_META[col]["min"])
            hi = float(FEATURE_META[col]["max"])
            if t_val < lo or t_val > hi:
                out_of_bounds_flags.append(
                    {
                        "feature": col,
                        "label": FEATURE_META[col]["label"],
                        "target_value": round(t_val, 2),
                        "earth_range": [lo, hi],
                        "unit": FEATURE_META[col]["unit"],
                    }
                )

    # 6. Rank candidates and build diagnostic payload
    order = np.argsort(-closeness)[: min(top_n, n_candidates)]
    results: List[Dict[str, Any]] = []

    # Prioritize active mission features (w > 0) when identifying weakest/strongest factors
    active_weighted_cols = [c for c in ACTIVE_FEATURES if weights_map.get(c, 0.0) > 0.0]
    eval_cols = active_weighted_cols if active_weighted_cols else ACTIVE_FEATURES

    for rank_pos, local_i in enumerate(order, start=1):
        row = candidate_df.iloc[int(local_i)]
        si_map: Dict[str, float] = {}
        numerical_features: Dict[str, float] = {}
        categorical_features: Dict[str, str] = {}

        for j, col in enumerate(ACTIVE_FEATURES):
            f_type = FEATURE_META[col]["type"]
            # Fidelity score S_i in [0, 100%]
            si_val = float(
                np.clip(1.0 - abs(target_unclipped[j] - cand_matrix[local_i, j]), 0.0, 1.0)
            )
            si_map[col] = round(si_val * 100.0, 1)

            if f_type in ("numerical", "binary"):
                numerical_features[col] = round(float(row[col]), 3)
            else:
                categorical_features[col] = str(row[col])

        # Compute aggregated Domain Bucket fidelity scores (0-100%) for UI radar charts
        domain_scores: Dict[str, float] = {}
        for domain_name, d_cols in DOMAIN_BUCKETS.items():
            d_weights = [weights_map.get(c, 0.0) for c in d_cols]
            d_w_sum = sum(d_weights)
            if d_w_sum > 0.0:
                domain_scores[domain_name] = round(
                    sum(si_map[c] * weights_map.get(c, 0.0) for c in d_cols) / d_w_sum,
                    1,
                )
            else:
                domain_scores[domain_name] = round(
                    float(np.mean([si_map[c] for c in d_cols])), 1
                )

        # Identify weakest ("where analogy breaks down") and strongest factors
        weakest_col = min(eval_cols, key=lambda c: si_map[c])
        strongest_cols = sorted(eval_cols, key=lambda c: si_map[c], reverse=True)[:3]

        # Support both schema naming conventions (lat/lon or latitude_deg/longitude_deg)
        lat_val = row.get("latitude_deg", row.get("lat", 0.0))
        lon_val = row.get("longitude_deg", row.get("lon", 0.0))
        site_name = row.get("site_name", row.get("micro_site_name", "Unknown"))

        results.append(
            {
                "rank": rank_pos,
                "site_id": str(row.get("site_id", f"SITE_{local_i}")),
                "site_name": str(site_name),
                "parent_biome": str(row.get("parent_biome", "Terrestrial Analog")),
                "lat": round(float(lat_val), 4),
                "lon": round(float(lon_val), 4),
                "knn_distance": float(row.get("knn_distance", 0.0)),
                "topsis_score": round(float(closeness[local_i]) * 100.0, 1),
                "domain_scores": domain_scores,
                "features": numerical_features,
                "categorical_features": categorical_features,
                "similarity_Si": si_map,
                "weakest_factor": {
                    "feature": weakest_col,
                    "label": FEATURE_META[weakest_col]["label"],
                    "fidelity_pct": si_map[weakest_col],
                },
                "strongest_factors": [
                    {
                        "feature": c,
                        "label": FEATURE_META[c]["label"],
                        "fidelity_pct": si_map[c],
                    }
                    for c in strongest_cols
                ],
                "out_of_earth_bounds": out_of_bounds_flags,
            }
        )

    return results