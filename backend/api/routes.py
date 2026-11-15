"""
backend/api/routes.py
FastAPI router executing two-stage candidate retrieval and Earth Testbed Protocol generation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, status
import pandas as pd
from pydantic import BaseModel, Field

from engine import (
    ACTIVE_FEATURES,
    DOMAIN_BUCKETS,
    FEATURE_META,
    apply_domain_bucket_budgets,
    compute_mission_weights,
    filter_candidates_knn,
    load_earth_dataset,
    load_planetary_targets,
    rank_candidates_topsis,
)
from engine.matcher import (
    ACTIVE_FEATURES as PLACEHOLDER_FEATURES,
    build_placeholder_bundle,
    compute_mission_weights as compute_placeholder_weights,
    match_placeholder_target,
)
from engine.preprocessor import OFFICIAL_EARTH_CSV
from engine.resolvers.planetary_resolver import resolve_planetary_point
from engine.testbed_protocol import EarthTestbedProtocolEngine
from .schemas import (
    AnalogSearchRequest,
    AnalogSearchResponse,
    EarthTestbedProtocol,
    MissionPresetResponse,
    ResolveTargetRequest,
    TargetProfileSummary,
)

router = APIRouter(prefix="/api", tags=["Planetary Analogs"])

# ---------------------------------------------------------------------------
# 1. DATA CACHE & SERVICE INITIALIZATION
# ---------------------------------------------------------------------------
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

try:
    DF_EARTH = load_earth_dataset(DATA_DIR)
except Exception:
    DF_EARTH = pd.DataFrame()

try:
    DF_TARGETS = load_planetary_targets(DATA_DIR)
except Exception:
    DF_TARGETS = pd.DataFrame()

try:
    _presets_path = DATA_DIR / ("mission_presets.csv" if (DATA_DIR / "mission_presets.csv").exists() else "missions.csv")
    DF_PRESETS = pd.read_csv(_presets_path) if _presets_path.exists() else pd.DataFrame()
except Exception:
    DF_PRESETS = pd.DataFrame()

protocol_engine = EarthTestbedProtocolEngine()


def _load_placeholder_frames() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    try:
        earth_df = load_earth_dataset(DATA_DIR)
    except Exception:
        earth_df = pd.DataFrame()
    try:
        targets_df = load_planetary_targets(DATA_DIR)
    except Exception:
        targets_df = pd.DataFrame()
    missions_p = DATA_DIR / "missions.csv"
    tests_p = DATA_DIR / "site_tests.csv"
    return (
        earth_df,
        targets_df,
        pd.read_csv(missions_p) if missions_p.exists() else pd.DataFrame(),
        pd.read_csv(tests_p) if tests_p.exists() else pd.DataFrame(),
    )


class AnalogMatchRequest(BaseModel):
    target_id: Optional[str] = None
    target_body: Optional[str] = None
    lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    lon: Optional[float] = Field(None, ge=-180.0, le=180.0)
    mission_id: str = "rover_mobility"
    knn_k: int = Field(25, ge=5, le=100)
    top_n: int = Field(10, ge=1, le=50)


# ---------------------------------------------------------------------------
# 2. METADATA, PRESETS & PLACEHOLDER COMPATIBILITY ENDPOINTS
# ---------------------------------------------------------------------------
@router.get("/health")
def get_health() -> Dict[str, Any]:
    """Reports backend engine mode and loaded dataset counts."""
    full_ready = not (DF_EARTH.empty or DF_TARGETS.empty or DF_PRESETS.empty)
    ph_earth, ph_targets, ph_missions, _ = _load_placeholder_frames()
    return {
        "status": "ok",
        "mode": "full_17_factor" if full_ready else "placeholder_5_factor",
        "earth_site_count": int(len(DF_EARTH) if full_ready else len(ph_earth)),
        "target_count": int(len(DF_TARGETS) if full_ready else len(ph_targets)),
        "mission_count": int(len(DF_PRESETS) if full_ready else len(ph_missions)),
    }


@router.get("/domains", response_model=Dict[str, List[str]])
def get_domain_buckets() -> Dict[str, List[str]]:
    """Returns the 4 domain bucket groupings for UI radar charts."""
    return DOMAIN_BUCKETS


@router.get("/presets", response_model=List[MissionPresetResponse])
def list_mission_presets() -> List[MissionPresetResponse]:
    """Returns mission scenarios and their baseline weights."""
    if not DF_PRESETS.empty:
        presets: List[MissionPresetResponse] = []
        for _, row in DF_PRESETS.iterrows():
            weights_map = compute_mission_weights(row)
            presets.append(
                MissionPresetResponse(
                    mission_id=str(row["mission_id"]),
                    mission_name=str(row.get("mission_name", row.get("mission_type", row["mission_id"]))),
                    description=str(row.get("description", row.get("technology_to_test", ""))),
                    weights=weights_map,
                )
            )
        return presets

    _, _, ph_missions, _ = _load_placeholder_frames()
    if ph_missions.empty:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mission presets catalog not loaded",
        )
    return [
        MissionPresetResponse(
            mission_id=str(row["mission_id"]),
            mission_name=str(row["mission_type"]),
            description=str(row.get("technology_to_test", "")),
            weights=compute_placeholder_weights(row),
        )
        for _, row in ph_missions.iterrows()
    ]


@router.get("/targets")
def list_planetary_targets(body: Optional[str] = None) -> List[Dict[str, Any]]:
    """Returns Moon and Mars target sites from official or placeholder catalog."""
    if not DF_TARGETS.empty:
        df = DF_TARGETS
        body_col = "body" if "body" in df.columns else "planet"
        if body and body_col in df.columns:
            df = df[df[body_col].astype(str).str.lower() == body.strip().lower()]
        feature_cols = [c for c in ACTIVE_FEATURES if c in df.columns]
        if not feature_cols:
            feature_cols = [c for c in PLACEHOLDER_FEATURES if c in df.columns]
        return [
            {
                "site_id": str(row.get("site_id", row.get("target_id", ""))),
                "body": str(row.get("body", row.get("planet", "moon"))),
                "target_name": str(row.get("site_name", row.get("target_name", "Unknown Target"))),
                "parent_region": row.get("parent_region", row.get("parent_biome", None)),
                "lat": float(row.get("latitude_deg", row.get("lat", 0.0))),
                "lon": float(row.get("longitude_deg", row.get("lon", 0.0))),
                "features": {col: row[col] for col in feature_cols if col in row},
            }
            for _, row in df.iterrows()
        ]

    _, ph_targets, _, _ = _load_placeholder_frames()
    if ph_targets.empty:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Planetary targets catalog not loaded",
        )
    df = ph_targets
    if body:
        df = df[df["planet"].str.lower() == body.strip().lower()]
    return [
        {
            "site_id": str(row["target_id"]),
            "body": str(row["planet"]),
            "target_name": str(row["target_name"]),
            "parent_region": None,
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "features": {col: float(row[col]) for col in PLACEHOLDER_FEATURES if col in row},
        }
        for _, row in df.iterrows()
    ]


@router.get("/analogs/bundle")
def get_analogs_bundle() -> Dict[str, Any]:
    """Computes and returns the full analog matching bundle from backend/data CSVs."""
    ph_earth, ph_targets, ph_missions, _ = _load_placeholder_frames()
    if ph_earth.empty or ph_targets.empty or ph_missions.empty:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Placeholder CSV datasets not found in backend/data/",
        )
    return build_placeholder_bundle(DATA_DIR)


@router.post("/analogs/match")
def match_analogs_live(payload: AnalogMatchRequest) -> Dict[str, Any]:
    """Computes live KNN -> TOPSIS similarity percentages for a target and mission."""
    ph_earth, ph_targets, ph_missions, ph_tests = _load_placeholder_frames()
    if ph_earth.empty or ph_missions.empty:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Earth sites or missions CSV unavailable in backend/data/",
        )

    mission_match = ph_missions[ph_missions["mission_id"] == payload.mission_id]
    mission_row = ph_missions.iloc[0] if mission_match.empty else mission_match.iloc[0]

    target_obj: Dict[str, Any]
    target_row: pd.Series | Dict[str, Any]

    if payload.target_id and not ph_targets.empty:
        t_match = ph_targets[ph_targets["target_id"] == payload.target_id]
        if t_match.empty:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Unknown target_id '{payload.target_id}'",
            )
        trow = t_match.iloc[0]
        target_row = trow
        target_obj = {
            "target_id": str(trow["target_id"]),
            "planet": str(trow["planet"]).lower(),
            "target_name": str(trow["target_name"]),
            "lat": float(trow["lat"]),
            "lon": float(trow["lon"]),
            "features": {c: float(trow[c]) for c in PLACEHOLDER_FEATURES},
        }
    elif payload.target_body and payload.lat is not None and payload.lon is not None:
        resolved = resolve_planetary_point(
            body=payload.target_body,
            lat=payload.lat,
            lon=payload.lon,
            clip_for_knn=False,
        )
        shared = resolved["shared_17"]
        planet_key = payload.target_body.strip().lower()
        target_name = f"{planet_key.title()} ({payload.lat:.2f}°, {payload.lon:.2f}°)"
        mapped_features = {
            "slope_deg": float(shared["mean_slope_deg"]),
            "mean_temp_c": float(shared["mean_surface_temp_c"]),
            "temp_swing_c": float(shared["temp_swing_c"]),
            "aridity_ice_idx": 0.99 if int(shared.get("water_ice_presence", 0)) == 1 else 0.95,
            "has_subsurface_void": int(shared.get("has_subsurface_void", 0)),
        }
        target_row = {
            "target_id": f"custom_{planet_key}",
            "planet": planet_key,
            "target_name": target_name,
            "lat": float(payload.lat),
            "lon": float(payload.lon),
            **mapped_features,
        }
        target_obj = {
            "target_id": target_row["target_id"],
            "planet": planet_key,
            "target_name": target_name,
            "lat": float(payload.lat),
            "lon": float(payload.lon),
            "features": mapped_features,
        }
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide either target_id or (target_body, lat, lon)",
        )

    ranked = match_placeholder_target(
        earth_df=ph_earth,
        target_row=target_row,
        mission_row=mission_row,
        site_tests_df=ph_tests,
        knn_k=payload.knn_k,
        top_n=payload.top_n,
    )

    return {
        "meta": {
            "dataset": OFFICIAL_EARTH_CSV,
            "active_features": PLACEHOLDER_FEATURES,
            "derived_features": ["aridity_ice_idx", "has_subsurface_void", "temp_swing_c"],
            "earth_site_count": int(len(ph_earth)),
            "algorithm": "Stage 1: Weighted BallTree KNN (Top 25) -> Stage 2: Analog TOPSIS (Top 10)",
        },
        "target": target_obj,
        "mission": {
            "mission_id": str(mission_row["mission_id"]),
            "mission_type": str(mission_row["mission_type"]),
            "technology_to_test": str(mission_row["technology_to_test"]),
            "footprint_mode": str(mission_row["footprint_mode"]),
            "weights": compute_placeholder_weights(mission_row),
        },
        "results": ranked,
    }


# ---------------------------------------------------------------------------
# 3. COORDINATE RESOLVER ENDPOINT
# ---------------------------------------------------------------------------
@router.post("/resolve", response_model=Dict[str, Any])
def resolve_coordinate(payload: ResolveTargetRequest) -> Dict[str, Any]:
    """Resolves arbitrary Moon/Mars coordinates into shared 17 and exclusive factors."""
    try:
        resolved = resolve_planetary_point(
            body=payload.body,
            lat=payload.coordinates.lat,
            lon=payload.coordinates.lon,
            clip_for_knn=False,
        )
        return resolved
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to resolve planetary coordinates: {exc}",
        )


# ---------------------------------------------------------------------------
# 4. PRIMARY ANALOG SEARCH & PROTOCOL PIPELINE
# ---------------------------------------------------------------------------
@router.post("/search", response_model=AnalogSearchResponse)
def search_analogs(payload: AnalogSearchRequest) -> AnalogSearchResponse:
    """
    Executes:
      1. Planetary target profile resolution (Shared 17 + Exclusive).
      2. Mission weight budget calculation.
      3. Stage 1 Weighted KNN BallTree candidate retrieval.
      4. Stage 2 TOPSIS dual-ideal fine-ranking.
      5. Three-tier Earth Testbed Protocol synthesis for the top match.
    """
    if DF_EARTH.empty:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Earth analogs catalog is unavailable",
        )

    # 1. Resolve Target Profile (Shared 17 + Exclusive)
    target_profile: Optional[Dict[str, Any]] = None

    if payload.target_site_id and not DF_TARGETS.empty:
        id_col = "site_id" if "site_id" in DF_TARGETS.columns else "target_id"
        match = DF_TARGETS[DF_TARGETS[id_col] == payload.target_site_id]
        if not match.empty:
            row_dict = match.iloc[0].to_dict()
            lat_pt = float(row_dict.get("latitude_deg", row_dict.get("lat", 0.0)))
            lon_pt = float(row_dict.get("longitude_deg", row_dict.get("lon", 0.0)))
            target_profile = resolve_planetary_point(
                body=str(row_dict.get("body", row_dict.get("planet", payload.target_body))),
                lat=lat_pt,
                lon=lon_pt,
                clip_for_knn=False,
            )

    if not target_profile and payload.custom_coordinates:
        target_profile = resolve_planetary_point(
            body=payload.target_body,
            lat=payload.custom_coordinates.lat,
            lon=payload.custom_coordinates.lon,
            clip_for_knn=False,
        )

    if not target_profile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either a valid target_site_id or custom_coordinates must be provided",
        )

    shared_17_target = target_profile["shared_17"]

    # 2. Determine Mission Weights
    preset_row = {}
    if not DF_PRESETS.empty and payload.mission_id:
        p_match = DF_PRESETS[DF_PRESETS["mission_id"] == payload.mission_id]
        if not p_match.empty:
            preset_row = p_match.iloc[0].to_dict()

    if payload.custom_weights:
        if any(k in DOMAIN_BUCKETS for k in payload.custom_weights):
            base_weights = compute_mission_weights(preset_row)
            active_weights = apply_domain_bucket_budgets(
                raw_feature_weights=base_weights,
                domain_budgets=payload.custom_weights,
            )
        else:
            active_weights = compute_mission_weights(payload.custom_weights)
    else:
        active_weights = compute_mission_weights(preset_row)

    # 3. Stage 1: Fast Candidate Retrieval (KNN BallTree)
    candidates_df = filter_candidates_knn(
        earth_df=DF_EARTH,
        target_row=shared_17_target,
        weights_map=active_weights,
        knn_k=payload.knn_k,
    )

    if candidates_df.empty:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No matching candidate sites could be retrieved",
        )

    # 4. Stage 2: TOPSIS Fine-Ranking & Diagnostics
    ranked_analogs = rank_candidates_topsis(
        candidate_df=candidates_df,
        target_row=shared_17_target,
        weights_map=active_weights,
        top_n=payload.top_n,
    )

    # 5. Synthesize Earth Testbed Protocol for Top Match
    top_site_id = ranked_analogs[0]["site_id"]
    top_site_match = candidates_df[candidates_df["site_id"] == top_site_id]
    top_site_raw = top_site_match.iloc[0].to_dict() if not top_site_match.empty else ranked_analogs[0]

    primary_protocol_data = protocol_engine.generate_protocol(
        target_profile=target_profile,
        matched_candidate=top_site_raw,
        mission_preset_id=payload.mission_id,
    )

    # Attach protocol directly to the Rank 1 analog result card
    ranked_analogs[0]["testbed_protocol"] = primary_protocol_data

    # 6. Assemble Final Response
    t_name = target_profile.get("site_name", f"{payload.target_body} Coordinate")
    target_summary = TargetProfileSummary(
        body=target_profile["body"],
        site_name=str(t_name),
        lat=float(target_profile["lat"]),
        lon=float(target_profile["lon"]),
        shared_17=shared_17_target,
        exclusive=target_profile.get("exclusive", {}),
    )

    return AnalogSearchResponse(
        target_profile=target_summary,
        mission_profile=payload.mission_id,
        active_weights=active_weights,
        total_candidates_evaluated=len(DF_EARTH),
        top_matches=ranked_analogs,
        primary_testbed_protocol=EarthTestbedProtocol(**primary_protocol_data),
    )