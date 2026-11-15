"""Stage 1 Candidate Retrieval using Weighted BallTree KNN across 17 shared factors."""

from __future__ import annotations

from typing import Any, Dict
import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

from .preprocessor import prepare_feature_matrices

__all__ = ["filter_candidates_knn"]


def filter_candidates_knn(
    earth_df: pd.DataFrame,
    target_row: pd.Series | Dict[str, Any],
    weights_map: Dict[str, float],
    knn_k: int = 25,
) -> pd.DataFrame:
    """Projects 17-factor Earth and target vectors into sqrt(w)-scaled space,
    fits a BallTree, and returns the top-k closest terrestrial analog rows.
    """
    if earth_df.empty:
        return pd.DataFrame()

    # 1. Build pre-scaled (M, 17) Earth matrix and (1, 17) Target vector in memory
    earth_knn_matrix, target_knn_vector, _, _ = prepare_feature_matrices(
        earth_df=earth_df,
        target_row=target_row,
        weights_map=weights_map,
    )

    # 2. Fit BallTree in O(N log N) and query top-k candidates
    n_candidates = min(knn_k, len(earth_df))
    nn = NearestNeighbors(
        n_neighbors=n_candidates,
        algorithm="ball_tree",
        metric="euclidean",
    )
    nn.fit(earth_knn_matrix)
    distances, indices = nn.kneighbors(target_knn_vector)

    # 3. Slice candidate DataFrame and attach Stage 1 spatial distance diagnostics
    top_candidates = earth_df.iloc[indices[0]].copy().reset_index(drop=True)
    top_candidates["knn_distance"] = np.round(distances[0], 4)
    top_candidates["preliminary_fidelity_pct"] = np.round(
        np.maximum(0.0, (1.0 - distances[0]) * 100.0), 1
    )

    return top_candidates