"""Two-stage Planetary Analog matching engine: Weighted BallTree KNN -> Analog TOPSIS.

Ingests the official 51-site `merged_earth_features_clean.csv` dataset via
`preprocessor.load_earth_dataset` (with fallback support for legacy 5-factor CSVs).
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

from .preprocessor import (
    OFFICIAL_EARTH_CSV,
    derive_aridity_ice_idx,
    infer_subsurface_void,
    load_earth_dataset,
    load_planetary_targets,
    preprocess_earth_dataframe,
)

FEATURE_META: Dict[str, Dict[str, Any]] = {
    "slope_deg": {
        "weight_col": "w_slope",
        "min": 0.0,
        "max": 65.0,
        "label": "Slope",
        "unit": "°",
    },
    "mean_temp_c": {
        "weight_col": "w_temp",
        "min": -30.0,
        "max": 45.0,
        "label": "Mean Temp",
        "unit": "°C",
    },
    "temp_swing_c": {
        "weight_col": "w_temp_swing",
        "min": 0.0,
        "max": 40.0,
        "label": "Diurnal Temp Swing",
        "unit": "°C",
    },
    "aridity_ice_idx": {
        "weight_col": "w_aridity_ice",
        "min": 0.0,
        "max": 1.0,
        "label": "Aridity / Ice",
        "unit": "",
    },
    "has_subsurface_void": {
        "weight_col": "w_void",
        "min": 0.0,
        "max": 1.0,
        "label": "Subsurface Void",
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


def _row_get(row: pd.Series | Dict[str, Any], key: str, default: Any = None) -> Any:
    val = row.get(key, default) if isinstance(row, dict) else (row[key] if key in row else default)
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return default
    return val


def infer_footprint_mode(mission_row: pd.Series | Dict[str, Any]) -> str:
    explicit = str(_row_get(mission_row, "footprint_mode", "") or "").strip()
    if explicit:
        return explicit
    mid = str(_row_get(mission_row, "mission_id", "") or "").lower()
    if "subsurface" in mid or "lava_tube" in mid:
        return "circle_500m"
    if "rover" in mid or "eva" in mid:
        return "circle_5km"
    return "square_1km"


def get_mission_label(mission_row: pd.Series | Dict[str, Any]) -> str:
    return str(
        _row_get(mission_row, "mission_type")
        or _row_get(mission_row, "mission_name")
        or _row_get(mission_row, "mission_id", "Mission")
    )


def get_mission_description(mission_row: pd.Series | Dict[str, Any]) -> str:
    return str(
        _row_get(mission_row, "technology_to_test")
        or _row_get(mission_row, "description")
        or get_mission_label(mission_row)
    )


def _num(mission_row: pd.Series | Dict[str, Any], key: str) -> float:
    try:
        return max(0.0, float(_row_get(mission_row, key, 0.0) or 0.0))
    except (TypeError, ValueError):
        return 0.0


def compute_mission_weights(mission_row: pd.Series | Dict[str, Any]) -> Dict[str, float]:
    """Extract normalized 5-factor weights from either 5-factor or 17-factor missions.csv."""
    has_legacy_5 = _num(mission_row, "w_temp") > 0.0 or _num(mission_row, "w_aridity_ice") > 0.0
    if has_legacy_5:
        raw = {
            col: _num(mission_row, str(FEATURE_META[col]["weight_col"]))
            for col in ACTIVE_FEATURES
        }
    else:
        raw = {
            "slope_deg": _num(mission_row, "w_slope") + 0.5 * _num(mission_row, "w_roughness") + 0.2 * _num(mission_row, "w_dust"),
            "mean_temp_c": _num(mission_row, "w_temp_mean") + 0.5 * _num(mission_row, "w_temp_min") + 0.5 * _num(mission_row, "w_temp_max"),
            "temp_swing_c": _num(mission_row, "w_temp_swing") + 0.5 * _num(mission_row, "w_thermal_inertia") + 0.3 * _num(mission_row, "w_solar"),
            "aridity_ice_idx": _num(mission_row, "w_water_ice") + _num(mission_row, "w_ice_aridity"),
            "has_subsurface_void": _num(mission_row, "w_void"),
        }

    total = sum(raw.values())
    if total <= 0.0:
        equal = 1.0 / len(ACTIVE_FEATURES)
        return {col: equal for col in ACTIVE_FEATURES}
    return {col: round(val / total, 6) for col, val in raw.items()}


def _extract_target_feature(target_row: pd.Series | Dict[str, Any], col: str) -> float:
    """Reads 5-factor target features with fallback to official/17-factor column names."""
    def _get(k: str) -> Any:
        return target_row.get(k) if isinstance(target_row, dict) else (target_row[k] if k in target_row else None)

    direct = _get(col)
    if direct is not None and not (isinstance(direct, float) and math.isnan(direct)):
        return float(direct)

    if col == "slope_deg":
        v = _get("mean_slope_deg")
        return float(v) if v is not None else 0.0
    if col == "mean_temp_c":
        v = _get("mean_surface_temp_c")
        return float(v) if v is not None else 0.0
    if col == "temp_swing_c":
        v = _get("surface_thermal_inertia")
        if v is not None:
            return float(v)
        max_t = _get("max_surface_temp_c")
        min_t = _get("min_surface_temp_c")
        if max_t is not None and min_t is not None:
            return max(0.0, float(max_t) - float(min_t))
        return 0.0
    if col == "aridity_ice_idx":
        return derive_aridity_ice_idx(target_row)
    if col == "has_subsurface_void":
        return float(infer_subsurface_void(target_row))
    return 0.0


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

    required_cols = set(ACTIVE_FEATURES) | {"lat", "lon", "parent_biome", "micro_site_name"}
    if not required_cols.issubset(earth_df.columns):
        earth_df = preprocess_earth_dataframe(earth_df)

    weights_map = compute_mission_weights(mission_row)
    weights = np.array([weights_map[c] for c in ACTIVE_FEATURES], dtype=float)
    sqrt_weights = np.sqrt(weights)

    # Stage 1: Clipped Min-Max + sqrt(w_i) weighting -> BallTree KNN
    earth_clipped = np.column_stack(
        [_normalize_clipped(earth_df[c].to_numpy(dtype=float), c) for c in ACTIVE_FEATURES]
    )
    target_vals = np.array(
        [_extract_target_feature(target_row, c) for c in ACTIVE_FEATURES],
        dtype=float,
    )
    target_clipped = np.array(
        [_normalize_clipped(np.array([target_vals[i]]), ACTIVE_FEATURES[i])[0] for i in range(len(ACTIVE_FEATURES))],
        dtype=float,
    )

    earth_knn = earth_clipped * sqrt_weights
    target_knn = (target_clipped * sqrt_weights).reshape(1, -1)

    n_candidates = max(1, min(int(knn_k), len(earth_df)))
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

    order = np.argsort(-closeness)[: min(max(1, int(top_n)), n_candidates)]
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
                "elevation_m": round(float(row.get("elevation_m", 0.0)), 1),
                "terrain_roughness_m": round(float(row.get("terrain_roughness_m", 0.0)), 2),
                "dominant_lithology": str(row.get("dominant_lithology", "unknown")),
                "basalt_fraction_pct": round(float(row.get("basalt_fraction_pct", 0.0)), 1),
                "surface_mineral_class": str(row.get("surface_mineral_class", "Silicate")),
                "surface_albedo": round(float(row.get("surface_albedo", 0.2)), 3),
                "water_ice_presence": int(row.get("water_ice_presence", 0)),
                "permafrost_presence": int(row.get("permafrost_presence", 0)),
            }
        )

    return results


def _planet_physical_limits(planet: str) -> str:
    p = planet.strip().lower()
    if p == "moon":
        return "Earth gravity (1g) is ~6x stronger than the Moon (0.165g), with a 1 atm atmosphere and magnetic shielding instead of vacuum and sharp regolith dust."
    return "Earth gravity (1g) is ~2.6x stronger than Mars (0.38g), with a 1 atm O₂/N₂ atmosphere rather than Mars' tenuous 95% CO₂ air and high surface radiation."


def _default_source_url(planet: str) -> str:
    return (
        "https://pds-geosciences.wustl.edu/missions/lro/"
        if planet.strip().lower() == "moon"
        else "https://pds.nasa.gov/"
    )


def resolve_site_test_info(
    earth_item: Dict[str, Any],
    target_row: pd.Series | Dict[str, Any],
    mission_row: pd.Series | Dict[str, Any],
    site_tests_df: pd.DataFrame,
) -> Dict[str, Any]:
    """Lookup site_tests.csv (exact site+mission -> site-only -> dynamic scientific fallback)."""
    site_id = earth_item["site_id"]
    mission_id = str(_row_get(mission_row, "mission_id", ""))
    mission_aliases = {mission_id}
    alias_map = {
        "isru_extraction": "ground_isru",
        "ground_isru": "isru_extraction",
        "subsurface_habitat": "lava_tube_habitat",
        "lava_tube_habitat": "subsurface_habitat",
    }
    if mission_id in alias_map:
        mission_aliases.add(alias_map[mission_id])
    planet = str(_row_get(target_row, "planet") or _row_get(target_row, "body") or "moon")
    target_name = str(_row_get(target_row, "target_name") or _row_get(target_row, "micro_site_name") or "Target")

    if not site_tests_df.empty:
        exact = site_tests_df[
            (site_tests_df["site_id"] == site_id) & (site_tests_df["mission_id"].isin(mission_aliases))
        ]
        if not exact.empty:
            r = exact.iloc[0]
            return {
                "is_fallback_note": False,
                "technology_to_test": str(r["technology_to_test"]),
                "why_suitable": str(r["why_suitable"]),
                "analogy_limitations": str(r["analogy_limitations"]),
                "source_url": str(r["source_url"]),
            }

        site_only = site_tests_df[site_tests_df["site_id"] == site_id]
        if not site_only.empty:
            r = site_only.iloc[0]
            return {
                "is_fallback_note": True,
                "technology_to_test": get_mission_description(mission_row),
                "why_suitable": f"Base note ({earth_item['micro_site_name']}): {r['why_suitable']}",
                "analogy_limitations": str(r["analogy_limitations"]),
                "source_url": str(r["source_url"]),
            }

    si = earth_item["similarity_Si"]
    strongest = earth_item["strongest_factors"]
    weakest = earth_item["weakest_factor"]

    top_desc = " and ".join(f"{FEATURE_META[col]['label']} ({si[col]}%)" for col in strongest)
    why_parts = [
        f"Located in {earth_item['parent_biome']} ({earth_item['micro_site_name']}), showing strong similarity to {target_name} in {top_desc}."
    ]
    lith = str(earth_item.get("dominant_lithology", "") or "").strip()
    mineral = str(earth_item.get("surface_mineral_class", "") or "").strip()
    basalt_pct = earth_item.get("basalt_fraction_pct")
    if lith and lith.lower() != "unknown":
        mineral_txt = f"{mineral} mineral class" if mineral else "characteristic geology"
        basalt_txt = f", {basalt_pct}% basalt" if basalt_pct is not None else ""
        why_parts.append(f"Lithology: {lith} ({mineral_txt}{basalt_txt}).")
    if int(earth_item.get("permafrost_presence", 0)) == 1:
        why_parts.append("Contains permafrost layers suitable for polar and subsurface-ice testing.")
    if int(earth_item["features"].get("has_subsurface_void", 0)) == 1:
        why_parts.append("Includes subsurface void/cave structures supporting subterranean survey and radiation-shielding trials.")

    weak_label = FEATURE_META[weakest]["label"]
    limit_parts = [
        f"Weakest matching factor: {weak_label} ({si[weakest]}% similarity).",
        _planet_physical_limits(planet),
    ]
    if earth_item.get("out_of_earth_bounds"):
        oob_labels = ", ".join(
            f"{o['label']} ({o['target_value']}{o['unit']})" for o in earth_item["out_of_earth_bounds"]
        )
        limit_parts.append(f"Out-of-Earth-bounds warning at {target_name}: {oob_labels}.")

    tech = get_mission_description(mission_row)
    if int(earth_item["features"].get("has_subsurface_void", 0)) == 0 and mission_id in ("lava_tube_habitat", "subsurface_habitat"):
        tech += " (Note: this site has no natural subsurface void; testing is limited to surface terrain and RF propagation)."

    return {
        "is_fallback_note": True,
        "technology_to_test": tech,
        "why_suitable": " ".join(why_parts),
        "analogy_limitations": " ".join(limit_parts),
        "source_url": _default_source_url(planet),
    }


def match_placeholder_target(
    earth_df: pd.DataFrame,
    target_row: pd.Series | Dict[str, Any],
    mission_row: pd.Series | Dict[str, Any],
    site_tests_df: pd.DataFrame,
    knn_k: int = 25,
    top_n: int = 10,
) -> List[Dict[str, Any]]:
    """Run 5-factor KNN -> TOPSIS and enrich each match with site_tests notes."""
    ranked = get_top_analogs(earth_df, target_row, mission_row, knn_k=knn_k, top_n=top_n)
    footprint_mode = infer_footprint_mode(mission_row)
    for item in ranked:
        item.update(resolve_site_test_info(item, target_row, mission_row, site_tests_df))
        item["footprint_mode"] = footprint_mode
    return ranked


def build_placeholder_bundle(data_dir: Path) -> Dict[str, Any]:
    """Build the full precomputed/live analog bundle from official Earth & planetary CSVs."""
    earth_df = load_earth_dataset(data_dir)
    targets_df = load_planetary_targets(data_dir)
    missions_df = pd.read_csv(data_dir / "missions.csv")
    site_tests_path = data_dir / "site_tests.csv"
    site_tests_df = pd.read_csv(site_tests_path) if site_tests_path.exists() else pd.DataFrame()

    payload: Dict[str, Any] = {
        "meta": {
            "dataset": OFFICIAL_EARTH_CSV,
            "active_features": ACTIVE_FEATURES,
            "derived_features": ["aridity_ice_idx", "has_subsurface_void", "temp_swing_c"],
            "earth_site_count": int(len(earth_df)),
            "algorithm": "Stage 1: Weighted BallTree KNN (Top 25) -> Stage 2: Analog TOPSIS (Top 10)",
        },
        "targets": [],
        "missions": [],
        "results": {},
    }

    for _, trow in targets_df.iterrows():
        t_id = str(trow.get("target_id", trow.get("site_id", "")))
        planet = str(trow.get("planet", trow.get("body", "moon"))).lower()
        t_name = str(trow.get("target_name", trow.get("micro_site_name", t_id)))
        t_lat = float(trow.get("lat", trow.get("latitude_deg", 0.0)))
        t_lon = float(trow.get("lon", trow.get("longitude_deg", 0.0)))
        payload["targets"].append(
            {
                "target_id": t_id,
                "planet": planet,
                "target_name": t_name,
                "lat": t_lat,
                "lon": t_lon,
                "features": {c: _extract_target_feature(trow, c) for c in ACTIVE_FEATURES},
            }
        )

    for _, mrow in missions_df.iterrows():
        payload["missions"].append(
            {
                "mission_id": str(mrow["mission_id"]),
                "mission_type": get_mission_label(mrow),
                "technology_to_test": get_mission_description(mrow),
                "footprint_mode": infer_footprint_mode(mrow),
                "weights": compute_mission_weights(mrow),
            }
        )

    for _, trow in targets_df.iterrows():
        t_id = str(trow.get("target_id", trow.get("site_id", "")))
        payload["results"][t_id] = {}
        for _, mrow in missions_df.iterrows():
            m_id = str(mrow["mission_id"])
            payload["results"][t_id][m_id] = match_placeholder_target(
                earth_df=earth_df,
                target_row=trow,
                mission_row=mrow,
                site_tests_df=site_tests_df,
                knn_k=25,
                top_n=10,
            )

    return payload
