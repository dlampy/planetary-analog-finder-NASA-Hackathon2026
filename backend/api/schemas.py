"""
backend/api/schemas.py
Pydantic validation schemas for the Planetary Analog Finder REST API.
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
        None, description="Custom coordinates clicked on the Moon or Mars map"
    )
    mission_id: str = Field(
        "isru_extraction",
        description="Mission preset ID ('rover_mobility', 'isru_extraction', 'subsurface_habitat')",
    )
    custom_weights: Optional[Dict[str, float]] = Field(
        None, description="Optional overrides for individual factors or 4 domain sliders"
    )
    top_n: int = Field(10, ge=1, le=50, description="Number of ranked analog matches to return")
    knn_k: int = Field(25, ge=5, le=100, description="Stage 1 candidate filter pool size")


# ---------------------------------------------------------------------------
# 2. TESTBED PROTOCOL & DIAGNOSTIC SCHEMAS
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


class MacroFieldSiteProtocol(BaseModel):
    analog_site: str
    field_objective: str
    topographic_challenge: str


class RegolithSimulantProtocol(BaseModel):
    simulant_name: str
    producer: str
    mineralogy: str
    testing_utility: str
    ice_amendment: str


class BreakdownDiagnostic(BaseModel):
    dimension: str
    planetary_baseline: str
    earth_baseline: str
    impact_warning: str
    engineering_mitigation: str


class EarthTestbedProtocol(BaseModel):
    target_body: str
    target_coordinates: Dict[str, Optional[float]]
    macro_field_site: MacroFieldSiteProtocol
    micro_regolith_simulant: RegolithSimulantProtocol
    where_analogy_breaks_down: List[BreakdownDiagnostic]
    primary_mismatch: str
    mitigation_summary: str


class AnalogSiteResult(BaseModel):
    rank: int
    site_id: str
    site_name: str
    parent_biome: str
    lat: float
    lon: float
    knn_distance: float
    topsis_score: float
    domain_scores: Dict[str, float]
    features: Dict[str, float]
    categorical_features: Dict[str, str]
    similarity_Si: Dict[str, float]
    weakest_factor: FactorMetric
    strongest_factors: List[FactorMetric]
    out_of_earth_bounds: List[OutOfBoundsAlert]
    testbed_protocol: Optional[EarthTestbedProtocol] = None


# ---------------------------------------------------------------------------
# 3. RESPONSE SCHEMAS
# ---------------------------------------------------------------------------
class MissionPresetResponse(BaseModel):
    mission_id: str
    mission_name: str
    description: str
    weights: Dict[str, float]


class TargetProfileSummary(BaseModel):
    body: str
    site_name: str
    lat: float
    lon: float
    shared_17: Dict[str, Any]
    exclusive: Dict[str, Any]


class AnalogSearchResponse(BaseModel):
    target_profile: TargetProfileSummary
    mission_profile: str
    active_weights: Dict[str, float]
    total_candidates_evaluated: int
    top_matches: List[AnalogSiteResult]
    primary_testbed_protocol: EarthTestbedProtocol