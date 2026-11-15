Place 2:1 Equirectangular planetary texture maps in this directory (`frontend/assets/textures/`).

Bundled default 8K maps already included:
- Earth: 8k_earth_daymap.jpg
- Moon:  8k_moon.jpg
- Mars:  8k_mars.jpg

Automatic lookup priority configured in `frontend/src/config/constants.js` (`PLANET_CONFIG`) and loaded by `frontend/src/scene/planetBuilder.js`:

- Earth:
  - Color (first found): earth_daymap.jpg | 2k_earth_daymap.jpg | 4k_earth_daymap.jpg | 8k_earth_daymap.jpg | earth.jpg | earth_daymap.png
  - Optional layers:
    - Clouds:   earth_clouds.jpg | 2k_earth_clouds.jpg | earth_clouds.png
    - Normal:   earth_normal.jpg | 2k_earth_normal_map.jpg | earth_normal.png
    - Bump:     earth_bump.jpg | earth_bump.png
    - Specular: earth_specular.jpg | 2k_earth_specular_map.jpg | earth_specular.png
- Moon:
  - Color (first found): moon_color.jpg | 2k_moon.jpg | 4k_moon.jpg | 8k_moon.jpg | moon.jpg | moon_color.png
  - Optional bump: moon_bump.jpg | moon_bump.png
- Mars:
  - Color (first found): mars_color.jpg | 2k_mars.jpg | 4k_mars.jpg | 8k_mars.jpg | mars.jpg | mars_color.png
  - Optional bump: mars_bump.jpg | mars_bump.png

Free NASA-derived texture packs (CC BY 4.0):
https://www.solarsystemscope.com/textures/
