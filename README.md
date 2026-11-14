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
