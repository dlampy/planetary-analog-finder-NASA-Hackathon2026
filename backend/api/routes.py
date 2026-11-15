"""backend/api/routes.py

FastAPI route definitions for planetary coordinate resolution,
preset catalog queries, and two-stage analog search execution.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException, status
import pandas as pd

from engine import (
    ACTIVE_FEATURES,
    DOMAIN_BUCKETS,
    FEATURE_META,
    apply_domain_bucket_budgets,
    compute_mission_weights,
    filter_candidates_knn,
    rank_candidates_topsis,
    resolve_planetary_coordinate,
)
from .schemas import (
    AnalogSearchRequest,
    AnalogSearchResponse,
    MissionPresetResponse,
    ResolveTargetRequest,
    TargetProfileSummary,
    TargetSiteResponse,
)

router = APIRouter(prefix="/api", tags=["Planetary Analogs"])

# ---------------------------------------------------------------------------
# 1. DATA CACHE & INITIALIZATION
# ---------------------------------------------------------------------------
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

try:
    DF_EARTH = pd.read_csv(DATA_DIR / "earth_analogs.csv")
    DF_TARGETS = pd.read_csv(DATA_DIR / "planetary_targets.csv")
    DF_PRESETS = pd.read_csv(DATA_DIR / "mission_presets.csv")
except Exception as e:
    # Graceful fallback during tests or initial setup
    DF_EARTH = pd.DataFrame()
    DF_TARGETS = pd.DataFrame()
    DF_PRESETS = pd.DataFrame()


# ---------------------------------------------------------------------------
# 2. METADATA & PRESET ENDPOINTS
# ---------------------------------------------------------------------------
@router.get("/domains", response_model=Dict[str, List[str]])
def get_domain_buckets() -> Dict[str, List[str]]:
    """Returns the 4 domain bucket groupings for UI sliders and radar charts."""
    return DOMAIN_BUCKETS


@router.get("/presets", response_model=List[MissionPresetResponse])
def list_mission_presets() -> List[MissionPresetResponse]:
    """Returns all available mission scenarios and their baseline weights."""
    if DF_PRESETS.empty:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Mission presets catalog not loaded",
        )

    presets: List[MissionPresetResponse] = []
    for _, row in DF_PRESETS.iterrows():
        weights_map = compute_mission_weights(row)
        presets.append(
            MissionPresetResponse(
                mission_id=str(row["mission_id"]),
                mission_name=str(row["mission_name"]),
                description=str(row.get("description", "")),
                weights=weights_map,
            )
        )
    return presets


@router.get("/targets", response_model=List[TargetSiteResponse])
def list_planetary_targets(body: Optional[str] = None) -> List[TargetSiteResponse]:
    """Returns pre-compiled Moon and Mars reference target sites."""
    if DF_TARGETS.empty:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Planetary targets catalog not loaded",
        )

    df = DF_TARGETS
    if body:
        df = df[df["body"].str.lower() == body.strip().lower()]

    targets: List[TargetSiteResponse] = []
    for _, row in df.iterrows():
        site_features = {
            col: row[col] for col in ACTIVE_FEATURES if col in row
        }
        site_name = row.get("site_name", row.get("target_name", "Unknown Target"))
        parent_region = row.get("parent_region", row.get("parent_biome", None))

        targets.append(
            TargetSiteResponse(
                site_id=str(row["site_id"]),
                body=str(row["body"]),
                target_name=str(site_name),
                parent_region=str(parent_region) if parent_region else None,
                lat=float(row.get("latitude_deg", row.get("lat", 0.0))),
                lon=float(row.get("longitude_deg", row.get("lon", 0.0))),
                features=site_features,
            )
        )
    return targets


# ---------------------------------------------------------------------------
# 3. COORDINATE RESOLVER ENDPOINT
# ---------------------------------------------------------------------------
@router.post("/resolve", response_model=Dict[str, Any])
def resolve_coordinate(payload: ResolveTargetRequest) -> Dict[str, Any]:
    """Snaps an arbitrary clicked Moon/Mars coordinate to an environmental vector."""
    try:
        resolved = resolve_planetary_coordinate(
            body=payload.body,
            lat=payload.coordinates.lat,
            lon=payload.coordinates.lon,
        )
        return resolved
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to resolve planetary coordinates: {exc}",
        )


# ---------------------------------------------------------------------------
# 4. PRIMARY ANALOG SEARCH ENDPOINT
# ---------------------------------------------------------------------------
@router.post("/search", response_model=AnalogSearchResponse)
def search_analogs(payload: AnalogSearchRequest) -> AnalogSearchResponse:
    """Executes Stage 1 KNN BallTree filtering and Stage 2 TOPSIS fine ranking."""
    if DF_EARTH.empty:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Earth analogs catalog is unavailable",
        )

    # 1. Resolve the Target Site Vector
    target_row: Dict[str, Any] = {}
    if payload.target_site_id and not DF_TARGETS.empty:
        match = DF_TARGETS[DF_TARGETS["site_id"] == payload.target_site_id]
        if not match.empty:
            target_row = match.iloc[0].to_dict()

    if not target_row and payload.custom_coordinates:
        target_row = resolve_planetary_coordinate(
            body=payload.target_body,
            lat=payload.custom_coordinates.lat,
            lon=payload.custom_coordinates.lon,
        )

    if not target_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either a valid target_site_id or custom_coordinates must be provided",
        )

    # 2. Determine Mission Weights
    preset_row = {}
    if not DF_PRESETS.empty and payload.mission_id:
        p_match = DF_PRESETS[DF_PRESETS["mission_id"] == payload.mission_id]
        if not p_match.empty:
            preset_row = p_match.iloc[0].to_dict()

    if payload.custom_weights:
        # Check if the user passed 4 domain-level budget sliders
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

    # 3. Stage 1: Fast Candidate Retrieval via BallTree KNN
    candidates_df = filter_candidates_knn(
        earth_df=DF_EARTH,
        target_row=target_row,
        weights_map=active_weights,
        knn_k=payload.knn_k,
    )

    if candidates_df.empty:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No matching candidate sites could be retrieved",
        )

    # 4. Stage 2: TOPSIS Fine-Ranking & Diagnostic Synthesis
    ranked_analogs = rank_candidates_topsis(
        candidate_df=candidates_df,
        target_row=target_row,
        weights_map=active_weights,
        top_n=payload.top_n,
    )

    # 5. Build Response Payload
    t_name = target_row.get("site_name", target_row.get("target_name", "Resolved Target"))
    t_lat = float(target_row.get("latitude_deg", target_row.get("lat", 0.0)))
    t_lon = float(target_row.get("longitude_deg", target_row.get("lon", 0.0)))

    target_summary = TargetProfileSummary(
        body=str(target_row.get("body", payload.target_body)),
        site_name=str(t_name),
        lat=t_lat,
        lon=t_lon,
        features={
            k: target_row[k] for k in ACTIVE_FEATURES if k in target_row
        },
    )

    return AnalogSearchResponse(
        target_profile=target_summary,
        mission_profile=payload.mission_id,
        active_weights=active_weights,
        total_candidates_evaluated=len(DF_EARTH),
        top_matches=ranked_analogs,
    )