# DLT_NASAHackathon2026 — Frontend 3D Planetary & Analog Explorer

Interactive zero-build WebGL + 2D Leaflet frontend created for the **2026 NASA International Space Apps Challenge**:
**[Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars](https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/)**

Live Demo (GitHub Pages): **https://dlampy.github.io/DLT_NASAHackathon2026/**  
See also: [Root README](../README.md) | [Backend README](../backend/README.md) | [License](../LICENSE)

---

## Key Features (`index.html` & `src/`)

### 1. Three-Planet Interactive 3D Globes
- Interactive **Three.js (r128)** 3D scenes for **Earth** (continents, specular ocean highlights, polar caps, independent rotating cloud layer), **Moon** (regolith albedo, basaltic *Maria*, highlands, craters), and **Mars** (iron-oxide surface, volcanic plains, canyon systems, dusty atmosphere glow shader).
- Switch worlds via bottom cards or keys **`1`**, **`2`**, **`3`**.
- **Google Earth-Style Navigation (`ge-nav`)**: Click `N` or drag azimuth ring (`Upright Axis` 0° North lock), 4-way D-Pad + center reset, look-around orb pad, and logarithmic `+`/`-` Zoom slider.

### 2. Top-Left Quick Launchers (Always Visible)
Pinned in the upper-left corner (remaining accessible even when the Left Info Panel is collapsed via **Hide**):
1. **`Mission Target Finder (Moon/Mars to Earth)`** *(top button)* — Opens the **3-Step Mission Wizard**:
   - **Step 1**: Choose **Moon** or **Mars**.
   - **Step 2**: Choose 1 of **7 Mission Profiles** loaded dynamically from `missions.csv`.
   - **Step 3**: Click directly on the 3D globe, pick from 8 catalog presets (`planetary_bases.csv`), or enter custom `Lat, Lon` coordinates → **`Find Earth Matches`**.
2. **`3D Terrain Comparator`** *(second button)* — Opens the side-by-side 3D relief comparator anchored below the top-left launchers.

### 3. Planetary Analog Finder (`src/finder/`) + Direct Reselect 3D
- Executes two-stage **Weighted BallTree KNN → Analog TOPSIS** across **51 Earth analog sites** (`merged_earth_features_clean.csv`) in real time (using the FastAPI backend when running, client-side CSV parsing in browser memory under local HTTP servers, or `assets/data/analogs_results.json` on GitHub Pages).
- Filter matches by **`Suitable ≥60%`** or **`All Ranked`**, inspect 5 similarity $S_i$ bars, geology/elevation tags, **Technology to Test**, **Why Suitable**, and **Where the Analogy Breaks Down** warning diagnostics.
- **Direct `Reselect 3D` (No Wizard Re-Entry)**: Click **`Reselect on Moon`** / **`Reselect on Mars`** right inside the Finder header to jump straight into `#target-picker-hud`, switch Moon/Mars chips live, and click a new spot on the globe (`Cancel & Return` returns directly to Finder).
- **2D Operational Footprints**: Selecting a match renders 3D analog pins, draws a dual-planet link arc, and opens the Leaflet 2D map with mission-specific footprints (`1 km × 1 km` Square for ISRU/Thermal/Astrobiology/Balanced, `r = 5 km` Circle for Rover/EVA, `r = 500 m` Circle for Subsurface Lava Tube Habitat).

### 4. High-Resolution 2D Map (`src/map2d/leafletMap.js`) ↔ Mission Finder Loop
- Click any point on any 3D globe (or click **`Pick from 2D View`** in Finder) to open the draggable, expandable Leaflet **2D View**:
  - **Earth layers**: Esri World Imagery (`<1m`), OpenStreetMap, NASA GIBS MODIS.
  - **Moon / Mars layers**: OpenPlanetaryMap LRO Moon basemap & OpenPlanetaryMap Mars Viking/MOLA basemap.
- **Two-Way Recall with Mission Finder**: When viewing **Moon** or **Mars** in 2D View, click any coordinates and click **`Use for Mission Finder`** to immediately recompute top Earth analog sites for that spot *(automatically hidden on Earth maps)*.
- **Direct 3D Relief Launch**: Click **`3D Terrain`** in the 2D View footer to inspect a **Single-Site** 3D cutaway relief block for that exact coordinate.
- **GPS Assignment**: Send coordinates straight into `GPS 1 (Earth)` or `GPS 2 (Moon / Mars)`.

### 5. 3D Terrain Comparator (`src/terrain/`)
Triggerable from **4 entry points**: Top-Left **`3D Terrain Comparator`**, Finder card **`Compare 3D Terrain`**, **Dual GPS Link** (`#gps-popup` & `#dual-link-banner`), and 2D Map **`3D Terrain`**.
- **Modes & Controls**: Toggle **`Dual Compare`** ↔ **`Single Site`**, **Expand / Collapse** (header button or header double-click), **`Sync Camera`**, patch radius (**`5 km`**, **`10 km`**, **`25 km`**), shading (**`Surface Relief`**, **`Elevation Ramp`**, **`Wireframe`**), Vertical Exaggeration slider (**`1.0x` – `4.5x`**), and live Min/Max/Relief/Avg Slope metrics.
- **Elevation & Surface Sources (`terrainApi.js` + `backend/engine/terrain_fetcher.py`)**:

| Body | Elevation (DEM) Fallback Chain | Draped Surface Texture Fallback Chain |
| :--- | :--- | :--- |
| **Earth** | AWS Mapzen Terrarium RGB Tiles → Open-Meteo Copernicus DEM 90m → Backend `/api/terrain/patch` → Offline Geomorphic Synthesis | Esri World Imagery (direct CORS or `/api/terrain/proxy-tile`) → Local cropped `8k_earth_daymap.jpg` → Hypsometric relief |
| **Moon** | Backend USGS LRO LOLA LDEM 118m COG (if `rasterio` installed) / `/api/terrain/patch` → LRO LOLA Resolver Profile + Luminance Surface Relief | OpenPlanetaryMap LRO tiles (direct or proxy) → Local cropped `8k_moon.jpg` → Lunar rock tint |
| **Mars** | Backend USGS HRSC+MOLA 200m COG (if `rasterio` installed) / `/api/terrain/patch` → MGS MOLA/HRSC Resolver Profile + Luminance Surface Relief | OpenPlanetaryMap Mars tiles (direct or proxy) → Local cropped `8k_mars.jpg` → Martian rock tint |

### 6. Tools Drawer (`Tools`) & Clean Iconless Workspace
To keep telemetry uncluttered, icons appear **only inside** the Google Earth navigation widget (`#ge-nav`); all buttons/drawers are text-only:
- **3D Display & Controls**: `Auto-Rotate`, `Upright Axis`, `Analog Pins`, `3D Wireframe`, `Info Panel`, `Reset View`.
- **Science & Data Tools**: `Analog Finder (ML)` and `NASA Data Sources` (direct links to NASA Earthdata, Worldview GIBS, PDS, LRO/Diviner, CSA RADARSAT/RCM, ESA Copernicus/Open Science Catalog, JAXA G-Portal). *(2-planet orbital linking remains active via Analog Finder matches, 2D View GPS assignment, `?earth=...&target=...&dest=...` URL params, and `window.linkAnalogCoordinates`.)*

---

## Supported Mission Types (`../backend/data/missions.csv`)

1. **`rover_mobility`** — Rover Surface Mobility & Traverse (`r = 5 km`)
2. **`isru_extraction`** — ISRU Volatile & Regolith Extraction (`1 × 1 km`)
3. **`subsurface_habitat`** — Subsurface Lava Tube & Habitat Base (`r = 500 m`)
4. **`thermal_power_survival`** — Solar Power & Thermal Hardware Survival (`1 × 1 km`)
5. **`eva_dust_operations`** — EVA Suit Mobility & Dust Mitigation (`r = 5 km`)
6. **`astrobiology_survey`** — Astrobiology & Biosignature Detection (`1 × 1 km`)
7. **`balanced_survey`** — Balanced General Analog Survey (`1 × 1 km`)

---

## Planetary Textures (`assets/textures/`)

The repository already bundles 8K equirectangular imagery in `frontend/assets/textures/`:
- **`8k_earth_daymap.jpg`**
- **`8k_moon.jpg`**
- **`8k_mars.jpg`**

`src/config/constants.js` and `src/scene/planetBuilder.js` also support drop-in custom textures (`earth_daymap.jpg`, `earth_clouds.jpg`, `earth_normal.jpg`, `earth_specular.jpg`, `moon_color.jpg`, `moon_bump.jpg`, `mars_color.jpg`, `mars_bump.jpg`, and `.png` variants) or interactive local file loading via **`Pick map image from device`**.  
Sources: [Solar System Scope Textures (CC BY 4.0)](https://www.solarsystemscope.com/textures/), [NASA Blue Marble](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/), [NASA SVS CGI Moon Kit (4720)](https://svs.gsfc.nasa.gov/4720/), and [USGS Mars Viking Global Mosaic](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m).

---

## Running Locally & Exporting Static JSON

1. **Windows One-Click Server (Recommended without Python dependencies)**:
   - Double-click **`frontend/start_local.bat`**, which serves both `./frontend` and `../backend/data` at `http://localhost:8080/index.html`.
2. **Full-Stack FastAPI Backend + Frontend (from repo root)**:
   ```bash
   pip install -r backend/requirements.txt
   python -m uvicorn backend.main:app --reload --port 8000
   # Open http://127.0.0.1:8000
   ```
3. **Python Static Server / Bundle Exporter**:
   ```bash
   # Export assets/data/analogs_results.json from backend/data CSVs and exit:
   python frontend/app.py --export-json

   # Or export JSON and start HTTP server (or run python -m http.server from repo root):
   python frontend/app.py --serve --port 8080
   ```
   > **Important:** Do **not** run `python -m http.server` with `frontend/` as the server root if you want **`Recompute from CSV`** to load `../backend/data/*.csv` cleanly; use `start_local.bat`, `app.py --serve`, `uvicorn backend.main:app`, or run `http.server` from the repository root (`http://localhost:8080/frontend/index.html`). *(Opening `index.html` via `file://` uses procedural shaders until you pick a local texture via `Pick map image from device`.)*

---

## Frontend Module Map (`src/`)

- `main.js` — Scene bootstrap, planet preloading, URL query string linking, resize & animation loop.
- `config/constants.js` — `PLANET_CONFIG`, `FINDER_FEATURES`, `TILE_LAYERS`.
- `state/appState.js` — Shared state (`activePlanetKey`, `missionWizardState`, `dualLinkState`, `finderState`, `map2dState`, `lastTerrainPairSource`).
- `scene/` — `threeScene.js`, `planetBuilder.js`, `markersAndArcs.js`, `geNavigation.js`.
- `ui/` — `welcomeModal.js` (3-step wizard + direct 3D picker HUD), `infoPanel.js` (`linkAnalogCoordinates`), `popups.js` (Tools, Dual GPS, NASA Sources), `windowManager.js` (drag & z-index management).
- `map2d/leafletMap.js` — Raycaster clicks, Leaflet layers, footprints, `Use for Mission Finder`, and Single-Site `3D Terrain`.
- `finder/` — `finderPanel.js`, `finderApi.js` (Backend -> CSV -> JSON fallback chain), `csvAndTopsis.js` (JS KNN/TOPSIS & Moon/Mars analytical resolver).
- `terrain/` — `terrainComparatorPanel.js`, `terrainApi.js` (DEM + tile fallback fetcher), `terrainMeshBuilder.js` (Three.js DEM block + skirt geometry builder).
