import { PLANET_CONFIG, TILE_LAYERS } from '../config/constants.js';
import { appState } from '../state/appState.js';
import { threeCtx } from '../scene/threeScene.js';
import { vector3ToLatLon } from '../scene/planetBuilder.js';
import { setPickedPin3D } from '../scene/markersAndArcs.js';
import { populateGpsFrom2DMap } from '../ui/popups.js';
import { bringWindowToFront, clampWindowToViewport, makeWindowDraggable } from '../ui/windowManager.js';

// ==========================================
// 5B. BẢN ĐỒ 2D SIÊU NÉT (TILE MAP API - LEAFLET)
// ==========================================
let map2dPanel = null;
let map2dTitle = null;
let map2dCoords = null;
let map2dLayersEl = null;
let map2dSource = null;
let btnMap2dSend = null;

let leafletMap = null;
let leafletTileLayer = null;
let leafletMarker = null;
let leafletFootprintLayer = null;

function ensureLeafletMap() {
  if (leafletMap || typeof L === 'undefined') return;
  leafletMap = L.map('map2d-canvas', {
    center: [0, 0],
    zoom: 4,
    worldCopyJump: true,
    attributionControl: false
  });

  leafletMap.on('click', (ev) => {
    let lon = ev.latlng.lng;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    const lat = THREE.MathUtils.clamp(ev.latlng.lat, -85.05, 85.05);
    appState.map2dState.lat = lat;
    appState.map2dState.lon = lon;
    appState.map2dState.label = 'Điểm chọn trên bản đồ 2D';
    map2dCoords.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
    if (leafletMarker) leafletMarker.setLatLng([lat, lon]);
    setPickedPin3D(appState.map2dState.planetKey, lat, lon);
  });
}

function apply2DTileLayer(planetKey, layerId, shouldResetZoom = false) {
  ensureLeafletMap();
  if (!leafletMap) return;
  const layers = TILE_LAYERS[planetKey] || TILE_LAYERS.earth;
  const chosen = layers.find(l => l.id === layerId) || layers[0];
  appState.map2dState.layerId = chosen.id;

  if (leafletTileLayer) {
    leafletMap.removeLayer(leafletTileLayer);
  }
  leafletTileLayer = L.tileLayer(chosen.url, {
    maxNativeZoom: chosen.maxNativeZoom,
    maxZoom: chosen.maxZoom,
    noWrap: false
  }).addTo(leafletMap);

  map2dSource.textContent = 'Nguồn Tile API: ' + chosen.attribution;

  map2dLayersEl.innerHTML = layers.map(l => `
    <button class="map2d-layer-chip ${l.id === chosen.id ? 'active' : ''}" data-layer="${l.id}" type="button">${l.label}</button>
  `).join('');
  map2dLayersEl.querySelectorAll('.map2d-layer-chip').forEach(chip => {
    chip.addEventListener('click', () => apply2DTileLayer(planetKey, chip.dataset.layer, true));
  });

  if (shouldResetZoom) {
    leafletMap.setView([appState.map2dState.lat, appState.map2dState.lon], chosen.defaultZoom);
  }
}

export function open2DMapAt(planetKey, lat, lon, label, footprintMode = null) {
  if (typeof L === 'undefined') return;
  if (!map2dPanel) {
    map2dPanel = document.getElementById('map2d-panel');
    map2dTitle = document.getElementById('map2d-title');
    map2dCoords = document.getElementById('map2d-coords');
    map2dLayersEl = document.getElementById('map2d-layers');
    map2dSource = document.getElementById('map2d-source');
    btnMap2dSend = document.getElementById('btn-map2d-send');
  }

  const { map2dState } = appState;
  const clampedLat = THREE.MathUtils.clamp(lat, -85.05, 85.05);
  const planetChanged = map2dState.planetKey !== planetKey || !leafletTileLayer;

  map2dState.planetKey = planetKey;
  map2dState.lat = clampedLat;
  map2dState.lon = lon;
  map2dState.label = label || '';

  const pName = PLANET_CONFIG[planetKey] ? PLANET_CONFIG[planetKey].title : planetKey;
  map2dTitle.textContent = label ? `2D · ${label}` : `Vị trí 2D · ${pName}`;
  map2dCoords.textContent = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
  btnMap2dSend.textContent = planetKey === 'earth' ? '➕ Gán vào GPS 1 (Earth)' : `➕ Gán vào GPS 2 (${planetKey === 'moon' ? 'Moon' : 'Mars'})`;

  map2dPanel.hidden = false;
  bringWindowToFront(map2dPanel);
  clampWindowToViewport(map2dPanel);
  setPickedPin3D(planetKey, lat, lon);

  ensureLeafletMap();
  const layers = TILE_LAYERS[planetKey] || TILE_LAYERS.earth;
  const targetLayer = planetChanged ? layers[0] : (layers.find(l => l.id === map2dState.layerId) || layers[0]);
  if (planetChanged) {
    apply2DTileLayer(planetKey, targetLayer.id, false);
  }

  if (!leafletMarker) {
    leafletMarker = L.circleMarker([clampedLat, lon], {
      radius: 7,
      color: '#22d3ee',
      weight: 2,
      fillColor: '#0284c7',
      fillOpacity: 0.75
    }).addTo(leafletMap);
  } else {
    leafletMarker.setLatLng([clampedLat, lon]);
  }

  if (leafletFootprintLayer) {
    leafletMap.removeLayer(leafletFootprintLayer);
    leafletFootprintLayer = null;
  }

  let desiredZoom = Math.max(leafletMap.getZoom() || 0, targetLayer.defaultZoom);
  if (planetKey === 'earth' && footprintMode) {
    if (footprintMode === 'square_1km') {
      const dLat = 500 / 111320;
      const cosLat = Math.max(0.2, Math.cos(clampedLat * Math.PI / 180));
      const dLon = 500 / (111320 * cosLat);
      leafletFootprintLayer = L.rectangle(
        [[clampedLat - dLat, lon - dLon], [clampedLat + dLat, lon + dLon]],
        { color: '#38bdf8', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.16, dashArray: '5,4' }
      ).addTo(leafletMap);
      desiredZoom = 13;
    } else if (footprintMode === 'circle_5km') {
      leafletFootprintLayer = L.circle([clampedLat, lon], {
        radius: 5000,
        color: '#34d399',
        weight: 2,
        fillColor: '#34d399',
        fillOpacity: 0.12
      }).addTo(leafletMap);
      desiredZoom = 11;
    } else if (footprintMode === 'circle_500m') {
      leafletFootprintLayer = L.circle([clampedLat, lon], {
        radius: 500,
        color: '#f59e0b',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 0.18
      }).addTo(leafletMap);
      desiredZoom = 14;
    }
  }

  setTimeout(() => {
    leafletMap.invalidateSize();
    leafletMap.setView([clampedLat, lon], desiredZoom);
  }, 30);
}

export function initMap2DAndRaycaster() {
  map2dPanel = document.getElementById('map2d-panel');
  map2dTitle = document.getElementById('map2d-title');
  map2dCoords = document.getElementById('map2d-coords');
  map2dLayersEl = document.getElementById('map2d-layers');
  map2dSource = document.getElementById('map2d-source');
  btnMap2dSend = document.getElementById('btn-map2d-send');

  makeWindowDraggable(map2dPanel, map2dPanel.querySelector('.map2d-header'));

  document.getElementById('btn-map2d-close').addEventListener('click', () => {
    map2dPanel.hidden = true;
  });

  document.getElementById('btn-map2d-expand').addEventListener('click', () => {
    map2dPanel.classList.toggle('expanded');
    bringWindowToFront(map2dPanel);
    setTimeout(() => {
      clampWindowToViewport(map2dPanel);
      if (leafletMap) leafletMap.invalidateSize();
    }, 260);
  });

  btnMap2dSend.addEventListener('click', () => {
    populateGpsFrom2DMap(appState.map2dState.planetKey, appState.map2dState.lat, appState.map2dState.lon);
  });

  // Click trực tiếp lên bề mặt 3D (chỉ kích hoạt khi không phải kéo chuột xoay)
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const { renderer, camera } = threeCtx;
  let downPos = { x: 0, y: 0 };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    const moveDist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (moveDist > 5) return; // Đang kéo xoay quả cầu, bỏ qua

    const visibleGroups = Object.values(appState.planetModels).filter(g => g && g.visible);
    if (!visibleGroups.length) return;

    const surfaces = [];
    const markersList = [];
    visibleGroups.forEach(group => {
      const surface = group.getObjectByName('surface');
      if (!surface) return;
      surfaces.push(surface);
      if (appState.showMarkers) {
        const markers = surface.getObjectByName('markers');
        if (markers) markersList.push(...markers.children);
      }
    });

    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const surfaceHits = raycaster.intersectObjects(surfaces, false);
    if (!surfaceHits.length) return;

    const firstSurfaceHit = surfaceHits[0];
    const clickedKey = firstSurfaceHit.object.userData.planetKey || appState.activePlanetKey;

    // Ưu tiên nếu click trúng ghim Analog có sẵn
    const markerHits = raycaster.intersectObjects(markersList, false);
    const markerHit = markerHits.find(h => h.object.userData && h.object.userData.site && h.distance <= firstSurfaceHit.distance + 0.12);
    if (markerHit) {
      const site = markerHit.object.userData.site;
      open2DMapAt(clickedKey, site.lat, site.lon, site.name);
      return;
    }

    const localPt = firstSurfaceHit.object.worldToLocal(firstSurfaceHit.point.clone());
    const { lat, lon } = vector3ToLatLon(localPt);
    open2DMapAt(clickedKey, lat, lon, '');
  });
}
