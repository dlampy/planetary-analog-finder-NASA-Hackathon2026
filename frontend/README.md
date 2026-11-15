# DLT_NASAHackathon2026 — 3D Planetary & Analog Explorer

Project created for the **2026 NASA International Space Apps Challenge**:
**[Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars](https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/)**

## Live Demo (GitHub Pages)
Once GitHub Pages is enabled for this repository, you can view the live interactive explorer at:
- **https://dlampy.github.io/DLT_NASAHackathon2026/**

## Features (`index.html`)
- **Welcome Screen & Quick Recommendations**: Highlights curated Earth analog sites and Moon base targets on launch, allowing one-click 3D camera fly-to or dual-planet pairing.
- Interactive **Three.js 3D Explorer** for three planetary bodies:
  1. **Earth:** Continents, specular ocean reflections, desert belts, polar ice caps, and an independent rotating cloud layer.
  2. **Moon:** Regolith surface, dark basaltic *Maria*, highlands, and 3D-shaded impact craters.
  3. **Mars:** Iron-oxide terrain, dark basaltic plains, canyon systems, polar ice caps, and a thin dusty atmosphere.
- Click the bottom selector cards (or press `1`, `2`, `3`) to switch between 3D models and inspect planetary stats.
- Supports mouse drag-to-orbit, scroll-to-zoom, auto-rotate toggle, 3D wireframe mode, and view reset.
- **Google Earth-style Navigation**: Compass `N` ring to align North (`0°`), 4-way D-Pad, `+`/`-` Zoom slider, and **`⊥ Upright Axis`** lock.
- **High-Resolution 2D Map (Tile Map API)**: Click anywhere on a 3D globe to open a Leaflet 2D map (Esri World Imagery, OpenStreetMap, NASA GIBS MODIS, OpenPlanetaryMap LRO/Mars).
- **Dual GPS Link (ML Model) & Draggable Windows**: Link Earth ↔ Moon/Mars coordinates with a 3D animated arc; all floating windows (`2D Map`, `Dual GPS Link`, `NASA Data Sources`, `Planetary Analog Finder`) can be dragged by their headers.
- **Planetary Analog Finder (`🧪 Analog Finder (ML)`)**: Ranks the Top 10 best-matching Earth sites per Moon/Mars target and mission purpose (`Rover Mobility`, `Ground ISRU`, `Lava Tube Habitat`) using a two-stage **Weighted BallTree KNN → Analog TOPSIS** pipeline across 5 quantitative environmental features, complete with 5 similarity bars ($S_i$), **Where the Analogy Breaks Down** warning box, automated fallback notes, 3D pins, and 2D operational footprints (`1 km × 1 km`, `r = 5 km`, `r = 500 m`).

## Data & ML Architecture (`../backend/` & `app.py`)
- **`../backend/data/merged_earth_features_clean.csv`** *(and `placeholderData/earth_sites_1000.csv`)*: Official 51-site Earth analog dataset with terrain, thermal, aridity/ice, and subsurface void features.
- **`../backend/data/placeholderData/planetary_bases.csv`**: 8 Moon base targets (Shackleton, Malapert, Marius Hills, Aristarchus, Mare Tranquillitatis) and Mars targets (Jezero, Arcadia Planitia, Arsia Mons).
- **`../backend/data/missions.csv`**: Mission-specific feature weights and operational footprint modes (`circle_5km`, `square_1km`, `circle_500m`).
- **`../backend/data/site_tests.csv`**: Curated scientific rationales & limitations *(missing `(site_id, mission_id)` pairs automatically trigger scientific fallback generation in both backend and frontend)*.
- **`../backend/engine/` & `app.py`**: Python engine (`scikit-learn` `BallTree` + TOPSIS) for precomputing `assets/data/analogs_results.json` or serving the FastAPI backend:
  ```bash
  pip install -r ../backend/requirements.txt
  python app.py --export-json
  ```
  *(Or start the FastAPI server from the repository root: `python -m uvicorn backend.main:app --reload --port 8000` — when using `start_local.bat`, you can also click **`↻ Recompute from CSV`** inside `🧪 Analog Finder (ML)` to connect to the live backend API or recompute directly in JS).*

## Official Open Data Sources (NASA & Partner Agencies)
Integrated directly into the **`📚 NASA Data Sources`** menu inside the app:

### NASA (Earth · Moon · Mars)
- **NASA Earthdata Search**: https://search.earthdata.nasa.gov/
- **NASA Worldview (GIBS)**: https://worldview.earthdata.nasa.gov/index.html
- **NASA Planetary Data System (PDS)**: https://pds.nasa.gov/
- **NASA Lunar Reconnaissance Orbiter (LRO — LROC / LOLA / Diviner / LEND / Mini-RF)**: https://pds-geosciences.wustl.edu/missions/lro/
- **NASA LRO Diviner Lunar Data**: https://pds-geosciences.wustl.edu/missions/lro/diviner.htm

### Partner Space Agencies (CSA · ESA · JAXA)
- **CSA · RADARSAT Constellation Mission (RCM) - Data**: https://donnees-data.asc-csa.gc.ca/en/dataset/rcm
- **CSA · RADARSAT 1 - Data**: https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1
- **CSA · Synthetic Aperture Radar (SAR) Python Tutorial**: https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial
- **ESA · Copernicus Data Space Ecosystem**: https://dataspace.copernicus.eu/
- **ESA · Open Science Catalog**: https://opensciencedata.esa.int/
- **JAXA · G-Portal**: https://gportal.jaxa.jp/gpr/index/index

## Planetary Satellite Textures (`assets/textures/`)
To render realistic Earth continents, lunar Maria/craters, and Martian topography (instead of procedural placeholders), place **Equirectangular (2:1)** texture maps into `assets/textures/`:

- **Earth:** `earth_daymap.jpg` (required), optional `earth_clouds.jpg`, `earth_normal.jpg`, `earth_specular.jpg`
- **Moon:** `moon_color.jpg` (required), optional `moon_bump.jpg`
- **Mars:** `mars_color.jpg` (required), optional `mars_bump.jpg`

### Recommended Texture Sources
1. **[Solar System Scope Textures (CC BY 4.0)](https://www.solarsystemscope.com/textures/)** — 2K/8K textures compiled from NASA imagery and elevation data.
2. **Primary NASA & USGS Datasets:**
   - Earth: [NASA Blue Marble: Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/)
   - Moon: [NASA SVS CGI Moon Kit (ID 4720)](https://svs.gsfc.nasa.gov/4720/)
   - Mars: [USGS Mars Viking Colorized Global Mosaic](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m)

> *Attribution:* Planetary textures can use imagery from Solar System Scope (CC BY 4.0), NASA Visible Earth / SVS, and USGS Astrogeology.

## Running Locally (Offline / Local)
1. Clone the repository:
   ```bash
   git clone https://github.com/dlampy/DLT_NASAHackathon2026.git
   ```
2. On Windows, double-click **`start_local.bat`** inside `frontend/` (automatically opens `http://localhost:8080/index.html` without requiring Python or Node), or run:
   ```bash
   python -m http.server 8000
   ```
   *(If `index.html` is opened directly via `file://`, the app falls back to procedural textures or allows picking a local image via `📂 Pick map image from device`).*
