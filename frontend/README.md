# DLT_NASAHackathon2026 — 3D Planetary & Analog Explorer

Dự án tham gia **2026 NASA International Space Apps Challenge** cho thử thách:
**[Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars](https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/)**

## Live Demo (GitHub Pages)
Sau khi bật GitHub Pages cho repository này, bạn có thể xem trực tiếp trên trình duyệt tại:
- **https://dlampy.github.io/DLT_NASAHackathon2026/**

## Tính năng hiện tại (`index.html`)
- Trình xem mô hình 3D tương tác bằng **Three.js** cho 3 thiên thể:
  1. **Trái Đất (Earth):** Lục địa, đại dương phản chiếu ánh sáng, vành đai sa mạc, chỏm băng hai cực, lớp mây xoay độc lập và khí quyển phát sáng.
  2. **Mặt Trăng (Moon):** Bề mặt regolith, vùng biển *Maria*, cao nguyên và miệng hố va chạm nổi 3D.
  3. **Sao Hỏa (Mars):** Địa hình oxit sắt, đá bazan sẫm, hẻm núi, miệng hố va chạm, chỏm băng hai cực và khí quyển bụi mỏng.
- Click vào từng ô ở thanh chọn bên dưới (hoặc nhấn phím `1`, `2`, `3`) để chuyển đổi mô hình 3D kèm bảng thông số hành tinh.
- Hỗ trợ kéo chuột để xoay, cuộn để zoom, bật/tắt tự xoay, chế độ lưới 3D (*wireframe*) và đặt lại góc nhìn.
- **Điều hướng kiểu Google Earth**: Vòng la bàn chữ `N` xoay/căn thẳng hướng Bắc (`0°`), cụm D-Pad 4 hướng, thanh trượt Zoom `+`/`-`, và nút **`⊥ Trục thẳng`** giữ trục Bắc–Nam thẳng đứng khi xoay.
- **Bản đồ 2D siêu nét (Tile Map API)**: Click trực tiếp lên bất kỳ điểm nào trên hành tinh 3D để mở bản đồ 2D Leaflet (Esri World Imagery, OpenStreetMap, NASA GIBS MODIS, OpenPlanetaryMap LRO/Mars).
- **Liên kết 2 tọa độ GPS (Model ML) & Cửa sổ kéo thả**: Pop-up nhận cặp tọa độ Trái Đất ↔ Mặt Trăng / Sao Hỏa để vẽ đường cung nối 3D giữa 2 hành tinh; các cửa sổ (`Map 2D`, `Liên kết 2 tọa độ GPS`, `Nguồn dữ liệu NASA`, `Planetary Analog Finder`) đều giữ chuột trái vào thanh tiêu đề để kéo di chuyển.
- **Planetary Analog Finder (`🧪 Analog Finder (ML)`)**: Xếp hạng Top 10 địa điểm Trái Đất tương đồng nhất theo từng mục tiêu (Mặt Trăng / Sao Hỏa) và mục đích nhiệm vụ (`Rover Mobility`, `Ground ISRU`, `Lava Tube Habitat`) bằng pipeline 2 tầng **Weighted BallTree KNN → Analog TOPSIS** trên 5 biến định lượng *(tạm bỏ `lithology_type` cho đến khi thống nhất bảng phân loại)*, kèm 5 thanh độ giống $S_i$, hộp cảnh báo **Where the Analogy Breaks Down**, sinh nội dung dự phòng tự động cho các cặp chưa có trong `data/site_tests.csv`, ghim Top-10 trên Trái Đất 3D và vẽ footprint vận hành (`1 km × 1 km`, `r = 5 km`, `r = 500 m`) trên Leaflet 2D.

## Kiến trúc Dữ liệu & Thuật toán (`../backend/` & `app.py`)
- **`../backend/data/merged_earth_features_clean.csv`** *(và `placeholderData/earth_sites_1000.csv`)*: Bảng địa điểm tương đồng Trái Đất với các biến môi trường: `slope_deg`, `mean_temp_c`, `temp_swing_c`, `aridity_ice_idx`, `has_subsurface_void`...
- **`../backend/data/placeholderData/planetary_bases.csv`**: 8 mục tiêu căn cứ Mặt Trăng (Shackleton, Malapert, Marius Hills, Aristarchus, Mare Tranquillitatis) và Sao Hỏa (Jezero, Arcadia Planitia, Arsia Mons).
- **`../backend/data/placeholderData/missions.csv`**: Trọng số theo mục đích nhiệm vụ và chế độ footprint (`circle_5km`, `square_1km`, `circle_500m`).
- **`../backend/data/placeholderData/site_tests.csv`**: Giải thích khoa học thủ công *(nếu thiếu cặp `(site_id, mission_id)`, cả backend và frontend đều tự sinh fallback cảnh báo dựa trên $S_i$ thấp nhất)*.
- **`../backend/engine/` & `app.py`**: Engine Python (`scikit-learn` `BallTree` + TOPSIS) để tiền tính `assets/data/analogs_results.json` hoặc chạy FastAPI backend:
  ```bash
  pip install -r ../backend/requirements.txt
  python app.py --export-json
  ```
  *(Hoặc chạy FastAPI từ thư mục gốc repo: `python -m uvicorn backend.main:app --reload --port 8000` — khi mở web qua `start_local.bat`, bạn cũng có thể bấm **`↻ Tính lại từ CSV`** ngay trong popup `🧪 Analog Finder (ML)` để gọi Live Backend API hoặc tự tính bằng JS).*

## Nguồn dữ liệu mở chính thức (NASA & Cơ quan Đối tác)
Danh sách các bộ dữ liệu được cung cấp trong thử thách và tích hợp tra cứu ngay trên nút **`📚 Nguồn dữ liệu NASA`** của website:

### NASA (Earth · Moon · Mars)
- **NASA Earthdata Search**: https://search.earthdata.nasa.gov/
- **NASA Worldview (GIBS)**: https://worldview.earthdata.nasa.gov/index.html
- **NASA Planetary Data System (PDS)**: https://pds.nasa.gov/
- **NASA Lunar Reconnaissance Orbiter (LRO — LROC / LOLA / Diviner / LEND / Mini-RF)**: https://pds-geosciences.wustl.edu/missions/lro/
- **NASA LRO Diviner Lunar Data**: https://pds-geosciences.wustl.edu/missions/lro/diviner.htm

### Cơ quan Vũ trụ Đối tác (CSA · ESA · JAXA)
- **CSA · RADARSAT Constellation Mission (RCM) - Data**: https://donnees-data.asc-csa.gc.ca/en/dataset/rcm
- **CSA · RADARSAT 1 - Data**: https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1
- **CSA · Synthetic Aperture Radar (SAR) Python Tutorial**: https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial
- **ESA · Copernicus Data Space Ecosystem**: https://dataspace.copernicus.eu/
- **ESA · Open Science Catalog**: https://opensciencedata.esa.int/
- **JAXA · G-Portal**: https://gportal.jaxa.jp/gpr/index/index

## Bản đồ vệ tinh thực tế (`assets/textures/`)
Để mô hình 3D hiển thị đúng hình dạng lục địa Trái Đất, biển/hố Mặt Trăng và địa hình Sao Hỏa thực tế (thay vì mô phỏng dự phòng), hãy tải ảnh bản đồ chuẩn **Equirectangular (tỉ lệ 2:1)** và đặt vào thư mục `assets/textures/`:

- **Trái Đất:** `earth_daymap.jpg` (bắt buộc), tùy chọn thêm `earth_clouds.jpg`, `earth_normal.jpg`, `earth_specular.jpg`
- **Mặt Trăng:** `moon_color.jpg` (bắt buộc), tùy chọn thêm `moon_bump.jpg`
- **Sao Hỏa:** `mars_color.jpg` (bắt buộc), tùy chọn thêm `mars_bump.jpg`

### Nguồn tải dữ liệu khuyến nghị
1. **[Solar System Scope Textures (CC BY 4.0)](https://www.solarsystemscope.com/textures/)** — Bộ ảnh 2K/8K tổng hợp từ dữ liệu ảnh và độ cao của NASA, dễ dùng trực tiếp cho Three.js *(lưu ý chuyển file `.tif` sang `.jpg`/`.png` nếu dùng normal/specular map)*.
2. **Dữ liệu gốc từ NASA & USGS:**
   - Trái Đất: [NASA Blue Marble: Next Generation](https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/)
   - Mặt Trăng: [NASA SVS CGI Moon Kit (ID 4720)](https://svs.gsfc.nasa.gov/4720/)
   - Sao Hỏa: [USGS Mars Viking Colorized Global Mosaic](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m)

> *Attribution:* Planetary textures can use imagery from Solar System Scope (CC BY 4.0), NASA Visible Earth / SVS, and USGS Astrogeology.

## Chạy cục bộ (Offline / Local)
1. Clone repository về máy:
   ```bash
   git clone https://github.com/dlampy/DLT_NASAHackathon2026.git
   ```
2. Để trình duyệt nạp được ảnh trong `assets/textures/` (tránh bị chặn CORS khi mở `file://`), trên Windows bạn chỉ cần **nháy đúp chạy `start_local.bat`** (tự mở `http://localhost:8080/index.html` không cần cài Python/Node), hoặc dùng VS Code **Live Server** / lệnh:
   ```bash
   python -m http.server 8000
   ```
   *(Nếu mở trực tiếp file `index.html` bằng `file://`, hệ thống sẽ tự chuyển sang chế độ mô phỏng dự phòng hoặc bạn có thể bấm nút `📂 Chọn ảnh bản đồ từ máy` trên giao diện).*
