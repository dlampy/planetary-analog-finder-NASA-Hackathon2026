"""Extract terrain features from Open-Elevation for a CSV of sites.

Input: sites.csv with columns site_id,latitude_deg,longitude_deg
Output: open_elevation_features.csv

Install: python -m pip install aiohttp numpy pandas
Optional: export OPEN_ELEVATION_API_KEY=your_key
Run: python open_elevation_features.py --input sites.csv
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import math
import os
import random
from pathlib import Path

import aiohttp
import numpy as np
import pandas as pd

API_URL = "https://api.open-elevation.com/api/v1/lookup"
DELTA_DEG = 0.0005
SITES_PER_BATCH = 10
MAX_CONCURRENT_REQUESTS = 2
MAX_ATTEMPTS = 5
EARTH_RADIUS_M = 6_371_008.8
OFFSETS = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
LOGGER = logging.getLogger("terrain")


class BatchFailure(Exception):
    """Batch cannot be used; subdivide the batch by site."""


def load_sites(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype={"site_id": "string"})
    columns = ["site_id", "latitude_deg", "longitude_deg"]
    missing = set(columns) - set(df.columns)
    if missing:
        raise ValueError(f"Missing input columns: {sorted(missing)}")
    df = df[columns].copy()
    for name in ("latitude_deg", "longitude_deg"):
        df[name] = pd.to_numeric(df[name], errors="coerce")
    valid = (
        df["site_id"].notna()
        & df["site_id"].str.strip().ne("").fillna(False)
        & np.isfinite(df["latitude_deg"].to_numpy(dtype=np.float64))
        & np.isfinite(df["longitude_deg"].to_numpy(dtype=np.float64))
        & df["latitude_deg"].between(-90 + DELTA_DEG, 90 - DELTA_DEG)
        & df["longitude_deg"].between(-180, 180)
    )
    bad = int((~valid).sum())
    if bad:
        LOGGER.warning("Skipping %d sites with invalid/missing coordinates or IDs", bad)
    df = df.loc[valid].reset_index(drop=True)
    if df["site_id"].duplicated().any():
        raise ValueError("site_id values must be unique")
    return df


def wrap_longitude(lon: float) -> float:
    return (lon + 180.0) % 360.0 - 180.0


def sample_grid(site: dict) -> list[dict[str, float]]:
    lat = float(site["latitude_deg"])
    lon = float(site["longitude_deg"])
    return [
        {"latitude": lat + dy * DELTA_DEG,
         "longitude": wrap_longitude(lon + dx * DELTA_DEG)}
        for dy, dx in OFFSETS
    ]


def compute_features(site: dict, elevations: np.ndarray) -> dict:
    z = elevations.astype(np.float64).reshape(3, 3)
    lat = float(site["latitude_deg"])
    # Grid rows: south, center, north; columns: west, center, east.
    center, north, east = z[1, 1], z[2, 1], z[1, 2]
    delta_rad = math.radians(DELTA_DEG)
    distance_north = EARTH_RADIUS_M * delta_rad
    distance_east = distance_north * math.cos(math.radians(lat))
    # At the poles an E/W angular offset has virtually zero physical length.
    if distance_east < 0.01:
        raise ValueError("East-west spacing too small near a pole")
    dy = (north - center) / distance_north
    dx = (east - center) / distance_east
    slope = math.degrees(math.atan(math.hypot(dx, dy)))
    roughness = float(np.std(z, ddof=0))  # all 9 points; population STD
    return {
        "site_id": site["site_id"],
        "latitude_deg": lat,
        "longitude_deg": float(site["longitude_deg"]),
        "elevation_m": float(center),
        "mean_slope_deg": float(slope),
        "terrain_roughness_m": roughness,
    }


async def post_batch(
    session: aiohttp.ClientSession,
    sites: list[dict],
    semaphore: asyncio.Semaphore,
) -> list[dict]:
    points = [p for site in sites for p in sample_grid(site)]
    async with semaphore:
        for attempt in range(MAX_ATTEMPTS):
            try:
                async with session.post(API_URL, json={"locations": points}) as response:
                    if response.status == 429 or 500 <= response.status <= 599:
                        retry_after = response.headers.get("Retry-After", "")
                        try:
                            delay = float(retry_after)
                            if not math.isfinite(delay) or delay < 0:
                                raise ValueError
                        except ValueError:
                            delay = min(2 ** attempt + random.uniform(0, 0.5), 30)
                        if attempt + 1 == MAX_ATTEMPTS:
                            raise BatchFailure(f"HTTP {response.status} after retries")
                        LOGGER.warning("HTTP %d; retry in %.1fs", response.status, delay)
                        await asyncio.sleep(min(delay, 120.0))
                        continue
                    if response.status != 200:
                        body = (await response.text())[:300]
                        raise BatchFailure(f"HTTP {response.status}: {body}")
                    data = await response.json(content_type=None)
                    results = data.get("results") if isinstance(data, dict) else None
                    if not isinstance(results, list) or len(results) != len(points):
                        raise BatchFailure("API response has wrong number of points")
                    heights = []
                    for requested, item in zip(points, results):
                        if not isinstance(item, dict):
                            raise BatchFailure("Invalid result item")
                        try:
                            actual_lat = float(item["latitude"])
                            actual_lon = float(item["longitude"])
                            height = float(item["elevation"])
                        except (KeyError, TypeError, ValueError) as exc:
                            raise BatchFailure("Missing/non-numeric API response field") from exc
                        lon_diff = (actual_lon - requested["longitude"] + 180) % 360 - 180
                        if (not all(map(math.isfinite, (actual_lat, actual_lon, height)))
                            or abs(actual_lat - requested["latitude"]) > 1e-4
                            or abs(lon_diff) > 1e-4):
                            raise BatchFailure("Invalid/mismatched returned coordinate/elevation")
                        heights.append(height)
                    vals = np.asarray(heights, dtype=np.float64).reshape(len(sites), 9)
                    output = []
                    for site, heights_for_site in zip(sites, vals):
                        try:
                            output.append(compute_features(site, heights_for_site))
                        except (ValueError, ArithmeticError) as exc:
                            LOGGER.warning("Skipping %s: %s", site["site_id"], exc)
                    return output
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                if attempt + 1 == MAX_ATTEMPTS:
                    raise BatchFailure(f"Network error after retries: {exc}") from exc
                delay = min(2 ** attempt + random.uniform(0, 0.5), 30)
                LOGGER.warning("Network error (%s); retry in %.1fs", exc, delay)
                await asyncio.sleep(delay)
    raise BatchFailure("Batch exhausted retries")


async def process_with_fallback(
    session: aiohttp.ClientSession, sites: list[dict], semaphore: asyncio.Semaphore
) -> list[dict]:
    try:
        return await post_batch(session, sites, semaphore)
    except BatchFailure as exc:
        if len(sites) == 1:
            LOGGER.error("Skipping site %s: %s", sites[0]["site_id"], exc)
            return []
        LOGGER.warning("Batch of %d failed (%s); splitting by site", len(sites), exc)
        half = len(sites) // 2
        left, right = await asyncio.gather(
            process_with_fallback(session, sites[:half], semaphore),
            process_with_fallback(session, sites[half:], semaphore),
        )
        return left + right


async def extract(sites: pd.DataFrame) -> list[dict]:
    timeout = aiohttp.ClientTimeout(total=50, connect=15)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    headers = {"Accept": "application/json"}
    api_key = os.getenv("OPEN_ELEVATION_API_KEY", "").strip()
    if api_key:
        headers["X-API-Key"] = api_key
    else:
        LOGGER.warning("No API key set: 900 samples may exceed the public anonymous quota")
    records = sites.to_dict(orient="records")
    batches = [records[i:i + SITES_PER_BATCH] for i in range(0, len(records), SITES_PER_BATCH)]
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT_REQUESTS)
    async with aiohttp.ClientSession(timeout=timeout, headers=headers, connector=connector) as session:
        groups = await asyncio.gather(
            *(process_with_fallback(session, batch, semaphore) for batch in batches)
        )
    return [record for group in groups for record in group]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("sites.csv"))
    parser.add_argument("--output", type=Path, default=Path("open_elevation_features.csv"))
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    sites = load_sites(args.input)
    if sites.empty:
        raise SystemExit("No valid sites in input")
    records = asyncio.run(extract(sites))
    columns = ["site_id", "latitude_deg", "longitude_deg", "elevation_m",
               "mean_slope_deg", "terrain_roughness_m"]
    result = pd.DataFrame(records, columns=columns)
    numeric = columns[1:]
    if not result.empty:
        result[numeric] = result[numeric].astype(np.float64)
        result = result.replace([np.inf, -np.inf], np.nan).dropna(subset=numeric)
    result.to_csv(args.output, index=False, float_format="%.8f")
    LOGGER.info("Exported %d/%d sites to %s", len(result), len(sites), args.output)
    if len(result) != len(sites):
        LOGGER.warning("%d sites were omitted because lookup/calculation failed", len(sites) - len(result))


if __name__ == "__main__":
    main()
