# Backend, ML Engine & Data Pipeline (`backend/`)

FastAPI REST server, mathematical planetary analog matching engine, Moon/Mars coordinate resolvers, DEM terrain extractor, and multi-source Earth/Planetary data preparation pipeline for **DLT_NASAHackathon2026**.

See also: [Root README](../README.md) | [Frontend README](../frontend/README.md)

---

## 1. Architecture Overview

The backend is structured into four layers:

1. **API Layer (`backend/main.py`, `backend/api/`)**:
   - FastAPI application with permissive CORS (`*`), static mounts for `/backend/data` and `/` (`frontend/`), and Pydantic v2 validation schemas.
2. **Matching & Testbed Engine (`backend/engine/`)**:
   - **5-Factor Frontend-Aligned Pipeline (`engine/matcher.py`)**: Two-stage Weighted BallTree KNN → Analog TOPSIS across `slope_deg`, `mean_temp_c`, `temp_swing_c`, `aridity_ice_idx`, and `has_subsurface_void`, plus curated `site_tests.csv` lookup and automated scientific fallback notes. Powers `/api/analogs/bundle`, `/api/analogs/match`, and `frontend/app.py --export-json`.
   - **17-Factor Analytical Pipeline (`engine/preprocessor.py`, `knn_filter.py`, `topsis_ranker.py`, `testbed_protocol.py`)**: Full multi-domain KNN → TOPSIS across **4 Domain Buckets** (`topography`, `geology`, `thermal`, `cryosphere`), pairwise rock/mineral compatibility matrices (`LITHOLOGY_MATRIX`, `MINERAL_MATRIX`, `DUST_ORDINAL_MAP`), out-of-Earth-bounds flags, and three-tier **Earth Testbed Protocol** synthesis (`EarthTestbedProtocolEngine`). Powers `/api/search`.
3. **Planetary Coordinate Resolver (`engine/planetary_resolver.py`, `engine/resolvers/`)**:
   - Indexes 100 lunar zones (`data/Moon.csv`) and 100 Martian zones (`data/mars.csv`) in in-memory `scipy.spatial.cKDTree` spatial indexes (`< 1 ms` lookup), falling back to analytical physics (`moon_resolver.py`, `mars_resolver.py`) if CSV tables are missing.
4. **3D Terrain DEM Extractor (`engine/terrain_fetcher.py`)**:
   - Retrieves elevation grids (`24x24` to `128x128`) around arbitrary `(planet, lat, lon, radius_km)` patches and provides an allowlisted HTTPS tile proxy for browser textures.

---

## 2. Installation & Running Locally

### Core Installation
```bash
# From DLT_NASAHackathon2026/
pip install -r backend/requirements.txt
```

`backend/requirements.txt` installs:
- `numpy>=1.24.0`, `pandas>=2.0.0`, `scikit-learn>=1.3.0`, `scipy>=1.11.0`
- `fastapi>=0.110.0`, `uvicorn>=0.29.0`, `requests>=2.31.0`, `pydantic>=2.6.2`

### Optional Packages (Server-Side DEM Raster Support)
`engine/terrain_fetcher.py` works out of the box with the core requirements above (via Open-Meteo Copernicus DEM 90m and orbital resolver synthesis), and enables higher-resolution direct raster extraction if these optional packages are installed:
- **`Pillow`**: Enables server-side decoding of RGB-encoded **AWS Mapzen Terrarium DEM** PNG tiles (`_fetch_earth_terrarium`).
- **`rasterio`**: Enables windowed **Cloud-Optimized GeoTIFF (COG)** streaming from USGS Astrogeology (`Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif` and `Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif`).

### Start the Server
```bash
# Option 1: From repository root (serves both API and frontend at http://127.0.0.1:8000)
python -m uvicorn backend.main:app --reload --port 8000

# Option 2: Direct execution
python backend/main.py
```

Interactive OpenAPI / Swagger documentation is available at `http://127.0.0.1:8000/docs`.

---

## 3. REST API Reference (`backend/api/routes.py`)

All endpoints are registered under `/api`:

| Method & Path | Handler | Purpose & Parameters |
| :--- | :--- | :--- |
| `GET /api/health` | `get_health` | Reports loaded status, engine mode (`full_17_factor` or `placeholder_5_factor`), and dataset counts. |
| `GET /api/domains` | `get_domain_buckets` | Returns the 4 domain bucket feature groupings (`topography`, `geology`, `thermal`, `cryosphere`). |
| `GET /api/presets` | `list_mission_presets` | Returns normalized mission weights computed from `missions.csv` (or `mission_presets.csv` if added). |
| `GET /api/targets` | `list_planetary_targets` | Lists Moon/Mars target profiles; accepts optional query param `?body=moon\|mars`. |
| `GET /api/missions` | `list_missions_from_csv` | Lists the 7 mission scenarios from `missions.csv` with `footprint_mode` and 5-factor normalized weights. |
| `GET /api/analogs/bundle` | `get_analogs_bundle` | Computes and returns the full `{meta, targets, missions, results}` bundle from `backend/data/*.csv`. |
| `POST /api/analogs/match` | `match_analogs_live` | Live 5-factor BallTree KNN → TOPSIS match for either `target_id` or custom `(target_body, lat, lon)` resolved via `resolve_planetary_point`. |
| `POST /api/resolve` | `resolve_coordinate` | Resolves `{body, coordinates: {lat, lon}}` into `shared_17` and body-exclusive engineering factors. |
| `POST /api/search` | `search_analogs` | Full 17-factor KNN → TOPSIS pipeline (`AnalogSearchRequest`) returning ranked sites, per-domain fidelity scores, and `EarthTestbedProtocol` for Rank #1. |
| `GET /api/terrain/patch` | `get_terrain_patch` | Returns elevation grid `elevations_m` + slope/relief stats (`planet`, `lat`, `lon`, `radius_km` `1..80`, `grid_size` `24..128`, LRU cache `maxsize=64`). |
| `GET /api/terrain/proxy-tile` | `proxy_terrain_tile` | Relays HTTPS map/relief tiles from `ALLOWED_TILE_HOSTS` with browser-friendly CORS headers. |

### Tile Proxy Host Allowlist (`ALLOWED_TILE_HOSTS`)
To prevent SSRF, `is_allowed_tile_url()` restricts `/api/terrain/proxy-tile` strictly to HTTPS URLs on:
- `s3.amazonaws.com` (AWS Terrarium DEM)
- `server.arcgisonline.com` (Esri World Imagery)
- `cartocdn-gusc.global.ssl.fastly.net` (OpenPlanetaryMap Moon/Mars basemaps)
- `trek.nasa.gov` (NASA Moon/Mars Trek WMTS)
- `planetarymaps.usgs.gov` (USGS Astrogeology LOLA / HRSC+MOLA mosaics)
- `gibs.earthdata.nasa.gov` (NASA EOSDIS GIBS MODIS)
- `tile.openstreetmap.org` (OpenStreetMap)

---

## 4. Matching Math & Earth Testbed Protocol

### Stage 1: Weighted BallTree KNN Candidate Retrieval
- **Earth Normalization (`normalize_clipped`)**: Numerical features are clipped to terrestrial operational min/max envelopes and scaled to `[0, 1]`. Categorical columns (`dominant_lithology`, `surface_mineral_class`, `dust_cover_class`) are evaluated pairwise against the target into `[0.10, 1.00]`.
- **Mission Weight Projection**: Feature values are multiplied by $\sqrt{w_i}$ so squared Euclidean distance in `BallTree` directly equals the weighted squared deviation $\sum_i w_i (e_i - t_i)^2$.

### Stage 2: Dual-Ideal Analog TOPSIS & Out-of-Bounds Diagnostics
- **Unclipped Planetary Target (`normalize_unclipped`)**: Planetary values (such as `-205 °C` in Lunar PSRs) are **not clipped** before computing deviation matrices $|E_{ij} - T_j|$ and per-factor similarity $S_{ij} = \text{clip}(1 - |T_j - E_{ij}|, 0, 1) \times 100\%$.
- **Cost-Criterion Ideals**: Ideal Best $A^+ = \mathbf{0}$ (zero divergence from Moon/Mars target) and Ideal Worst $A^- = \max_i v_{ij}$, yielding closeness $C_i = \frac{d^-}{d^+ + d^-} \times 100\%$.
- **Where the Analogy Breaks Down (`engine/testbed_protocol.py`)**:
  - Maps target body + lithology/clay profile to commercial/NASA simulants (`LHS-1`, `JSC-1A / LMS-1`, `MMS-1 / MGS-1`, `MGS-1S`, `MGS-1C`) with cryogenic water-ice or oven-dry preparation notes.
  - Quantifies gravity differentials (`1g` vs. `0.166g` Moon / `0.380g` Mars), atmospheric vacuum vs. `95% CO₂`, TVAC pre-qualification, polar sun angles, and regolith trench depth.

---

## 5. Datasets (`backend/data/`)

| File Path | Rows | Description |
| :--- | :--- | :--- |
| `merged_earth_features_clean.csv` | 51 | Primary cleaned Earth analog table (29 columns combining GEE terrain/MODIS, NASA POWER, and Macrostrat geology). |
| `Moon.csv` | 100 | Reference lunar zone grid (22 columns) used by `PlanetaryZoneLookup` (`cKDTree`). |
| `mars.csv` | 100 | Reference Martian zone grid (22 columns) used by `PlanetaryZoneLookup` (`cKDTree`). |
| `missions.csv` | 7 | Operational profiles (`rover_mobility`, `isru_extraction`, `subsurface_habitat`, `thermal_power_survival`, `eva_dust_operations`, `astrobiology_survey`, `balanced_survey`) with 17-factor weights (`w_*`). |
| `site_tests.csv` | 24 | Curated `(site_id, mission_id)` engineering test objectives, suitability rationales, analog breakdown warnings, and references. |
| `rawData/geological_sites_100.csv` | 100 | Initial terrestrial candidate site catalog (`site_id,latitude_deg,longitude_deg`). *(Folder also includes empty placeholder `insertRawData.txt`.)* |
| `processedData/nasa_power_features.csv` | 100 | Climate/albedo/ice features extracted via NASA POWER API. |
| `processedData/gee_features.csv` | 100 | NDVI greenness proxy, MODIS day–night LST delta, soil moisture, and NDSI snow/ice extracted via Google Earth Engine. |
| `processedData/gee_terrain_features.csv` | 100 | Elevation, slope, and roughness from Copernicus DEM GLO-30 (`gee_terrain_failed_sites.csv` logs 1 failed site). |
| `processedData/macrostrat_features.csv` | 100 | Lithology, basalt percentage, and mineral class extracted from Macrostrat. |
| `placeholderData/planetary_bases.csv` | 8 | Curated featured Moon (5) and Mars (3) base presets for quick dropdown & wizard selection. |
| `placeholderData/earth_sites_1000.csv` | 16 | Legacy 5-factor terrestrial catalog kept as automatic fallback. |

---

## 6. Data Extraction & Cleaning Pipeline (`backend/scripts/`)

The cleaned 51-site Earth table in `backend/data/merged_earth_features_clean.csv` is produced from `rawData/geological_sites_100.csv` (100 sites) using the scripts and Google Colab notebooks in `backend/scripts/`:

1. **Climatology & Solar/Wind Radiation — `nasa_power_features.py`**:
   - Queries `https://power.larc.nasa.gov/api/temporal/climatology/point` (`RE` community, annual `ANN` climatology for `TS`, `TS_MIN`, `TS_MAX`, `PRECTOTCORR`, `WS2M`, `ALLSKY_SRF_ALB`).
   - Run standalone:
     ```bash
     python backend/scripts/nasa_power_features.py --input backend/data/rawData/geological_sites_100.csv --output backend/data/processedData/nasa_power_features.csv
     ```
2. **Surface Thermal & Cryosphere Proxies — `gee_features_colab.ipynb`**:
   - Runs server-side aggregations in **Google Earth Engine** (no raster downloads): computes NDVI greenness proxy (`vegetation_cover_pct`), MODIS day–night Land Surface Temperature delta (`surface_thermal_inertia`), soil moisture, and MODIS NDSI indicator (`surface_ice_fraction_pct`).
3. **Topography (3×3 Stencil DEM) — `gee_terrain_features_colab_keep_na.ipynb` & `open_elevation_features.py`**:
   - Primary Colab notebook samples `COPERNICUS/DEM/GLO30` on Earth Engine over a `3×3` stencil at `0.0005°` spacing to compute center `elevation_m`, center gradient `mean_slope_deg`, and population standard deviation `terrain_roughness_m`.
   - `open_elevation_features.py` provides an async Python alternative using `https://api.open-elevation.com/api/v1/lookup` (supports optional `OPEN_ELEVATION_API_KEY` env var):
     ```bash
     python backend/scripts/open_elevation_features.py --input backend/data/rawData/geological_sites_100.csv --output open_elevation_features.csv
     ```
   - *(Auxiliary notebook `openeo_features_colab.ipynb` provides an alternative Copernicus Data Space openEO workflow for Sentinel-2 NDVI and Sentinel-1 VV wetness proxies.)*
4. **Geological Lithology (`processedData/macrostrat_features.csv`)**:
   - Captures `dominant_lithology`, `basalt_fraction_pct`, and `surface_mineral_class`.
5. **Merge & Validation — `merge_first_then_clean_colab (1).ipynb`**:
   - Performs a key-aligned outer join on `(site_id, latitude_deg, longitude_deg)` across all four processed CSVs, filters out failed sites from `gee_terrain_failed_sites.csv`, and drops rows containing null or invalid tokens (`Unknown`), yielding the final **51 clean Earth analog sites**.
   - *(Note: `backend/scripts/putindataextraction.txt` is a legacy placeholder note.)*
