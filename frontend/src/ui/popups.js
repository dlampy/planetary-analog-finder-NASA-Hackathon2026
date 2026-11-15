import { appState } from '../state/appState.js';
import { clearCustomPins, parseGpsInput } from '../scene/markersAndArcs.js';
import { applyAnalogLink, exitDualLinkMode } from './infoPanel.js';
import { openTerrainComparison } from '../terrain/terrainComparatorPanel.js';
import { bringWindowToFront, clampWindowToViewport, makeWindowDraggable } from './windowManager.js';

let rightToolsWrap = null;
let btnToolsMenu = null;
let toolsMenu = null;
let geNavEl = null;

let leftColumnEl = null;
let btnLeftHide = null;
let btnToggleLeftPanel = null;
let showLeftPanel = true;

let btnGpsMenu = null;
let gpsPopup = null;
let gpsEarthInput = null;
let gpsTargetPlanet = null;
let gpsTargetInput = null;
let gpsError = null;

let btnResourcesMenu = null;
let resourcesPopup = null;

export function toggleLeftPanel(forceShow) {
  showLeftPanel = typeof forceShow === 'boolean' ? forceShow : !showLeftPanel;
  if (leftColumnEl) leftColumnEl.classList.toggle('collapsed', !showLeftPanel);
  if (btnToggleLeftPanel) btnToggleLeftPanel.classList.toggle('active', showLeftPanel);
  try {
    localStorage.setItem('nasa3d_show_left_panel', showLeftPanel ? '1' : '0');
  } catch (_) {}
}

export function toggleToolsMenu(forceOpen) {
  if (!toolsMenu || !btnToolsMenu) return;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : toolsMenu.hidden;
  toolsMenu.hidden = !nextOpen;
  btnToolsMenu.classList.toggle('active', nextOpen);
  btnToolsMenu.setAttribute('aria-expanded', String(nextOpen));
  btnToolsMenu.textContent = 'Tools';
  if (geNavEl) {
    geNavEl.classList.toggle('is-hidden-by-tools', nextOpen);
    geNavEl.setAttribute('aria-hidden', String(nextOpen));
  }
}

export function toggleGpsPopup(forceOpen) {
  if (!gpsPopup) return;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : gpsPopup.hidden;
  gpsPopup.hidden = !nextOpen;
  if (btnGpsMenu) btnGpsMenu.classList.toggle('active', nextOpen);
  if (gpsError) gpsError.hidden = true;
  if (nextOpen) {
    toggleToolsMenu(false);
    bringWindowToFront(gpsPopup);
    clampWindowToViewport(gpsPopup);
  }
}

export function toggleResourcesPopup(forceOpen) {
  if (!resourcesPopup) return;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : resourcesPopup.hidden;
  resourcesPopup.hidden = !nextOpen;
  if (btnResourcesMenu) btnResourcesMenu.classList.toggle('active', nextOpen);
  if (nextOpen) {
    toggleToolsMenu(false);
    bringWindowToFront(resourcesPopup);
    clampWindowToViewport(resourcesPopup);
  }
}

export function setGpsInputs({ earthCoordText, targetPlanet, targetCoordText } = {}) {
  if (earthCoordText !== undefined && gpsEarthInput) {
    gpsEarthInput.value = earthCoordText;
  }
  if (targetPlanet !== undefined && gpsTargetPlanet) {
    gpsTargetPlanet.value = targetPlanet === 'moon' ? 'moon' : 'mars';
  }
  if (targetCoordText !== undefined && gpsTargetInput) {
    gpsTargetInput.value = targetCoordText;
  }
}

export function populateGpsFrom2DMap(planetKey, lat, lon) {
  const coordText = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  if (planetKey === 'earth') {
    setGpsInputs({ earthCoordText: coordText });
  } else {
    setGpsInputs({ targetPlanet: planetKey === 'moon' ? 'moon' : 'mars', targetCoordText: coordText });
  }
  toggleGpsPopup(true);
}

export function initPopups() {
  rightToolsWrap = document.getElementById('right-tools-wrap');
  btnToolsMenu = document.getElementById('btn-tools-menu');
  toolsMenu = document.getElementById('tools-menu');
  geNavEl = document.getElementById('ge-nav');

  leftColumnEl = document.getElementById('left-column');
  btnLeftHide = document.getElementById('btn-left-hide');
  btnToggleLeftPanel = document.getElementById('btn-toggle-left-panel');

  try {
    showLeftPanel = localStorage.getItem('nasa3d_show_left_panel') !== '0';
  } catch (_) {
    showLeftPanel = true;
  }
  toggleLeftPanel(showLeftPanel);
  if (btnLeftHide) btnLeftHide.addEventListener('click', () => toggleLeftPanel(false));
  if (btnToggleLeftPanel) btnToggleLeftPanel.addEventListener('click', () => toggleLeftPanel());

  if (btnToolsMenu && toolsMenu) {
    btnToolsMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleToolsMenu();
    });

    document.addEventListener('click', (e) => {
      if (!toolsMenu.hidden && rightToolsWrap && !rightToolsWrap.contains(e.target)) {
        toggleToolsMenu(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !toolsMenu.hidden) {
        toggleToolsMenu(false);
      }
    });
  }

  btnGpsMenu = document.getElementById('btn-gps-menu');
  gpsPopup = document.getElementById('gps-popup');
  gpsEarthInput = document.getElementById('gps-earth-input');
  gpsTargetPlanet = document.getElementById('gps-target-planet');
  gpsTargetInput = document.getElementById('gps-target-input');
  gpsError = document.getElementById('gps-error');

  btnResourcesMenu = document.getElementById('btn-resources-menu');
  resourcesPopup = document.getElementById('resources-popup');

  makeWindowDraggable(gpsPopup, gpsPopup.querySelector('.gps-popup-header'));
  makeWindowDraggable(resourcesPopup, resourcesPopup.querySelector('.resources-popup-header'));

  btnResourcesMenu.addEventListener('click', () => toggleResourcesPopup());
  document.getElementById('btn-resources-close').addEventListener('click', () => toggleResourcesPopup(false));

  btnGpsMenu.addEventListener('click', () => toggleGpsPopup());
  document.getElementById('btn-gps-close').addEventListener('click', () => toggleGpsPopup(false));

  document.querySelectorAll('.gps-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      gpsEarthInput.value = chip.dataset.earth;
      gpsTargetPlanet.value = chip.dataset.planet;
      gpsTargetInput.value = chip.dataset.dest;
      gpsError.hidden = true;
    });
  });

  const readValidatedGpsPair = () => {
    const eCoord = parseGpsInput(gpsEarthInput.value);
    const tCoord = parseGpsInput(gpsTargetInput.value);
    if (!eCoord || !tCoord) {
      gpsError.hidden = false;
      gpsError.textContent = 'Invalid coordinates. Enter as "lat, lon" (Lat: -90..90, Lon: -180..180).';
      return null;
    }
    gpsError.hidden = true;
    const planet = gpsTargetPlanet.value === 'moon' ? 'moon' : 'mars';
    return { eCoord, tCoord, planet };
  };

  document.getElementById('btn-gps-link').addEventListener('click', () => {
    const pair = readValidatedGpsPair();
    if (!pair) return;
    applyAnalogLink({
      earthLat: pair.eCoord.lat,
      earthLon: pair.eCoord.lon,
      targetPlanet: pair.planet,
      targetLat: pair.tCoord.lat,
      targetLon: pair.tCoord.lon,
      pairSource: 'dual'
    });
    toggleGpsPopup(false);
  });

  const btnGpsTerrain = document.getElementById('btn-gps-terrain');
  if (btnGpsTerrain) {
    btnGpsTerrain.addEventListener('click', () => {
      const pair = readValidatedGpsPair();
      if (!pair) return;
      const planetLabel = pair.planet === 'moon' ? 'Moon' : 'Mars';
      applyAnalogLink({
        earthLat: pair.eCoord.lat,
        earthLon: pair.eCoord.lon,
        targetPlanet: pair.planet,
        targetLat: pair.tCoord.lat,
        targetLon: pair.tCoord.lon,
        pairSource: 'dual'
      });
      toggleGpsPopup(false);
      openTerrainComparison({
        viewMode: 'compare',
        earthSite: { name: 'GPS 1 (Earth)', lat: pair.eCoord.lat, lon: pair.eCoord.lon },
        targetSite: { name: `GPS 2 (${planetLabel})`, planet: pair.planet, lat: pair.tCoord.lat, lon: pair.tCoord.lon },
        radiusKm: 10
      });
    });
  }

  const btnDualTerrain = document.getElementById('btn-dual-terrain');
  if (btnDualTerrain) {
    btnDualTerrain.addEventListener('click', () => {
      const { dualLinkState } = appState;
      const planet = dualLinkState.targetPlanet === 'moon' ? 'moon' : 'mars';
      const planetLabel = planet === 'moon' ? 'Moon' : 'Mars';
      openTerrainComparison({
        viewMode: 'compare',
        earthSite: { name: 'Dual Link (Earth)', lat: dualLinkState.earthLat, lon: dualLinkState.earthLon },
        targetSite: { name: `Dual Link (${planetLabel})`, planet, lat: dualLinkState.targetLat, lon: dualLinkState.targetLon },
        radiusKm: 10
      });
    });
  }

  document.getElementById('btn-gps-clear').addEventListener('click', () => {
    clearCustomPins();
    exitDualLinkMode('earth');
    toggleGpsPopup(false);
  });
}
