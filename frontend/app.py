# In app.py
from __future__ import annotations

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from typing import Any, Dict

# Detect backend directory robustly
ROOT_DIR = Path(__file__).resolve().parent

if (ROOT_DIR / "backend").exists():
    BACKEND_DIR = ROOT_DIR / "backend"
elif (ROOT_DIR.parent / "backend").exists():
    BACKEND_DIR = ROOT_DIR.parent / "backend"
else:
    BACKEND_DIR = ROOT_DIR

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Now import cleanly from engine
from engine.matcher import build_placeholder_bundle, resolve_site_test_info  # noqa: E402

DATA_DIR = BACKEND_DIR / "data"
OUTPUT_JSON = ROOT_DIR / "assets" / "data" / "analogs_results.json"


def build_all_results() -> Dict[str, Any]:
    return build_placeholder_bundle(DATA_DIR)


def export_json(output_path: Path = OUTPUT_JSON) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    data = build_all_results()
    output_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Analog JSON or serve static web UI.")
    parser.add_argument("--export-json", action="store_true", help="Export precomputed JSON and exit.")
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