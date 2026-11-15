#!/usr/bin/env python3
"""Fetch NASA POWER annual climatology features for a list of Earth sites.

Requirements:
    Python >= 3.10
    pip install requests

Examples:
    python nasa_power_features.py --input sites.csv
    python nasa_power_features.py --input sites.csv --output nasa_power_features.csv

Input CSV columns: site_id,latitude_deg,longitude_deg
Alternatively, edit the built-in SITES list below and run with no --input.
"""

from __future__ import annotations

import argparse
import csv
import logging
import math
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Sequence

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

API_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
COMMUNITY = "RE"
PARAMETERS = (
    "TS", "TS_MIN", "TS_MAX", "PRECTOTCORR", "WS2M", "ALLSKY_SRF_ALB"
)

# Replace with your complete list of 100 sites, or pass --input sites.csv.
SITES: list[list[Any]] = [
    ["chicago", 41.8781, -87.6298],
    ["atacama", -23.6500, -70.4000],
    ["sahara", 23.4000, 12.0000],
]

INPUT_COLUMNS = ["site_id", "latitude_deg", "longitude_deg"]
OUTPUT_COLUMNS = INPUT_COLUMNS + [
    "mean_surface_temp_c",
    "min_surface_temp_c",
    "max_surface_temp_c",
    "mean_annual_precipitation_mm",
    "mean_wind_speed_m_s",
    "surface_albedo",
    "water_ice_presence",
    "permafrost_presence",
]
FAILURE_COLUMNS = INPUT_COLUMNS + ["error"]

LOG = logging.getLogger("nasa_power")


class InvalidResponseError(ValueError):
    """NASA POWER returned incomplete, malformed, or unusable data."""


class ConfigurationError(RuntimeError):
    """A request setting is invalid; retrying other sites will not help."""


def finite_float(value: Any, name: str) -> float:
    """Parse a finite numeric value, rejecting missing values and -999 fill."""
    if value is None or isinstance(value, bool):
        raise InvalidResponseError(f"{name}: missing/non-numeric value {value!r}")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise InvalidResponseError(f"{name}: not a float: {value!r}") from exc
    if not math.isfinite(number) or number == -999.0:
        raise InvalidResponseError(f"{name}: missing/fill/non-finite value {value!r}")
    return number


def normalize_sites(records: Sequence[Sequence[Any]]) -> list[tuple[str, float, float]]:
    if not records:
        raise ValueError("Site list is empty.")

    seen: set[str] = set()
    sites: list[tuple[str, float, float]] = []
    for index, record in enumerate(records, start=1):
        if len(record) != 3:
            raise ValueError(f"Site row {index} must have exactly 3 values.")
        site_id = str(record[0]).strip() if record[0] is not None else ""
        if not site_id:
            raise ValueError(f"Site row {index}: empty site_id.")
        if site_id in seen:
            raise ValueError(f"Duplicate site_id: {site_id!r}.")
        lat = finite_float(record[1], f"{site_id}.latitude_deg")
        lon = finite_float(record[2], f"{site_id}.longitude_deg")
        if not -90 <= lat <= 90:
            raise ValueError(f"{site_id}: latitude {lat} outside [-90, 90].")
        if not -180 <= lon <= 180:
            raise ValueError(f"{site_id}: longitude {lon} outside [-180, 180].")
        seen.add(site_id)
        sites.append((site_id, lat, lon))
    return sites


def load_sites(path: Path) -> list[tuple[str, float, float]]:
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames is None or not set(INPUT_COLUMNS).issubset(reader.fieldnames):
            raise ValueError(f"Input CSV must contain columns: {', '.join(INPUT_COLUMNS)}")
        records = [tuple(row[field] for field in INPUT_COLUMNS) for row in reader]
    return normalize_sites(records)


def build_session() -> requests.Session:
    retry = Retry(
        total=4,  # 1 initial request + up to 4 retries
        connect=4,
        read=4,
        status=4,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        respect_retry_after_header=True,
        raise_on_status=False,
    )
    session = requests.Session()
    session.headers.update({
        "Accept": "application/json",
        "User-Agent": "NASA-POWER-Feature-Collector/1.0",
    })
    session.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=1, pool_maxsize=1))
    return session


def fetch_json(session: requests.Session, lat: float, lon: float, timeout: float) -> dict[str, Any]:
    params = {
        "parameters": ",".join(PARAMETERS),
        "community": COMMUNITY,
        "latitude": lat,
        "longitude": lon,
        "format": "JSON",
    }
    response = session.get(API_URL, params=params, timeout=(10.0, timeout))
    if response.status_code in (400, 422):
        raise ConfigurationError(
            f"NASA POWER rejected request (HTTP {response.status_code}): "
            f"{response.text[:240]!r}. Check parameter/community compatibility."
        )
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError as exc:
        raise InvalidResponseError("HTTP 200 but body is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise InvalidResponseError("JSON root must be an object")
    return payload


def parse_annual(payload: dict[str, Any]) -> dict[str, float]:
    """Only use 'ANN' climatology values, never monthly observations."""
    properties = payload.get("properties")
    parameters = properties.get("parameter") if isinstance(properties, dict) else None
    if not isinstance(parameters, dict):
        raise InvalidResponseError("Missing properties.parameter object in NASA response")

    values: dict[str, float] = {}
    for name in PARAMETERS:
        periods = parameters.get(name)
        if not isinstance(periods, dict) or "ANN" not in periods:
            raise InvalidResponseError(f"Missing annual (ANN) value for {name}")
        values[name] = finite_float(periods["ANN"], f"{name}.ANN")

    if values["TS_MIN"] > values["TS_MAX"]:
        raise InvalidResponseError("TS_MIN exceeds TS_MAX")
    if values["PRECTOTCORR"] < 0 or values["WS2M"] < 0:
        raise InvalidResponseError("Negative precipitation or wind speed")
    if not 0 <= values["ALLSKY_SRF_ALB"] <= 1:
        raise InvalidResponseError("Surface albedo outside the physical [0, 1] range")
    return values


def make_row(site: tuple[str, float, float], values: dict[str, float]) -> dict[str, str | int]:
    site_id, lat, lon = site
    mean_temp = values["TS"]  # threshold comparisons BEFORE rounding
    return {
        "site_id": site_id,
        "latitude_deg": f"{lat:.6f}",
        "longitude_deg": f"{lon:.6f}",
        "mean_surface_temp_c": f"{mean_temp:.2f}",
        "min_surface_temp_c": f"{values['TS_MIN']:.2f}",
        "max_surface_temp_c": f"{values['TS_MAX']:.2f}",
        "mean_annual_precipitation_mm": f"{values['PRECTOTCORR'] * 365:.2f}",
        "mean_wind_speed_m_s": f"{values['WS2M']:.2f}",
        "surface_albedo": f"{values['ALLSKY_SRF_ALB']:.2f}",
        "water_ice_presence": int(mean_temp < -5.0),
        "permafrost_presence": int(mean_temp < -8.0),
    }


def write_csv_atomic(path: Path, columns: list[str], rows: list[dict[str, Any]]) -> None:
    """Write without risking a truncated old file if writing fails."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as file:
            tmp_name = file.name
            writer = csv.DictWriter(file, fieldnames=columns, extrasaction="raise")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(tmp_name, path)
    finally:
        if tmp_name is not None and os.path.exists(tmp_name):
            os.unlink(tmp_name)


def collect(
    sites: list[tuple[str, float, float]], timeout: float, pause: float
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rows: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    session = build_session()
    try:
        for index, site in enumerate(sites, start=1):
            site_id, lat, lon = site
            try:
                payload = fetch_json(session, lat, lon, timeout)
                values = parse_annual(payload)
                rows.append(make_row(site, values))
                LOG.info("[%d/%d] OK: %s", index, len(sites), site_id)
            except ConfigurationError:
                raise  # A bad parameter affects every site: stop instead of 100 bad calls.
            except (requests.RequestException, InvalidResponseError) as exc:
                LOG.warning("[%d/%d] FAILED: %s: %s", index, len(sites), site_id, exc)
                failures.append({
                    "site_id": site_id,
                    "latitude_deg": f"{lat:.6f}",
                    "longitude_deg": f"{lon:.6f}",
                    "error": str(exc),
                })
            if index != len(sites) and pause > 0:
                time.sleep(pause)
    finally:
        session.close()
    return rows, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="CSV containing the sites; omit to use SITES list")
    parser.add_argument("--output", type=Path, default=Path("nasa_power_features.csv"))
    parser.add_argument("--failed", type=Path, default=Path("nasa_power_failed_sites.csv"))
    parser.add_argument("--timeout", type=float, default=45.0, help="Read timeout (seconds)")
    parser.add_argument("--pause", type=float, default=0.5, help="Seconds between sites")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("--timeout must be positive and finite")
    if not math.isfinite(args.pause) or args.pause < 0:
        parser.error("--pause must be nonnegative and finite")
    if args.output.resolve() == args.failed.resolve():
        parser.error("--output and --failed must be different files")
    try:
        sites = load_sites(args.input) if args.input is not None else normalize_sites(SITES)
        LOG.info("Collecting climatology for %d sites", len(sites))
        rows, failures = collect(sites, args.timeout, args.pause)
        write_csv_atomic(args.output, OUTPUT_COLUMNS, rows)
        write_csv_atomic(args.failed, FAILURE_COLUMNS, failures)
    except (OSError, ValueError, ConfigurationError, requests.RequestException) as exc:
        LOG.error("Collection stopped: %s", exc)
        return 1

    LOG.info("Done: %d successful, %d failed", len(rows), len(failures))
    LOG.info("Features: %s", args.output.resolve())
    LOG.info("Failures: %s", args.failed.resolve())
    if not rows:
        LOG.error("No valid rows; output contains only the CSV header")
        return 1
    return 2 if failures else 0  # 2 flags a partial result in automated pipelines.


if __name__ == "__main__":
    sys.exit(main())
