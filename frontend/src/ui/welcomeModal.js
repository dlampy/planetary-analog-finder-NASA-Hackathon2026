import { appState } from '../state/appState.js';
import { exitDualLinkMode, selectPlanet } from './infoPanel.js';
import { toggleToolsMenu } from './popups.js';
import { setPickedPin3D } from '../scene/markersAndArcs.js';
import { registerGlobePickCallback } from '../map2d/leafletMap.js';
import {
  registerReopenWizardCallback,
  runMissionAnalogSearch,
  toggleFinderPopup
} from '../finder/finderPanel.js';
import { loadMissionCatalogMetadata } from '../finder/finderApi.js';
import { escapeHtml } from '../finder/csvAndTopsis.js';

let welcomeOverlay = null;
let planetGridEl = null;
let missionListEl = null;
let missionSourceEl = null;
let step3PlanetEl = null;
let pickPlanetLabelEl = null;
let presetPlanetLabelEl = null;
let presetListEl = null;
let latInputEl = null;
let lonInputEl = null;
let wizardErrorEl = null;
let targetPickerHud = null;
let targetPickerLabel = null;

let catalogMissions = [];
let catalogTargets = [];
let selectedPresetId = null;

function setPickingHudVisible(visible, planetKey) {
  if (!targetPickerHud) return;
  targetPickerHud.hidden = !visible;
  if (visible && targetPickerLabel) {
    const label = planetKey === 'mars' ? 'Mars' : 'Moon';
    targetPickerLabel.textContent = `Click any point on the 3D ${label} sphere to find all matching Earth analog sites`;
  }
}

export function cancelGlobeTargetPicker(reopenWizard = false) {
  appState.missionWizardState.pickingOnGlobe = false;
  setPickingHudVisible(false);
  if (reopenWizard) openWelcomeModal();
}

export function enterGlobeTargetPickerMode(planetKey, missionId) {
  const planet = planetKey === 'mars' ? 'mars' : 'moon';
  appState.missionWizardState.planet = planet;
  if (missionId) appState.missionWizardState.missionId = missionId;

  closeWelcomeModal();
  toggleFinderPopup(false);
  toggleToolsMenu(false);

  if (appState.dualLinkState.active) {
    exitDualLinkMode(planet);
  } else {
    selectPlanet(planet);
  }

  appState.missionWizardState.pickingOnGlobe = true;
  setPickingHudVisible(true, planet);
}

export function openWelcomeModal() {
  if (!welcomeOverlay) return;
  cancelGlobeTargetPicker(false);
  welcomeOverlay.hidden = false;
  syncStep1UI();
  renderPresetTargets();
  if (!catalogMissions.length) {
    loadAndRenderWizardCatalog();
  }
}

export function closeWelcomeModal() {
  if (!welcomeOverlay) return;
  welcomeOverlay.hidden = true;
}

function syncStep1UI() {
  const planet = appState.missionWizardState.planet === 'mars' ? 'mars' : 'moon';
  const label = planet === 'mars' ? 'Mars' : 'Moon';
  if (planetGridEl) {
    planetGridEl.querySelectorAll('.welcome-planet-card').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.wizardPlanet === planet);
    });
  }
  if (step3PlanetEl) step3PlanetEl.textContent = label;
  if (pickPlanetLabelEl) pickPlanetLabelEl.textContent = label;
  if (presetPlanetLabelEl) presetPlanetLabelEl.textContent = label;
}

function renderMissions() {
  if (!missionListEl) return;
  if (!catalogMissions.length) {
    missionListEl.innerHTML = '<div style="font-size:11.5px;color:#94a3b8">No missions found in missions.csv</div>';
    return;
  }

  if (!catalogMissions.some(m => m.mission_id === appState.missionWizardState.missionId)) {
    appState.missionWizardState.missionId = catalogMissions[0].mission_id;
  }

  const fpNames = {
    circle_5km: '5 km Rover Radius',
    square_1km: '1×1 km ISRU Grid',
    circle_500m: '500 m Habitat Radius'
  };

  missionListEl.innerHTML = catalogMissions.map(m => {
    const isActive = m.mission_id === appState.missionWizardState.missionId;
    const w = m.weights || {};
    return `
      <button type="button" class="welcome-mission-card ${isActive ? 'active' : ''}" data-mission-id="${escapeHtml(m.mission_id)}">
        <div class="welcome-mission-title">${escapeHtml(m.mission_type)}</div>
        <div class="welcome-mission-tech">${escapeHtml(m.technology_to_test || '')}</div>
        <div class="welcome-mission-badges">
          <span class="welcome-weight-chip">${escapeHtml(fpNames[m.footprint_mode] || m.footprint_mode)}</span>
          <span class="welcome-weight-chip">Slope ${((w.slope_deg || 0) * 100).toFixed(0)}%</span>
          <span class="welcome-weight-chip">Ice ${((w.aridity_ice_idx || 0) * 100).toFixed(0)}%</span>
          <span class="welcome-weight-chip">Void ${((w.has_subsurface_void || 0) * 100).toFixed(0)}%</span>
        </div>
      </button>
    `;
  }).join('');

  missionListEl.querySelectorAll('.welcome-mission-card').forEach(btn => {
    btn.addEventListener('click', () => {
      appState.missionWizardState.missionId = btn.dataset.missionId;
      missionListEl.querySelectorAll('.welcome-mission-card').forEach(el => {
        el.classList.toggle('active', el === btn);
      });
    });
  });
}

function renderPresetTargets() {
  if (!presetListEl) return;
  const planet = appState.missionWizardState.planet === 'mars' ? 'mars' : 'moon';
  const filtered = catalogTargets.filter(t => String(t.planet).toLowerCase() === planet);

  if (!filtered.length) {
    presetListEl.innerHTML = `<span style="font-size:11px;color:#94a3b8">Enter coordinates below or click anywhere on 3D ${planet === 'mars' ? 'Mars' : 'Moon'}.</span>`;
    return;
  }

  if (!selectedPresetId || !filtered.some(t => t.target_id === selectedPresetId)) {
    const first = filtered[0];
    selectedPresetId = first.target_id;
    if (latInputEl) latInputEl.value = Number(first.lat).toFixed(2);
    if (lonInputEl) lonInputEl.value = Number(first.lon).toFixed(2);
  }

  presetListEl.innerHTML = filtered.map(t => `
    <button type="button" class="welcome-preset-chip ${t.target_id === selectedPresetId ? 'active' : ''}" data-target-id="${escapeHtml(t.target_id)}">
      ${escapeHtml(t.target_name)} (${Number(t.lat).toFixed(2)}°, ${Number(t.lon).toFixed(2)}°)
    </button>
  `).join('');

  presetListEl.querySelectorAll('.welcome-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const target = filtered.find(t => t.target_id === chip.dataset.targetId);
      if (!target) return;
      selectedPresetId = target.target_id;
      if (latInputEl) latInputEl.value = Number(target.lat).toFixed(2);
      if (lonInputEl) lonInputEl.value = Number(target.lon).toFixed(2);
      if (wizardErrorEl) wizardErrorEl.hidden = true;
      presetListEl.querySelectorAll('.welcome-preset-chip').forEach(c => {
        c.classList.toggle('active', c === chip);
      });
    });
  });
}

async function loadAndRenderWizardCatalog() {
  try {
    const catalog = await loadMissionCatalogMetadata();
    catalogMissions = catalog.missions || [];
    catalogTargets = catalog.targets || [];
    if (missionSourceEl) {
      missionSourceEl.textContent = catalog.source === 'backend'
        ? `Live backend · ${catalogMissions.length} missions (missions.csv)`
        : `missions.csv · ${catalogMissions.length} mission types`;
    }
    renderMissions();
    renderPresetTargets();
  } catch (err) {
    console.warn('Unable to load mission catalog:', err);
    if (missionSourceEl) missionSourceEl.textContent = 'missions.csv unavailable';
  }
}

export function initWelcomeModal() {
  welcomeOverlay = document.getElementById('welcome-overlay');
  planetGridEl = document.getElementById('welcome-planet-grid');
  missionListEl = document.getElementById('welcome-mission-list');
  missionSourceEl = document.getElementById('welcome-mission-source');
  step3PlanetEl = document.getElementById('welcome-step3-planet');
  pickPlanetLabelEl = document.getElementById('welcome-pick-planet-label');
  presetPlanetLabelEl = document.getElementById('welcome-preset-planet-label');
  presetListEl = document.getElementById('welcome-preset-list');
  latInputEl = document.getElementById('wizard-lat-input');
  lonInputEl = document.getElementById('wizard-lon-input');
  wizardErrorEl = document.getElementById('wizard-error');
  targetPickerHud = document.getElementById('target-picker-hud');
  targetPickerLabel = document.getElementById('target-picker-label');

  if (!welcomeOverlay) return;

  if (planetGridEl) {
    planetGridEl.querySelectorAll('.welcome-planet-card').forEach(card => {
      card.addEventListener('click', () => {
        appState.missionWizardState.planet = card.dataset.wizardPlanet === 'mars' ? 'mars' : 'moon';
        selectedPresetId = null;
        if (wizardErrorEl) wizardErrorEl.hidden = true;
        syncStep1UI();
        renderPresetTargets();
      });
    });
  }

  [latInputEl, lonInputEl].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('input', () => {
      selectedPresetId = null;
      if (presetListEl) {
        presetListEl.querySelectorAll('.welcome-preset-chip').forEach(c => c.classList.remove('active'));
      }
      if (wizardErrorEl) wizardErrorEl.hidden = true;
    });
  });

  const btnPickGlobe = document.getElementById('btn-wizard-pick-globe');
  if (btnPickGlobe) {
    btnPickGlobe.addEventListener('click', () => {
      enterGlobeTargetPickerMode(appState.missionWizardState.planet, appState.missionWizardState.missionId);
    });
  }

  const btnPickerCancel = document.getElementById('btn-picker-cancel');
  if (btnPickerCancel) {
    btnPickerCancel.addEventListener('click', () => cancelGlobeTargetPicker(true));
  }

  const btnWizardFind = document.getElementById('btn-wizard-find');
  if (btnWizardFind) {
    btnWizardFind.addEventListener('click', async () => {
      const lat = Number(latInputEl ? latInputEl.value : NaN);
      const lon = Number(lonInputEl ? lonInputEl.value : NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        if (wizardErrorEl) {
          wizardErrorEl.hidden = false;
          wizardErrorEl.textContent = 'Invalid coordinates. Enter Lat between -90 and 90, Lon between -180 and 180.';
        }
        return;
      }

      const planet = appState.missionWizardState.planet;
      const missionId = appState.missionWizardState.missionId;
      const presetMatch = selectedPresetId ? catalogTargets.find(t => t.target_id === selectedPresetId) : null;
      closeWelcomeModal();
      setPickedPin3D(planet, lat, lon, planet === 'moon' ? 0xfacc15 : 0xfb7185);
      await runMissionAnalogSearch({
        targetBody: planet,
        lat,
        lon,
        label: presetMatch ? presetMatch.target_name : null,
        missionId,
        targetId: presetMatch ? presetMatch.target_id : null
      });
    });
  }

  registerGlobePickCallback(async ({ planet, lat, lon }) => {
    appState.missionWizardState.pickingOnGlobe = false;
    setPickingHudVisible(false);
    selectedPresetId = null;
    if (latInputEl) latInputEl.value = lat.toFixed(2);
    if (lonInputEl) lonInputEl.value = lon.toFixed(2);
    await runMissionAnalogSearch({
      targetBody: planet,
      lat,
      lon,
      missionId: appState.missionWizardState.missionId
    });
  });

  registerReopenWizardCallback(() => openWelcomeModal());

  const btnClose = document.getElementById('btn-welcome-close');
  const btnExplore = document.getElementById('btn-welcome-explore');
  const btnFinder = document.getElementById('btn-welcome-finder');
  const btnWelcomeMenu = document.getElementById('btn-welcome-menu');
  const btnMissionWizardMenu = document.getElementById('btn-mission-wizard-menu');

  if (btnClose) btnClose.addEventListener('click', () => closeWelcomeModal());
  if (btnExplore) btnExplore.addEventListener('click', () => closeWelcomeModal());
  if (btnFinder) {
    btnFinder.addEventListener('click', () => {
      closeWelcomeModal();
      toggleFinderPopup(true);
    });
  }
  if (btnWelcomeMenu) {
    btnWelcomeMenu.addEventListener('click', () => {
      toggleToolsMenu(false);
      openWelcomeModal();
    });
  }
  if (btnMissionWizardMenu) {
    btnMissionWizardMenu.addEventListener('click', () => {
      toggleToolsMenu(false);
      openWelcomeModal();
    });
  }

  welcomeOverlay.addEventListener('click', (e) => {
    if (e.target === welcomeOverlay) {
      closeWelcomeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (appState.missionWizardState.pickingOnGlobe) {
        cancelGlobeTargetPicker(false);
      } else if (!welcomeOverlay.hidden) {
        closeWelcomeModal();
      }
    }
  });

  loadAndRenderWizardCatalog();
}
