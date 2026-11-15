import { PLANET_CONFIG, TILE_LAYERS } from '../config/constants.js';
import { resolvePlanetaryPointJS } from '../finder/csvAndTopsis.js';
import { probeLiveBackendBase } from '../finder/finderApi.js';

const BODY_RADII_KM = {
  earth: 6371.0088,
  moon: 1737.4,
  mars: 3389.5
};

const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation';
const TREK_WMTS_URLS = {
  moon: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
  mars: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/default/default028mm/{z}/{y}/{x}.jpg'
};

const patchCache = new Map();

function wrapLon(lon) {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

function rad(deg) {
  return (deg * Math.PI) / 180;
}

export function computeTerrainBounds(lat, lon, radiusKm, planet) {
  const bodyR = BODY_RADII_KM[planet] || 6371.0088;
  const dLat = (radiusKm / bodyR) * (180 / Math.PI);
  const cosLat = Math.max(0.18, Math.cos(rad(lat)));
  const dLon = (radiusKm / (bodyR * cosLat)) * (180 / Math.PI);
  return {
    latMin: Math.max(-85.0, lat - dLat),
    latMax: Math.min(85.0, lat + dLat),
    lonMin: lon - dLon,
    lonMax: lon + dLon,
    spanM: radiusKm * 2000
  };
}

function degToMercatorPx(lat, lon, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  const siny = Math.max(-0.9999, Math.min(0.9999, Math.sin(rad(lat))));
  const px = ((wrapLon(lon) + 180) / 360) * scale;
  const py = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * scale;
  return { px, py };
}

function loadCorsImage(url, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      reject(new Error('Image load timeout'));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Image load failed'));
    };
    img.src = url;
  });
}

function bilinearResample(srcGrid, srcSize, dstSize) {
  if (srcSize === dstSize) return srcGrid;
  const out = new Float32Array(dstSize * dstSize);
  const step = (srcSize - 1) / Math.max(1, dstSize - 1);
  for (let r = 0; r < dstSize; r++) {
    const sy = r * step;
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcSize - 1, y0 + 1);
    const wy = sy - y0;
    for (let c = 0; c < dstSize; c++) {
      const sx = c * step;
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcSize - 1, x0 + 1);
      const wx = sx - x0;
      const v00 = srcGrid[y0 * srcSize + x0];
      const v01 = srcGrid[y0 * srcSize + x1];
      const v10 = srcGrid[y1 * srcSize + x0];
      const v11 = srcGrid[y1 * srcSize + x1];
      const top = v00 * (1 - wx) + v01 * wx;
      const bot = v10 * (1 - wx) + v11 * wx;
      out[r * dstSize + c] = top * (1 - wy) + bot * wy;
    }
  }
  return out;
}

function buildMercatorPatchSpec(bounds, zoom) {
  const minPt = degToMercatorPx(bounds.latMax, bounds.lonMin, zoom);
  const maxPt = degToMercatorPx(bounds.latMin, bounds.lonMax, zoom);
  const tileCount = Math.pow(2, zoom);
  const tx0 = Math.floor(minPt.px / 256);
  const tx1 = Math.floor(maxPt.px / 256);
  const ty0 = Math.max(0, Math.floor(minPt.py / 256));
  const ty1 = Math.min(tileCount - 1, Math.floor(maxPt.py / 256));

  let cropW = maxPt.px - minPt.px;
  if (cropW <= 1) cropW = Math.max(4, (tx1 - tx0 + 1) * 256 * 0.25);
  let cropH = maxPt.py - minPt.py;
  if (cropH <= 1) cropH = 4;

  return { minPt, maxPt, tileCount, tx0, tx1, ty0, ty1, cropW, cropH };
}

async function fetchMercatorCanvas(urlTemplate, bounds, zoom, outSize = 512, apiBase = null) {
  const spec = buildMercatorPatchSpec(bounds, zoom);
  const cols = spec.tx1 - spec.tx0 + 1;
  const rows = spec.ty1 - spec.ty0 + 1;
  if (cols <= 0 || rows <= 0 || cols * rows > 12) return null;

  const stitched = document.createElement('canvas');
  stitched.width = cols * 256;
  stitched.height = rows * 256;
  const sCtx = stitched.getContext('2d');

  const jobs = [];
  for (let ty = spec.ty0; ty <= spec.ty1; ty++) {
    for (let tx = spec.tx0; tx <= spec.tx1; tx++) {
      const wrappedX = ((tx % spec.tileCount) + spec.tileCount) % spec.tileCount;
      const rawUrl = urlTemplate
        .replace('{z}', String(zoom))
        .replace('{x}', String(wrappedX))
        .replace('{y}', String(ty));

      jobs.push(
        loadCorsImage(rawUrl)
          .catch(() => (apiBase ? loadCorsImage(`${apiBase}/terrain/proxy-tile?url=${encodeURIComponent(rawUrl)}`) : Promise.reject(new Error('Tile blocked'))))
          .then(img => {
            sCtx.drawImage(img, (tx - spec.tx0) * 256, (ty - spec.ty0) * 256, 256, 256);
            return true;
          })
          .catch(() => false)
      );
    }
  }

  const statuses = await Promise.all(jobs);
  if (!statuses.some(Boolean)) return null;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outSize;
  outCanvas.height = outSize;
  const oCtx = outCanvas.getContext('2d');
  const sx = Math.max(0, spec.minPt.px - spec.tx0 * 256);
  const sy = Math.max(0, spec.minPt.py - spec.ty0 * 256);
  oCtx.drawImage(stitched, sx, sy, spec.cropW, spec.cropH, 0, 0, outSize, outSize);
  return outCanvas;
}

async function fetchLocalEquirectangularPatchCanvas(planetKey, bounds, outSize = 512) {
  const cfg = PLANET_CONFIG[planetKey];
  if (!cfg || !cfg.textures || !cfg.textures.color) return null;

  for (const fileName of cfg.textures.color) {
    try {
      const img = await loadCorsImage(`./assets/textures/${fileName}`, 3500);
      const uMin = ((wrapLon(bounds.lonMin) + 180) / 360) * img.width;
      const uSpan = Math.max(4, ((bounds.lonMax - bounds.lonMin) / 360) * img.width);
      const vTop = Math.max(0, ((90 - bounds.latMax) / 180) * img.height);
      const vSpan = Math.max(4, ((bounds.latMax - bounds.latMin) / 180) * img.height);

      const canvas = document.createElement('canvas');
      canvas.width = outSize;
      canvas.height = outSize;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, uMin, vTop, Math.min(uSpan, img.width - uMin), Math.min(vSpan, img.height - vTop), 0, 0, outSize, outSize);
      return { canvas, fileName };
    } catch (_) {
      // Try next texture candidate
    }
  }
  return null;
}

async function fetchEarthTerrariumDEM(bounds, radiusKm, gridSize) {
  const zoom = radiusKm <= 6 ? 12 : (radiusKm <= 16 ? 11 : 10);
  const canvas = await fetchMercatorCanvas(TERRARIUM_URL, bounds, zoom, gridSize);
  if (!canvas) return null;

  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, gridSize, gridSize);
  const elev = new Float32Array(gridSize * gridSize);
  let validCount = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3];
    if (a === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    elev[p] = (r * 256 + g + b / 256) - 32768;
    validCount++;
  }

  if (validCount < elev.length * 0.5) return null;
  return {
    elevations: elev,
    source: `AWS Mapzen Terrarium DEM (Zoom ${zoom})`
  };
}

async function fetchOpenMeteoEarthDEM(bounds, gridSize) {
  const coarse = 10;
  const latList = [];
  const lonList = [];
  for (let r = 0; r < coarse; r++) {
    const lat = bounds.latMax - (r / (coarse - 1)) * (bounds.latMax - bounds.latMin);
    for (let c = 0; c < coarse; c++) {
      const lon = bounds.lonMin + (c / (coarse - 1)) * (bounds.lonMax - bounds.lonMin);
      latList.push(lat.toFixed(5));
      lonList.push(wrapLon(lon).toFixed(5));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const url = `${OPEN_METEO_URL}?latitude=${latList.join(',')}&longitude=${lonList.join(',')}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json.elevation) || json.elevation.length !== coarse * coarse) return null;
    const raw = Float32Array.from(json.elevation.map(v => (typeof v === 'number' ? v : 0)));
    return {
      elevations: bilinearResample(raw, coarse, gridSize),
      source: 'Open-Meteo Elevation API (Copernicus DEM 90m)'
    };
  } finally {
    clearTimeout(timer);
  }
}

function computeGridStats(elevations, spanM) {
  const n = Math.round(Math.sqrt(elevations.length));
  let minM = Infinity;
  let maxM = -Infinity;
  for (let i = 0; i < elevations.length; i++) {
    if (elevations[i] < minM) minM = elevations[i];
    if (elevations[i] > maxM) maxM = elevations[i];
  }

  const cellM = Math.max(1, spanM / Math.max(1, n - 1));
  let slopeSum = 0;
  let slopeCnt = 0;
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const idx = r * n + c;
      const dx = (elevations[idx + 1] - elevations[idx]) / cellM;
      const dy = (elevations[idx + n] - elevations[idx]) / cellM;
      const deg = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
      slopeSum += deg;
      slopeCnt++;
    }
  }

  return {
    minElevationM: minM,
    maxElevationM: maxM,
    reliefM: Math.max(0, maxM - minM),
    meanSlopeDeg: slopeCnt ? slopeSum / slopeCnt : 0
  };
}

function buildCalibratedRelief(planet, lat, lon, bounds, gridSize, textureCanvas = null, hintProfile = null) {
  const resolved = planet === 'earth' ? null : resolvePlanetaryPointJS(planet, lat, lon);
  const prof = (hintProfile && hintProfile.features) || {};
  const shared = (resolved && resolved.shared_17) || {};
  const resProf = (resolved && resolved.resolved_profile) || {};
  const resFeat = (resolved && resolved.features) || {};

  const baseElev = Number(shared.elevation_m ?? resProf.elevation_m ?? prof.elevation_m ?? (planet === 'earth' ? 450 : 0));
  const targetSlope = Number(shared.mean_slope_deg ?? resFeat.slope_deg ?? prof.slope_deg ?? 6.5);
  const roughness = Number(shared.terrain_roughness_m ?? (hintProfile && hintProfile.terrain_roughness_m) ?? 0.55);
  const terrainType = String(shared.terrain_type || resProf.terrain_type || (planet === 'earth' ? 'ridge_valley' : 'crater_rim'));
  const hasVoid = Number(shared.has_subsurface_void ?? resFeat.has_subsurface_void ?? prof.has_subsurface_void ?? 0);

  let texLum = null;
  if (textureCanvas) {
    try {
      const sCanvas = document.createElement('canvas');
      sCanvas.width = gridSize;
      sCanvas.height = gridSize;
      const sCtx = sCanvas.getContext('2d');
      sCtx.drawImage(textureCanvas, 0, 0, gridSize, gridSize);
      const px = sCtx.getImageData(0, 0, gridSize, gridSize).data;
      texLum = new Float32Array(gridSize * gridSize);
      for (let i = 0, p = 0; i < px.length; i += 4, p++) {
        texLum[p] = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255 - 0.5;
      }
    } catch (_) {
      texLum = null;
    }
  }

  const reliefScale = Math.max(90, bounds.spanM * Math.tan(rad(Math.max(2.2, targetSlope))) * 0.42);
  const seed = rad((lat * 13.37 + lon * 7.91) % 360);
  const elev = new Float32Array(gridSize * gridSize);

  for (let r = 0; r < gridSize; r++) {
    const y = (r / (gridSize - 1)) * 2 - 1;
    for (let c = 0; c < gridSize; c++) {
      const x = (c / (gridSize - 1)) * 2 - 1;
      const rr = Math.hypot(x, y);
      const ridges =
        0.46 * Math.sin(x * 3.5 + seed) * Math.cos(y * 2.8 - seed) +
        0.26 * Math.sin((x + y) * 6.8 + seed * 2) +
        0.14 * Math.cos((x - y) * 12.2 - seed) +
        0.08 * Math.sin(x * 20 + y * 18) * (0.45 + roughness);

      let shape = ridges;
      if (terrainType === 'crater_rim') {
        const crater = -0.75 * Math.exp(-Math.pow(rr * 1.9, 2)) + 0.52 * Math.exp(-Math.pow((rr - 0.52) * 5.0, 2));
        shape = 0.55 * crater + 0.45 * ridges;
      } else if (terrainType === 'volcanic_plain') {
        const dome = 0.35 * Math.exp(-Math.pow(rr * 1.4, 2));
        const pit = hasVoid ? -0.95 * Math.exp(-Math.pow(rr * 6.5, 2)) : 0;
        shape = 0.35 * ridges + dome + pit;
      } else if (terrainType === 'aeolian_desert') {
        const dunes = 0.52 * Math.sin(x * 9.5 + Math.sin(y * 3.5) * 1.4);
        shape = 0.58 * dunes + 0.42 * ridges;
      }

      const idx = r * gridSize + c;
      const texBoost = texLum ? texLum[idx] * 0.55 : 0;
      elev[idx] = baseElev + (shape + texBoost) * reliefScale;
    }
  }
  return elev;
}

export async function loadTerrainPatch({
  planet = 'earth',
  lat = 0,
  lon = 0,
  radiusKm = 10,
  gridSize = 80,
  hintProfile = null
} = {}) {
  const body = String(planet).toLowerCase() === 'moon' ? 'moon' : (String(planet).toLowerCase() === 'mars' ? 'mars' : 'earth');
  const cacheKey = `${body}:${Number(lat).toFixed(3)}:${Number(lon).toFixed(3)}:${radiusKm}:${gridSize}`;
  if (patchCache.has(cacheKey)) {
    return patchCache.get(cacheKey);
  }

  const bounds = computeTerrainBounds(Number(lat), Number(lon), radiusKm, body);
  const apiBase = await probeLiveBackendBase().catch(() => null);

  let surfaceCanvas = null;
  let imagerySource = 'Natural Geomorphic Shading';

  if (body === 'earth') {
    const zTex = radiusKm <= 6 ? 13 : (radiusKm <= 16 ? 12 : 11);
    surfaceCanvas = await fetchMercatorCanvas(TILE_LAYERS.earth[0].url, bounds, zTex, 512, apiBase).catch(() => null);
    if (surfaceCanvas) {
      imagerySource = `Esri World Imagery (Z${zTex})`;
    } else {
      const localEarth = await fetchLocalEquirectangularPatchCanvas('earth', bounds, 512);
      if (localEarth) {
        surfaceCanvas = localEarth.canvas;
        imagerySource = `Local ${localEarth.fileName}`;
      }
    }
  } else {
    const zOpm = radiusKm <= 8 ? 8 : (radiusKm <= 18 ? 7 : 6);
    const opmLayer = TILE_LAYERS[body] && TILE_LAYERS[body][0];
    if (opmLayer) {
      surfaceCanvas = await fetchMercatorCanvas(opmLayer.url, bounds, zOpm, 512, apiBase).catch(() => null);
      if (surfaceCanvas) imagerySource = opmLayer.label;
    }
    if (!surfaceCanvas) {
      const localPlanetary = await fetchLocalEquirectangularPatchCanvas(body, bounds, 512);
      if (localPlanetary) {
        surfaceCanvas = localPlanetary.canvas;
        imagerySource = `${PLANET_CONFIG[body].title} ${localPlanetary.fileName}`;
      }
    }
  }

  let elevations = null;
  let demSource = '';

  if (body === 'earth') {
    const terrarium = await fetchEarthTerrariumDEM(bounds, radiusKm, gridSize).catch(() => null);
    if (terrarium) {
      elevations = terrarium.elevations;
      demSource = terrarium.source;
    } else {
      const openMeteo = await fetchOpenMeteoEarthDEM(bounds, gridSize).catch(() => null);
      if (openMeteo) {
        elevations = openMeteo.elevations;
        demSource = openMeteo.source;
      }
    }
  }

  if (!elevations && apiBase) {
    try {
      const qs = new URLSearchParams({
        planet: body,
        lat: String(Number(lat).toFixed(4)),
        lon: String(Number(lon).toFixed(4)),
        radius_km: String(radiusKm),
        grid_size: String(gridSize)
      });
      const res = await fetch(`${apiBase}/terrain/patch?${qs.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.elevations_m) && json.elevations_m.length === gridSize * gridSize) {
          elevations = Float32Array.from(json.elevations_m);
          demSource = json.source || 'Backend Terrain API';
        }
      }
    } catch (_) {
      // Fallback below
    }
  }

  if (!elevations) {
    elevations = buildCalibratedRelief(body, Number(lat), Number(lon), bounds, gridSize, surfaceCanvas, hintProfile);
    if (body === 'earth') {
      demSource = 'Offline Geomorphic Synthesis (Earth Fallback)';
    } else {
      demSource = `${body === 'moon' ? 'LRO LOLA' : 'MGS MOLA/HRSC'} Profile + Surface Relief`;
    }
  }

  const stats = computeGridStats(elevations, bounds.spanM);
  const result = {
    planet: body,
    lat: Number(lat),
    lon: Number(lon),
    radiusKm,
    gridSize,
    spanM: bounds.spanM,
    elevations,
    surfaceCanvas,
    imagerySource,
    demSource,
    trekRefUrl: TREK_WMTS_URLS[body] || '',
    ...stats
  };

  patchCache.set(cacheKey, result);
  return result;
}
