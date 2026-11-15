"""FastAPI application entrypoint for the Planetary Analog Finder backend.

Run from repository root:
    uvicorn backend.main:app --reload --port 8000
Or from backend/:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

from pathlib import Path
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

BACKEND_DIR = Path(__file__).resolve().parent
REPO_DIR = BACKEND_DIR.parent
FRONTEND_DIR = REPO_DIR / "frontend"
DATA_DIR = BACKEND_DIR / "data"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from api.routes import router as analog_router  # noqa: E402

app = FastAPI(
    title="Planetary Analog Finder API",
    description="Two-stage BallTree KNN + TOPSIS planetary analog matching backend.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analog_router)

if DATA_DIR.exists():
    app.mount("/backend/data", StaticFiles(directory=str(DATA_DIR)), name="backend-data")

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
