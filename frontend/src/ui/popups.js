import { clearCustomPins, parseGpsInput } from '../scene/markersAndArcs.js';
import { applyAnalogLink, exitDualLinkMode } from './infoPanel.js';
import { bringWindowToFront, clampWindowToViewport, makeWindowDraggable } from './windowManager.js';

let btnGpsMenu = null;
let gpsPopup = null;
let gpsEarthInput = null;
let gpsTargetPlanet = null;
let gpsTargetInput = null;
let gpsError = null;

let btnResourcesMenu = null;
let resourcesPopup = null;

export function toggleGpsPopup(forceOpen) {
  if (!gpsPopup) return;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : gpsPopup.hidden;
  gpsPopup.hidden = !nextOpen;
  if (btnGpsMenu) btnGpsMenu.classList.toggle('active', nextOpen);
  if (gpsError) gpsError.hidden = true;
  if (nextOpen) {
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
      gpsError.textContent = 'Tọa độ chưa hợp lệ. Hãy nhập dạng "lat, lon" (Lat: -90..90, Lon: -180..180).';
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
