import { PLANET_CONFIG } from '../config/constants.js';
import { appState } from '../state/appState.js';
import { threeCtx } from '../scene/threeScene.js';
import { latLonToVector3 } from '../scene/planetBuilder.js';
import {
  clearCustomPins,
  createCustomPin,
  parseGpsInput,
  rotateSurfaceToFront,
  setLinkGroupVisible,
  updateLinkArcGeometry
} from '../scene/markersAndArcs.js';

export function exitDualLinkMode(nextPlanetKey) {
  if (!appState.dualLinkState.active) return;
  appState.dualLinkState.active = false;
  setLinkGroupVisible(false);
  document.getElementById('dual-link-banner').hidden = true;

  Object.values(appState.planetModels).forEach(group => {
    if (!group) return;
    group.position.set(0, 0, 0);
    group.scale.setScalar(1);
  });

  threeCtx.camera.position.set(0, 0.8, 5.4);
  threeCtx.controls.target.set(0, 0, 0);
  threeCtx.controls.update();

  if (nextPlanetKey) {
    selectPlanet(nextPlanetKey);
  }
}

export function applyAnalogLink({ earthLat, earthLon, targetPlanet, targetLat, targetLon, pairSource = 'dual' }) {
  if (!PLANET_CONFIG[targetPlanet] || targetPlanet === 'earth') targetPlanet = 'mars';
  if (!appState.planetModels.earth || !appState.planetModels[targetPlanet]) {
    appState.pendingLinkArgs = { earthLat, earthLon, targetPlanet, targetLat, targetLon, pairSource };
    return;
  }
  appState.pendingLinkArgs = null;
  appState.lastTerrainPairSource = pairSource;
  clearCustomPins();

  const { dualLinkState, planetModels } = appState;
  dualLinkState.active = true;
  dualLinkState.targetPlanet = targetPlanet;
  dualLinkState.earthLat = earthLat;
  dualLinkState.earthLon = earthLon;
  dualLinkState.targetLat = targetLat;
  dualLinkState.targetLon = targetLon;

  dualLinkState.earthPin = createCustomPin('earth', earthLat, earthLon, 'GPS 1 · Earth', 0xf43f5e);
  dualLinkState.targetPin = createCustomPin(targetPlanet, targetLat, targetLon, `GPS 2 · ${PLANET_CONFIG[targetPlanet].title}`, 0xfacc15);

  // Rotate both GPS points toward each other on the front hemisphere
  rotateSurfaceToFront('earth', earthLat, earthLon, 0.32);
  rotateSurfaceToFront(targetPlanet, targetLat, targetLon, -0.32);

  Object.entries(planetModels).forEach(([name, group]) => {
    if (!group) return;
    if (name === 'earth') {
      group.visible = true;
      group.position.set(-2.05, 0, 0);
      group.scale.setScalar(0.82);
    } else if (name === targetPlanet) {
      group.visible = true;
      group.position.set(2.05, 0, 0);
      group.scale.setScalar(0.82);
    } else {
      group.visible = false;
    }
  });

  // Disable autoRotate to keep both planets balanced left/right while viewing the link arc
  threeCtx.controls.autoRotate = false;
  document.getElementById('btn-autorotate').classList.remove('active');

  threeCtx.camera.position.set(0, 0.4, 6.7);
  threeCtx.controls.target.set(0, 0, 0);
  threeCtx.controls.update();

  setLinkGroupVisible(true);
  updateLinkArcGeometry();

  document.querySelectorAll('.planet-card').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.planet === 'earth' || btn.dataset.planet === targetPlanet);
  });

  const targetLabel = targetPlanet === 'moon' ? 'Moon' : 'Mars';
  document.getElementById('dual-link-text').textContent =
    `Earth (${earthLat.toFixed(2)}°, ${earthLon.toFixed(2)}°) <-> ${targetLabel} (${targetLat.toFixed(2)}°, ${targetLon.toFixed(2)}°)`;
  document.getElementById('dual-link-banner').hidden = false;
  updateInfoPanel('earth');
}

export function updateInfoPanel(key) {
  const cfg = PLANET_CONFIG[key];
  document.documentElement.style.setProperty('--active-accent', cfg.accent);
  document.getElementById('info-tag').textContent = cfg.tag;
  document.getElementById('info-title').textContent = cfg.title;
  document.getElementById('info-desc').textContent = cfg.desc;

  document.getElementById('stats-grid').innerHTML = cfg.stats.map(s => `
    <div class="stat-item">
      <span class="stat-label">${s.label}</span>
      <span class="stat-value">${s.value}</span>
    </div>
  `).join('');

  document.getElementById('analogs-title').textContent = cfg.analogsTitle;
  const analogsList = document.getElementById('analogs-list');
  analogsList.innerHTML = cfg.analogs.map((site, idx) => `
    <button class="analog-item" data-index="${idx}" type="button">
      <div class="analog-name">
        <span>${site.name}</span>
        <span class="analog-coords">${site.lat.toFixed(1)}°, ${site.lon.toFixed(1)}°</span>
      </div>
      <div class="analog-note">${site.note}</div>
    </button>
  `).join('');

  analogsList.querySelectorAll('.analog-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      analogsList.querySelectorAll('.analog-item').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      focusCameraOnLatLon(key, cfg.analogs[idx].lat, cfg.analogs[idx].lon);
    });
  });

  const st = appState.textureState[key];
  const texStatusEl = document.getElementById('texture-status');
  if (st.status === 'real') {
    texStatusEl.className = 'texture-status real';
    texStatusEl.textContent = `Using real imagery: ${st.fileName}`;
  } else if (st.status === 'loading') {
    texStatusEl.className = 'texture-status';
    texStatusEl.textContent = 'Loading satellite imagery from assets/textures/...';
  } else if (window.location.protocol === 'file:') {
    texStatusEl.className = 'texture-status fallback';
    texStatusEl.textContent = 'Opened via file://. Run start_local.bat or click below to pick a local texture.';
  } else {
    texStatusEl.className = 'texture-status fallback';
    texStatusEl.textContent = `Texture not found (${cfg.textures.color.slice(0, 2).join(' or ')}) in assets/textures/.`;
  }
}

export function focusCameraOnLatLon(key, lat, lon) {
  if (appState.dualLinkState.active) {
    exitDualLinkMode(key);
  }
  const group = appState.planetModels[key];
  if (!group) return;
  const surface = group.getObjectByName('surface');
  if (!surface) return;

  // Pause auto-rotate so the user can clearly inspect the selected site
  threeCtx.controls.autoRotate = false;
  document.getElementById('btn-autorotate').classList.remove('active');

  surface.updateMatrixWorld(true);
  const worldPos = latLonToVector3(lat, lon, 1).applyMatrix4(surface.matrixWorld).normalize();
  const dist = threeCtx.camera.position.length() || 5.4;
  threeCtx.camera.up.set(0, 1, 0);
  threeCtx.camera.position.copy(worldPos.multiplyScalar(dist));
  threeCtx.controls.target.set(0, 0, 0);
  threeCtx.controls.update();
}

export function selectPlanet(key) {
  if (!PLANET_CONFIG[key]) return;
  if (appState.dualLinkState.active) {
    exitDualLinkMode(null);
  }
  appState.activePlanetKey = key;

  document.querySelectorAll('.planet-card').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.planet === key);
  });

  Object.entries(appState.planetModels).forEach(([name, group]) => {
    if (!group) return;
    group.visible = (name === key);
    group.position.set(0, 0, 0);
    if (name === key) group.scale.setScalar(0.58);
  });

  appState.transitionProgress = 0;
  updateInfoPanel(key);
}

export function applyAxisMode() {
  Object.entries(appState.planetModels).forEach(([key, group]) => {
    if (!group || !PLANET_CONFIG[key]) return;
    group.rotation.z = appState.isUprightAxis ? 0 : THREE.MathUtils.degToRad(PLANET_CONFIG[key].tiltDeg);
  });
  threeCtx.camera.up.set(0, 1, 0);
  threeCtx.controls.update();
  if (appState.dualLinkState.active) {
    updateLinkArcGeometry();
  }
}

export function initControlsAndDock() {
  // Allow teammates to invoke directly from scripts or DevTools
  window.linkAnalogCoordinates = function (earthCoord, targetPlanet, targetCoord) {
    const e = typeof earthCoord === 'string' ? parseGpsInput(earthCoord) : earthCoord;
    const t = typeof targetCoord === 'string' ? parseGpsInput(targetCoord) : targetCoord;
    if (!e || !t) return false;
    applyAnalogLink({
      earthLat: e.lat,
      earthLon: e.lon,
      targetPlanet,
      targetLat: t.lat,
      targetLon: t.lon
    });
    return true;
  };

  document.querySelectorAll('.planet-card').forEach(card => {
    card.addEventListener('click', () => selectPlanet(card.dataset.planet));
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === '1') selectPlanet('earth');
    if (e.key === '2') selectPlanet('moon');
    if (e.key === '3') selectPlanet('mars');
  });

  const btnAutoRotate = document.getElementById('btn-autorotate');
  btnAutoRotate.addEventListener('click', () => {
    threeCtx.controls.autoRotate = !threeCtx.controls.autoRotate;
    btnAutoRotate.classList.toggle('active', threeCtx.controls.autoRotate);
  });

  const btnUprightAxis = document.getElementById('btn-upright-axis');
  btnUprightAxis.classList.toggle('active', appState.isUprightAxis);
  btnUprightAxis.addEventListener('click', () => {
    appState.isUprightAxis = !appState.isUprightAxis;
    try {
      localStorage.setItem('dlt_axis_upright', String(appState.isUprightAxis));
    } catch (_) {}
    btnUprightAxis.classList.toggle('active', appState.isUprightAxis);
    applyAxisMode();
  });

  const btnMarkers = document.getElementById('btn-markers');
  btnMarkers.addEventListener('click', () => {
    appState.showMarkers = !appState.showMarkers;
    btnMarkers.classList.toggle('active', appState.showMarkers);
    Object.values(appState.planetModels).forEach(group => {
      const surface = group && group.getObjectByName('surface');
      const m = surface && surface.getObjectByName('markers');
      if (m) m.visible = appState.showMarkers;
    });
  });

  const btnWireframe = document.getElementById('btn-wireframe');
  btnWireframe.addEventListener('click', () => {
    appState.isWireframe = !appState.isWireframe;
    btnWireframe.classList.toggle('active', appState.isWireframe);
    Object.entries(appState.planetModels).forEach(([key, group]) => {
      const surface = group && group.getObjectByName('surface');
      if (surface && appState.textureState[key].status === 'real') {
        surface.material.wireframe = appState.isWireframe;
      }
    });
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    threeCtx.camera.up.set(0, 1, 0);
    if (appState.dualLinkState.active) {
      threeCtx.camera.position.set(0, 0.4, 6.7);
    } else {
      threeCtx.camera.position.set(0, 0.8, 5.4);
    }
    threeCtx.controls.target.set(0, 0, 0);
    threeCtx.controls.update();
  });

  document.getElementById('btn-exit-dual').addEventListener('click', () => {
    exitDualLinkMode(appState.activePlanetKey);
  });
}
