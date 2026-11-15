import { clearCustomPins, parseGpsInput } from '../scene/markersAndArcs.js';
import { applyAnalogLink, exitDualLinkMode } from './infoPanel.js';
import { bringWindowToFront, clampWindowToViewport, makeWindowDraggable } from './windowManager.js';

let rightSettingsWrap = null;
let btnSettingsMenu = null;
let settingsMenu = null;
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

export function toggleSettingsMenu(forceOpen) {
  if (!settingsMenu || !btnSettingsMenu) return;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : settingsMenu.hidden;
  settingsMenu.hidden = !nextOpen;
  btnSettingsMenu.classList.toggle('active', nextOpen);
  btnSettingsMenu.setAttribute('aria-expanded', String(nextOpen));
  btnSettingsMenu.textContent = nextOpen ? '⚙️ Settings ▴' : '⚙️ Settings ▾';
  if (geNavEl) {
    geNavEl.classList.toggle('is-hidden-by-settings', nextOpen);
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
    toggleSettingsMenu(false);
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
    toggleSettingsMenu(false);
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
  rightSettingsWrap = document.getElementById('right-settings-wrap');
  btnSettingsMenu = document.getElementById('btn-settings-menu');
  settingsMenu = document.getElementById('settings-menu');
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

  if (btnSettingsMenu && settingsMenu) {
    btnSettingsMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSettingsMenu();
    });

    document.addEventListener('click', (e) => {
      if (!settingsMenu.hidden && rightSettingsWrap && !rightSettingsWrap.contains(e.target)) {
        toggleSettingsMenu(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !settingsMenu.hidden) {
        toggleSettingsMenu(false);
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

  document.getElementById('btn-gps-link').addEventListener('click', () => {
    const eCoord = parseGpsInput(gpsEarthInput.value);
    const tCoord = parseGpsInput(gpsTargetInput.value);
    if (!eCoord || !tCoord) {
      gpsError.hidden = false;
      gpsError.textContent = 'Invalid coordinates. Enter as "lat, lon" (Lat: -90..90, Lon: -180..180).';
      return;
    }
    gpsError.hidden = true;
    applyAnalogLink({
      earthLat: eCoord.lat,
      earthLon: eCoord.lon,
      targetPlanet: gpsTargetPlanet.value,
      targetLat: tCoord.lat,
      targetLon: tCoord.lon
    });
    toggleGpsPopup(false);
  });

  document.getElementById('btn-gps-clear').addEventListener('click', () => {
    clearCustomPins();
    exitDualLinkMode('earth');
    toggleGpsPopup(false);
  });
}
