"""Generate precomputed JSON for index.html and provide resilient fallback notes for site_tests.csv."""

from __future__ import annotations

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict

import pandas as pd

from engine.matcher import ACTIVE_FEATURES, FEATURE_META, compute_mission_weights, get_top_analogs

ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
OUTPUT_JSON = ROOT_DIR / "assets" / "data" / "analogs_results.json"


def _planet_physical_limits(planet: str) -> str:
    p = planet.strip().lower()
    if p == "moon":
        return "Trọng lực Trái Đất (1g) cao gấp ~6 lần Mặt Trăng (0.165g); có khí quyển 1 atm và từ trường chắn bức xạ thay vì chân không và bụi regolith sắc nhọn."
    return "Trọng lực Trái Đất (1g) cao gấp ~2.6 lần Sao Hỏa (0.38g); áp suất 1 atm giàu O₂/N₂ khác hẳn khí quyển 95% CO₂ loãng và bức xạ bề mặt Sao Hỏa."


def _default_source_url(planet: str) -> str:
    return "https://pds-geosciences.wustl.edu/missions/lro/" if planet.strip().lower() == "moon" else "https://pds.nasa.gov/"


def resolve_site_test_info(
    earth_item: Dict[str, Any],
    target_row: pd.Series,
    mission_row: pd.Series,
    site_tests_df: pd.DataFrame,
) -> Dict[str, Any]:
    """Lookup site_tests.csv (exact site+mission -> site-only -> dynamic scientific fallback)."""
    site_id = earth_item["site_id"]
    mission_id = str(mission_row["mission_id"])
    planet = str(target_row["planet"])
    target_name = str(target_row["target_name"])

    if not site_tests_df.empty:
        exact = site_tests_df[
            (site_tests_df["site_id"] == site_id) & (site_tests_df["mission_id"] == mission_id)
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
                "technology_to_test": str(mission_row["technology_to_test"]),
                "why_suitable": f"Ghi chú nền ({earth_item['micro_site_name']}): {r['why_suitable']}",
                "analogy_limitations": str(r["analogy_limitations"]),
                "source_url": str(r["source_url"]),
            }

    # Dynamic scientific fallback when site_tests.csv does not contain this (site_id, mission_id)
    si = earth_item["similarity_Si"]
    strongest = earth_item["strongest_factors"]
    weakest = earth_item["weakest_factor"]

    top_desc = " và ".join(
        f"{FEATURE_META[col]['label']} ({si[col]}%)" for col in strongest
    )
    why_parts = [
        f"Thuộc vùng {earth_item['parent_biome']} ({earth_item['micro_site_name']}), tương đồng nổi bật với {target_name} ở {top_desc}."
    ]
    if int(earth_item["features"].get("has_subsurface_void", 0)) == 1:
        why_parts.append("Có cấu trúc hang/ống ngầm hỗ trợ thử nghiệm khảo sát và che chắn bức xạ.")

    weak_label = FEATURE_META[weakest]["label"]
    limit_parts = [
        f"Yếu tố lệch nhiều nhất: {weak_label} (chỉ đạt {si[weakest]}% tương đồng).",
        _planet_physical_limits(planet),
    ]
    if earth_item.get("out_of_earth_bounds"):
        oob_labels = ", ".join(
            f"{o['label']} ({o['target_value']}{o['unit']})" for o in earth_item["out_of_earth_bounds"]
        )
        limit_parts.append(f"Cảnh báo ngoài ngưỡng Trái Đất tại {target_name}: {oob_labels}.")

    tech = str(mission_row["technology_to_test"])
    if int(earth_item["features"].get("has_subsurface_void", 0)) == 0 and mission_id == "lava_tube_habitat":
        tech += " (Lưu ý: điểm này không có hang ngầm tự nhiên, chỉ thử phần địa hình bề mặt/thông tin vô tuyến)."

    return {
        "is_fallback_note": True,
        "technology_to_test": tech,
        "why_suitable": " ".join(why_parts),
        "analogy_limitations": " ".join(limit_parts),
        "source_url": _default_source_url(planet),
    }


def build_all_results() -> Dict[str, Any]:
    earth_df = pd.read_csv(DATA_DIR / "earth_sites_1000.csv")
    targets_df = pd.read_csv(DATA_DIR / "planetary_bases.csv")
    missions_df = pd.read_csv(DATA_DIR / "missions.csv")
    site_tests_path = DATA_DIR / "site_tests.csv"
    site_tests_df = pd.read_csv(site_tests_path) if site_tests_path.exists() else pd.DataFrame()

    payload: Dict[str, Any] = {
        "meta": {
            "active_features": ACTIVE_FEATURES,
            "excluded_features": ["lithology_type"],
            "earth_site_count": int(len(earth_df)),
            "algorithm": "Stage 1: Weighted BallTree KNN (Top 25) -> Stage 2: Analog TOPSIS (Top 10)",
        },
        "targets": [],
        "missions": [],
        "results": {},
    }

    for _, trow in targets_df.iterrows():
        payload["targets"].append(
            {
                "target_id": str(trow["target_id"]),
                "planet": str(trow["planet"]).lower(),
                "target_name": str(trow["target_name"]),
                "lat": float(trow["lat"]),
                "lon": float(trow["lon"]),
                "features": {c: float(trow[c]) for c in ACTIVE_FEATURES},
            }
        )

    for _, mrow in missions_df.iterrows():
        payload["missions"].append(
            {
                "mission_id": str(mrow["mission_id"]),
                "mission_type": str(mrow["mission_type"]),
                "technology_to_test": str(mrow["technology_to_test"]),
                "footprint_mode": str(mrow["footprint_mode"]),
                "weights": compute_mission_weights(mrow),
            }
        )

    for _, trow in targets_df.iterrows():
        t_id = str(trow["target_id"])
        payload["results"][t_id] = {}
        for _, mrow in missions_df.iterrows():
            m_id = str(mrow["mission_id"])
            ranked = get_top_analogs(earth_df, trow, mrow, knn_k=25, top_n=10)
            for item in ranked:
                item.update(resolve_site_test_info(item, trow, mrow, site_tests_df))
                item["footprint_mode"] = str(mrow["footprint_mode"])
            payload["results"][t_id][m_id] = ranked

    return payload


def export_json(output_path: Path = OUTPUT_JSON) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    data = build_all_results()
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Analog JSON or serve static web UI.")
    parser.add_argument("--serve", action="store_true", help="Export JSON then start HTTP server.")
    parser.add_argument("--port", type=int, default=8080, help="Port for --serve (default: 8080).")
    args = parser.parse_args()

    out = export_json()
    print(f"Exported precomputed TOPSIS results to: {out}")

    if args.serve:
        class RootHandler(SimpleHTTPRequestHandler):
            def __init__(self, *h_args, **h_kwargs):
                super().__init__(*h_args, directory=str(ROOT_DIR), **h_kwargs)

        print(f"Serving UI at http://localhost:{args.port}/index.html")
        ThreadingHTTPServer(("127.0.0.1", args.port), RootHandler).serve_forever()


if __name__ == "__main__":
    main()
