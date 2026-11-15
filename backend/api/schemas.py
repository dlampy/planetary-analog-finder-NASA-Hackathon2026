"""backend/api/schemas.py

Pydantic validation models for the Planetary Analog Finder REST API.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 1. REQUEST SCHEMAS
# ---------------------------------------------------------------------------
class Coordinates(BaseModel):
    lat: float = Field(..., ge=-90.0, le=90.0, description="Latitude in decimal degrees")
    lon: float = Field(..., ge=-180.0, le=180.0, description="Longitude in decimal degrees")


class ResolveTargetRequest(BaseModel):
    body: str = Field(..., description="Target planetary body: 'Moon' or 'Mars'")
    coordinates: Coordinates


class AnalogSearchRequest(BaseModel):
    target_body: str = Field("Moon", description="Target body: 'Moon' or 'Mars'")
    target_site_id: Optional[str] = Field(
        None, description="Preset target site ID (e.g., 'MOON_001', 'MARS_001')"
    )
    custom_coordinates: Optional[Coordinates] = Field(
        None, description="Custom coordinates clicked on the planetary map"
    )
    mission_id: str = Field(
        "rover_mobility",
        description="Preset mission ID (e.g., 'rover_mobility', 'isru_extraction')",
    )
    custom_weights: Optional[Dict[str, float]] = Field(
        None,
        description="Optional overrides for individual factors or domain sliders",
    )
    top_n: int = Field(10, ge=1, le=50, description="Number of analog matches to return")
    knn_k: int = Field(25, ge=5, le=100, description="Stage 1 candidate pool size")


# ---------------------------------------------------------------------------
# 2. DIAGNOSTIC & BREAKDOWN SCHEMAS
# ---------------------------------------------------------------------------
class FactorMetric(BaseModel):
    feature: str
    label: str
    fidelity_pct: float


class OutOfBoundsAlert(BaseModel):
    feature: str
    label: str
    target_value: float
    earth_range: List[float]
    unit: str


class AnalogSiteResult(BaseModel):
    rank: int
    site_id: str
    site_name: str
    parent_biome: str
    lat: float
    lon: float
    knn_distance: float
    topsis_score: float
    domain_scores: Dict[str, float]  # Topography, Geology, Thermal, Cryosphere
    features: Dict[str, float]       # Continuous & binary raw metrics
    categorical_features: Dict[str, str]  # Rock, mineral, and dust classes
    similarity_Si: Dict[str, float]  # 0-100% per-factor closeness scores
    weakest_factor: FactorMetric     # "Where the analogy breaks down"
    strongest_factors: List[FactorMetric]
    out_of_earth_bounds: List[OutOfBoundsAlert]


# ---------------------------------------------------------------------------
# 3. RESPONSE SCHEMAS
# ---------------------------------------------------------------------------
class MissionPresetResponse(BaseModel):
    mission_id: str
    mission_name: str
    description: str
    weights: Dict[str, float]


class TargetSiteResponse(BaseModel):
    site_id: str
    body: str
    target_name: str
    parent_region: Optional[str] = None
    lat: float
    lon: float
    features: Dict[str, Any]


class TargetProfileSummary(BaseModel):
    body: str
    site_name: str
    lat: float
    lon: float
    features: Dict[str, Any]


class AnalogSearchResponse(BaseModel):
    target_profile: TargetProfileSummary
    mission_profile: str
    active_weights: Dict[str, float]
    total_candidates_evaluated: int
    top_matches: List[AnalogSiteResult]