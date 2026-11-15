import { appState } from '../state/appState.js';
import { toggleToolsMenu } from '../ui/popups.js';
import { bringWindowToFront, clampWindowToViewport, makeWindowDraggable } from '../ui/windowManager.js';
import { loadTerrainPatch } from './terrainApi.js';
import { createTerrainViewport } from './terrainMeshBuilder.js';

let terrainPopup = null;
let btnTerrainMenu = null;
let btnTerrainClose = null;
let btnTerrainExpand = null;
let btnTerrainSync = null;
let btnTerrainReset = null;
let exagSlider = null;
let exagValEl = null;

let subtitleEl = null;
let earthPane = null;
let earthTitleEl = null;
let earthCoordsEl = null;
let earthCanvasWrap = null;
let earthStatusEl = null;
let earthStatsEl = null;
let earthSourceEl = null;

let targetPane = null;
let targetHeaderTitleEl = null;
let targetCoordsEl = null;
let targetCanvasWrap = null;
let targetStatusEl = null;
let targetStatsEl = null;
let targetSourceEl = null;

let earthViewport = null;
let targetViewport = null;
let rafId = null;
let loadSeq = 0;

let activeConfig = {
  viewMode: 'compare', // 'compare' | 'single'
  singlePlanet: 'earth', // 'earth' | 'moon' | 'mars'
  earthSite: { name: 'Atacama Desert (Valle de la Luna)', lat: -24.5, lon: -69.2 },
  targetSite: { name: 'Jezero Crater', planet: 'mars', lat: 18.38, lon: 77.58 },
  radiusKm: 10,
  syncCamera: true,
  shadingMode: 'satellite',
  exaggeration: 2.0
};

function startRenderLoop() {
  if (rafId !== null) return;
  const tick = () => {
    if (!terrainPopup || terrainPopup.hidden) {
      rafId = null;
      return;
    }
    if (earthViewport && earthPane && !earthPane.hidden) earthViewport.renderFrame();
    if (targetViewport && targetPane && !targetPane.hidden) targetViewport.renderFrame();
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function ensureViewports() {
  const showEarth = !earthPane || !earthPane.hidden;
  const showTarget = !targetPane || !targetPane.hidden;

  if (showEarth && !earthViewport && earthCanvasWrap) {
    earthViewport = createTerrainViewport(earthCanvasWrap);
    earthViewport.setCameraSyncListener(sph => {
      if (activeConfig.viewMode === 'compare' && activeConfig.syncCamera && targetViewport) {
        targetViewport.applySphericalCamera(sph);
      }
    });
  }
  if (showTarget && !targetViewport && targetCanvasWrap) {
    targetViewport = createTerrainViewport(targetCanvasWrap);
    targetViewport.setCameraSyncListener(sph => {
      if (activeConfig.viewMode === 'compare' && activeConfig.syncCamera && earthViewport) {
        earthViewport.applySphericalCamera(sph);
      }
    });
  }
  if (showEarth && earthViewport) earthViewport.resize();
  if (showTarget && targetViewport) targetViewport.resize();
}

function syncLayoutUI() {
  if (!terrainPopup) return;
  const isSingle = activeConfig.viewMode === 'single';
  terrainPopup.classList.toggle('single-mode', isSingle);

  const showEarth = !isSingle || activeConfig.singlePlanet === 'earth';
  const showTarget = !isSingle || activeConfig.singlePlanet !== 'earth';

  if (earthPane) earthPane.hidden = !showEarth;
  if (targetPane) targetPane.hidden = !showTarget;
  if (btnTerrainSync) btnTerrainSync.hidden = isSingle;

  if (subtitleEl) {
    if (isSingle) {
      const label = activeConfig.singlePlanet === 'moon' ? 'Moon' : (activeConfig.singlePlanet === 'mars' ? 'Mars' : 'Earth');
      subtitleEl.textContent = `Single-site 3D DEM cutaway relief (${label}) · Switch to Dual Compare anytime`;
    } else {
      subtitleEl.textContent = 'Side-by-side DEM cutaway relief (Earth Analog vs Moon / Mars Target)';
    }
  }

  terrainPopup.querySelectorAll('[data-terrain-layout]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.terrainLayout === activeConfig.viewMode);
  });
}

function syncExpandButtonUI() {
  if (!terrainPopup || !btnTerrainExpand) return;
  const isExpanded = terrainPopup.classList.contains('expanded');
  btnTerrainExpand.textContent = isExpanded ? 'Collapse' : 'Expand';
  btnTerrainExpand.classList.toggle('active', isExpanded);
}

function toggleTerrainExpand(forceExpand) {
  if (!terrainPopup) return;
  const next = typeof forceExpand === 'boolean'
    ? forceExpand
    : !terrainPopup.classList.contains('expanded');
  terrainPopup.classList.toggle('expanded', next);
  syncExpandButtonUI();
  bringWindowToFront(terrainPopup);
  requestAnimationFrame(() => ensureViewports());
  setTimeout(() => {
    if (!next) clampWindowToViewport(terrainPopup);
    ensureViewports();
  }, 240);
}

function buildDualLinkPair() {
  const { dualLinkState } = appState;
  const p = dualLinkState.targetPlanet === 'moon' ? 'moon' : 'mars';
  return {
    earthSite: {
      name: 'Dual Link (Earth)',
      lat: Number(dualLinkState.earthLat),
      lon: Number(dualLinkState.earthLon)
    },
    targetSite: {
      name: p === 'moon' ? 'Dual Link (Moon)' : 'Dual Link (Mars)',
      planet: p,
      lat: Number(dualLinkState.targetLat),
      lon: Number(dualLinkState.targetLon)
    },
    radiusKm: 10
  };
}

function resolveDefaultPairFromState() {
  const { finderState, dualLinkState, lastTerrainPairSource } = appState;

  if (dualLinkState && dualLinkState.active && lastTerrainPairSource === 'dual') {
    return buildDualLinkPair();
  }

  const data = finderState && finderState.data;
  if (data && Array.isArray(data.targets) && Array.isArray(data.missions)) {
    const targetObj = data.targets.find(t => t.target_id === finderState.selectedTargetId) || data.targets[0];
    const missionObj = data.missions.find(m => m.mission_id === finderState.selectedMissionId) || data.missions[0];
    const ranked = (targetObj && missionObj && data.results?.[targetObj.target_id]?.[missionObj.mission_id]) || [];
    const site = ranked.find(r => r.site_id === finderState.selectedSiteId) || ranked[0];
    if (targetObj && site) {
      const fp = String(missionObj?.footprint_mode || 'circle_5km');
      const radiusKm = fp === 'circle_5km' ? 10 : 5;
      return {
        earthSite: {
          name: site.micro_site_name || site.name || 'Earth Analog',
          lat: Number(site.lat),
          lon: Number(site.lon),
          features: site.features
        },
        targetSite: {
          name: targetObj.target_name || targetObj.target_id,
          planet: String(targetObj.planet || 'moon').toLowerCase(),
          lat: Number(targetObj.lat),
          lon: Number(targetObj.lon),
          features: targetObj.features
        },
        radiusKm
      };
    }
  }

  if (dualLinkState && dualLinkState.active) {
    return buildDualLinkPair();
  }

  return {
    earthSite: { name: 'Atacama Desert (Valle de la Luna)', lat: -24.5, lon: -69.2 },
    targetSite: { name: 'Jezero Crater', planet: 'mars', lat: 18.38, lon: 77.58 },
    radiusKm: 10
  };
}

function updateStatsUI(statsEl, sourceEl, patch) {
  if (statsEl) {
    statsEl.textContent =
      `Min ${patch.minElevationM.toFixed(0)} m | Max ${patch.maxElevationM.toFixed(0)} m | Relief ${patch.reliefM.toFixed(0)} m | Avg Slope ${patch.meanSlopeDeg.toFixed(1)}°`;
  }
  if (sourceEl) {
    sourceEl.textContent = `DEM: ${patch.demSource} | Surface: ${patch.imagerySource}`;
  }
}

async function loadAndRender() {
  const reqId = ++loadSeq;
  const { earthSite, targetSite, radiusKm, viewMode, singlePlanet } = activeConfig;
  const needEarth = viewMode === 'compare' || singlePlanet === 'earth';
  const needTarget = viewMode === 'compare' || singlePlanet !== 'earth';
  const targetPlanetLabel = targetSite.planet === 'moon' ? 'Moon' : 'Mars';

  if (needEarth) {
    if (earthTitleEl) earthTitleEl.textContent = `${viewMode === 'single' ? 'Earth Site' : 'Earth Analog'}: ${earthSite.name}`;
    if (earthCoordsEl) earthCoordsEl.textContent = `${earthSite.lat.toFixed(3)}°, ${earthSite.lon.toFixed(3)}° (±${radiusKm} km)`;
    if (earthStatusEl) {
      earthStatusEl.hidden = false;
      earthStatusEl.textContent = 'Loading Earth DEM & Imagery...';
    }
  }
  if (needTarget) {
    if (targetHeaderTitleEl) targetHeaderTitleEl.textContent = `${targetPlanetLabel} ${viewMode === 'single' ? 'Site' : 'Target'}: ${targetSite.name}`;
    if (targetCoordsEl) targetCoordsEl.textContent = `${targetSite.lat.toFixed(3)}°, ${targetSite.lon.toFixed(3)}° (±${radiusKm} km)`;
    if (targetStatusEl) {
      targetStatusEl.hidden = false;
      targetStatusEl.textContent = `Loading ${targetPlanetLabel} DEM & Surface...`;
    }
  }

  syncLayoutUI();
  ensureViewports();

  const [earthPatch, targetPatch] = await Promise.all([
    needEarth
      ? loadTerrainPatch({
          planet: 'earth',
          lat: earthSite.lat,
          lon: earthSite.lon,
          radiusKm,
          gridSize: 80,
          hintProfile: earthSite
        })
      : Promise.resolve(null),
    needTarget
      ? loadTerrainPatch({
          planet: targetSite.planet,
          lat: targetSite.lat,
          lon: targetSite.lon,
          radiusKm,
          gridSize: 80,
          hintProfile: targetSite
        })
      : Promise.resolve(null)
  ]);

  if (reqId !== loadSeq) return;

  if (needEarth && earthPatch && earthViewport) {
    earthViewport.setVerticalExaggeration(activeConfig.exaggeration);
    earthViewport.setShadingMode(activeConfig.shadingMode);
    earthViewport.setTerrainPatch(earthPatch);
    if (earthStatusEl) earthStatusEl.hidden = true;
    updateStatsUI(earthStatsEl, earthSourceEl, earthPatch);
  }
  if (needTarget && targetPatch && targetViewport) {
    targetViewport.setVerticalExaggeration(activeConfig.exaggeration);
    targetViewport.setShadingMode(activeConfig.shadingMode);
    targetViewport.setTerrainPatch(targetPatch);
    if (targetStatusEl) targetStatusEl.hidden = true;
    updateStatsUI(targetStatsEl, targetSourceEl, targetPatch);
  }
}

function syncToolbarChips() {
  if (exagSlider) exagSlider.value = String(activeConfig.exaggeration);
  if (exagValEl) exagValEl.textContent = `${activeConfig.exaggeration.toFixed(1)}x`;
  if (btnTerrainSync) btnTerrainSync.classList.toggle('active', activeConfig.syncCamera);
  syncExpandButtonUI();

  if (!terrainPopup) return;
  terrainPopup.querySelectorAll('[data-terrain-layout]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.terrainLayout === activeConfig.viewMode);
  });
  terrainPopup.querySelectorAll('[data-terrain-radius]').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.terrainRadius) === activeConfig.radiusKm);
  });
  terrainPopup.querySelectorAll('[data-terrain-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.terrainMode === activeConfig.shadingMode);
  });
}

export function openTerrainComparison({ viewMode, site, earthSite, targetSite, radiusKm } = {}) {
  if (!terrainPopup) return;

  if (viewMode === 'single' && site) {
    activeConfig.viewMode = 'single';
    const body = String(site.planet || 'earth').toLowerCase();
    activeConfig.singlePlanet = body === 'moon' ? 'moon' : (body === 'mars' ? 'mars' : 'earth');
    if (activeConfig.singlePlanet === 'earth') {
      activeConfig.earthSite = {
        name: site.name || 'Earth Point',
        lat: Number(site.lat),
        lon: Number(site.lon),
        features: site.features
      };
    } else {
      activeConfig.targetSite = {
        name: site.name || (activeConfig.singlePlanet === 'moon' ? 'Moon Point' : 'Mars Point'),
        planet: activeConfig.singlePlanet,
        lat: Number(site.lat),
        lon: Number(site.lon),
        features: site.features
      };
    }
    if (radiusKm) activeConfig.radiusKm = Number(radiusKm);
  } else if (earthSite && targetSite) {
    activeConfig.viewMode = 'compare';
    activeConfig.earthSite = {
      name: earthSite.name || earthSite.micro_site_name || 'Earth Analog',
      lat: Number(earthSite.lat),
      lon: Number(earthSite.lon),
      features: earthSite.features
    };
    activeConfig.targetSite = {
      name: targetSite.name || targetSite.target_name || 'Planetary Target',
      planet: String(targetSite.planet || 'moon').toLowerCase() === 'mars' ? 'mars' : 'moon',
      lat: Number(targetSite.lat),
      lon: Number(targetSite.lon),
      features: targetSite.features
    };
    if (radiusKm) activeConfig.radiusKm = Number(radiusKm);
  } else {
    activeConfig.viewMode = 'compare';
    const resolved = resolveDefaultPairFromState();
    activeConfig.earthSite = resolved.earthSite;
    activeConfig.targetSite = resolved.targetSite;
    activeConfig.radiusKm = resolved.radiusKm;
  }

  terrainPopup.hidden = false;
  if (btnTerrainMenu) btnTerrainMenu.classList.add('active');
  toggleToolsMenu(false);
  bringWindowToFront(terrainPopup);
  syncLayoutUI();
  clampWindowToViewport(terrainPopup);
  syncToolbarChips();

  requestAnimationFrame(() => {
    ensureViewports();
    startRenderLoop();
    loadAndRender();
  });
}

export function toggleTerrainPopup(forceOpen) {
  if (!terrainPopup) return;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : terrainPopup.hidden;
  if (nextOpen) {
    openTerrainComparison();
  } else {
    terrainPopup.hidden = true;
    if (btnTerrainMenu) btnTerrainMenu.classList.remove('active');
  }
}

export function initTerrainComparatorPanel() {
  terrainPopup = document.getElementById('terrain-popup');
  subtitleEl = document.getElementById('terrain-subtitle');
  btnTerrainMenu = document.getElementById('btn-terrain-menu');
  btnTerrainClose = document.getElementById('btn-terrain-close');
  btnTerrainExpand = document.getElementById('btn-terrain-expand');
  btnTerrainSync = document.getElementById('btn-terrain-sync');
  btnTerrainReset = document.getElementById('btn-terrain-reset');
  exagSlider = document.getElementById('terrain-exag-slider');
  exagValEl = document.getElementById('terrain-exag-val');

  earthPane = document.getElementById('terrain-earth-pane');
  earthTitleEl = document.getElementById('terrain-earth-title');
  earthCoordsEl = document.getElementById('terrain-earth-coords');
  earthCanvasWrap = document.getElementById('terrain-earth-canvas');
  earthStatusEl = document.getElementById('terrain-earth-status');
  earthStatsEl = document.getElementById('terrain-earth-stats');
  earthSourceEl = document.getElementById('terrain-earth-source');

  targetPane = document.getElementById('terrain-target-pane');
  targetHeaderTitleEl = document.getElementById('terrain-target-title');
  targetCoordsEl = document.getElementById('terrain-target-coords');
  targetCanvasWrap = document.getElementById('terrain-target-canvas');
  targetStatusEl = document.getElementById('terrain-target-status');
  targetStatsEl = document.getElementById('terrain-target-stats');
  targetSourceEl = document.getElementById('terrain-target-source');

  if (!terrainPopup) return;

  const headerEl = terrainPopup.querySelector('.terrain-popup-header');
  makeWindowDraggable(terrainPopup, headerEl);
  if (headerEl) {
    headerEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      toggleTerrainExpand();
    });
  }

  if (btnTerrainMenu) {
    btnTerrainMenu.addEventListener('click', () => toggleTerrainPopup());
  }
  if (btnTerrainClose) {
    btnTerrainClose.addEventListener('click', () => toggleTerrainPopup(false));
  }
  if (btnTerrainExpand) {
    btnTerrainExpand.addEventListener('click', () => toggleTerrainExpand());
  }

  if (exagSlider) {
    exagSlider.addEventListener('input', () => {
      activeConfig.exaggeration = Number(exagSlider.value) || 2.0;
      if (exagValEl) exagValEl.textContent = `${activeConfig.exaggeration.toFixed(1)}x`;
      if (earthViewport) earthViewport.setVerticalExaggeration(activeConfig.exaggeration);
      if (targetViewport) targetViewport.setVerticalExaggeration(activeConfig.exaggeration);
    });
  }

  if (btnTerrainSync) {
    btnTerrainSync.addEventListener('click', () => {
      activeConfig.syncCamera = !activeConfig.syncCamera;
      btnTerrainSync.classList.toggle('active', activeConfig.syncCamera);
    });
  }

  if (btnTerrainReset) {
    btnTerrainReset.addEventListener('click', () => {
      if (earthViewport) earthViewport.resetCamera();
      if (targetViewport) targetViewport.resetCamera();
    });
  }

  const btnRefresh = document.getElementById('btn-terrain-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadAndRender();
    });
  }

  terrainPopup.querySelectorAll('[data-terrain-layout]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextLayout = btn.dataset.terrainLayout === 'single' ? 'single' : 'compare';
      if (nextLayout === activeConfig.viewMode) return;
      activeConfig.viewMode = nextLayout;
      if (nextLayout === 'single') {
        activeConfig.singlePlanet = appState.activePlanetKey === 'earth'
          ? 'earth'
          : (activeConfig.targetSite.planet === 'moon' ? 'moon' : 'mars');
      }
      syncToolbarChips();
      loadAndRender();
    });
  });

  terrainPopup.querySelectorAll('[data-terrain-radius]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeConfig.radiusKm = Number(btn.dataset.terrainRadius) || 10;
      syncToolbarChips();
      loadAndRender();
    });
  });

  terrainPopup.querySelectorAll('[data-terrain-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeConfig.shadingMode = btn.dataset.terrainMode || 'satellite';
      syncToolbarChips();
      if (earthViewport) earthViewport.setShadingMode(activeConfig.shadingMode);
      if (targetViewport) targetViewport.setShadingMode(activeConfig.shadingMode);
    });
  });

  window.addEventListener('resize', () => {
    if (!terrainPopup.hidden) ensureViewports();
  });
}
