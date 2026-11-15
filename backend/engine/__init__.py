"""Planetary Analog Finder - Core Mathematical & Machine Learning Engine.

Exposes preprocessing transformations, candidate retrieval (KNN BallTree),
and multi-criteria closeness ranking (TOPSIS) across 17 planetary factors,
as well as the 5-factor placeholder matcher (`get_top_analogs`).
"""

from __future__ import annotations

from typing import Any, List

__all__: List[str] = [
    # Metadata, feature definitions & domain buckets
    "FEATURE_META",
    "ACTIVE_FEATURES",
    "DOMAIN_BUCKETS",
    # Preprocessor functions
    "compute_mission_weights",
    "apply_domain_bucket_budgets",
    "prepare_feature_matrices",
    "normalize_clipped",
    "normalize_unclipped",
    # Stage 1: Candidate retrieval
    "filter_candidates_knn",
    # Stage 2: MCDA ranking & diagnostics
    "rank_candidates_topsis",
    # Legacy / placeholder 5-factor matcher
    "get_top_analogs",
    # Resolvers & testbed protocol
    "resolve_planetary_point",
    "resolve_planetary_coordinate",
    "resolve_earth_coordinate",
    "build_earth_catalog",
    "EarthTestbedProtocolEngine",
]


def __getattr__(name: str) -> Any:
    """Dynamically imports and resolves engine symbols upon first access,
    preventing circular import loops and heavy startup memory overhead.
    """
    # 0. Placeholder 5-factor matcher
    if name == "get_top_analogs":
        from .matcher import get_top_analogs

        return get_top_analogs

    # 1. Preprocessing, Metadata, and Domain Groupings
    if name in (
        "FEATURE_META",
        "ACTIVE_FEATURES",
        "DOMAIN_BUCKETS",
        "compute_mission_weights",
        "apply_domain_bucket_budgets",
        "prepare_feature_matrices",
        "normalize_clipped",
        "normalize_unclipped",
    ):
        from . import preprocessor

        return getattr(preprocessor, name)

    # 2. Stage 1 Retrieval: BallTree KNN
    if name == "filter_candidates_knn":
        from .knn_filter import filter_candidates_knn

        return filter_candidates_knn

    # 3. Stage 2 Fine Ranking: Dual-Ideal TOPSIS
    if name == "rank_candidates_topsis":
        from .topsis_ranker import rank_candidates_topsis

        return rank_candidates_topsis

    # 4. Planetary Target Ingestion & Coordinate Snapping
    if name in ("resolve_planetary_point", "resolve_planetary_coordinate"):
        from .resolvers.planetary_resolver import resolve_planetary_point

        return resolve_planetary_point

    # 5. Testbed Protocol Generator
    if name == "EarthTestbedProtocolEngine":
        from .testbed_protocol import EarthTestbedProtocolEngine

        return EarthTestbedProtocolEngine

    # 5. Terrestrial Catalog & Coordinate Ingestion
    if name in ("resolve_earth_coordinate", "build_earth_catalog"):
        try:
            from . import earth_resolver

            return getattr(earth_resolver, name)
        except ImportError:
            raise AttributeError(
                f"module {__name__!r} has no attribute {name!r} (earth_resolver.py not found)"
            )

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> List[str]:
    """Ensures IDE auto-completion and REPL inspection discover all exported symbols."""
    return sorted(list(globals().keys()) + __all__)
