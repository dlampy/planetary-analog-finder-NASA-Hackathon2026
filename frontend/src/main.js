import { appState } from './state/appState.js';
import { initThreeScene } from './scene/threeScene.js';
import { buildPlanet, initLocalTexturePicker, initMarkerHoverTooltip } from './scene/planetBuilder.js';
import { initLinkGroup, parseGpsInput, updateDualLinkPulses } from './scene/markersAndArcs.js';
import { initGoogleEarthNav, updateGoogleEarthNav } from './scene/geNavigation.js';
import { applyAnalogLink, applyAxisMode, initControlsAndDock, selectPlanet, updateInfoPanel } from './ui/infoPanel.js';
import { initPopups, setGpsInputs } from './ui/popups.js';
import { clampAllFloatingWindows } from './ui/windowManager.js';
import { initMap2DAndRaycaster } from './map2d/leafletMap.js';
import { initFinderPanel } from './finder/finderPanel.js';
import {
  focusRecommendedPlace,
  initWelcomeModal,
  openWelcomeModal,
  shouldAutoShowWelcome
} from './ui/welcomeModal.js';

function bootstrap() {
  const overlay = document.getElementById('status-overlay');
  const statusText = document.getElementById('status-text');

  if (typeof THREE === 'undefined') {
    if (statusText) {
      statusText.textContent = 'Unable to load Three.js library. Please check your internet connection.';
    }
    return;
  }

  const threeCtx = initThreeScene(statusText);
  if (!threeCtx) return;

  initLinkGroup(threeCtx.scene);
  initControlsAndDock();
  initPopups();
  initFinderPanel();
  initWelcomeModal();
  initLocalTexturePicker(updateInfoPanel);
  initMarkerHoverTooltip();
  initMap2DAndRaycaster();
  initGoogleEarthNav({ applyAxisMode });

  // ==========================================
  // 6. INITIALIZATION & RENDER LOOP
  // ==========================================
  async function init() {
    const { planetModels } = appState;
    try {
      // Load Earth first for immediate display, then preload Moon & Mars (8K textures)
      planetModels.earth = await buildPlanet('earth');
      planetModels.earth.visible = false;
      threeCtx.scene.add(planetModels.earth);

      selectPlanet('earth');
      if (overlay) overlay.classList.add('hidden');

      const params = new URLSearchParams(window.location.search);
      const hasUrlLink = params.has('earth') && params.has('dest');
      if (!hasUrlLink && shouldAutoShowWelcome()) {
        openWelcomeModal();
      }

      const [moon, mars] = await Promise.all([
        buildPlanet('moon'),
        buildPlanet('mars')
      ]);
      planetModels.moon = moon;
      planetModels.mars = mars;
      [moon, mars].forEach(m => {
        m.visible = (appState.activePlanetKey === (m === moon ? 'moon' : 'mars'));
        const surface = m.getObjectByName('surface');
        const markers = surface && surface.getObjectByName('markers');
        if (markers) markers.visible = appState.showMarkers;
        threeCtx.scene.add(m);
      });

      // Support passing dual GPS coordinates via URL (?earth=-24.5,-69.2&target=mars&dest=18.38,77.58)
      if (hasUrlLink) {
        const e = parseGpsInput(params.get('earth'));
        const t = parseGpsInput(params.get('dest'));
        const p = params.get('target') === 'moon' ? 'moon' : 'mars';
        if (e && t) {
          setGpsInputs({
            earthCoordText: `${e.lat}, ${e.lon}`,
            targetPlanet: p,
            targetCoordText: `${t.lat}, ${t.lon}`
          });
          applyAnalogLink({ earthLat: e.lat, earthLon: e.lon, targetPlanet: p, targetLat: t.lat, targetLon: t.lon });
          return;
        }
      }

      if (appState.pendingLinkArgs) {
        applyAnalogLink(appState.pendingLinkArgs);
      } else if (appState.pendingWelcomePlace) {
        focusRecommendedPlace(appState.pendingWelcomePlace);
      } else {
        updateInfoPanel(appState.activePlanetKey);
      }
    } catch (err) {
      if (statusText) {
        statusText.textContent = '3D initialization error: ' + (err && err.message ? err.message : err);
      }
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = threeCtx.clock.getDelta();
    const elapsed = threeCtx.clock.elapsedTime;

    updateGoogleEarthNav(dt);

    const { dualLinkState, planetModels, activePlanetKey } = appState;
    if (!dualLinkState.active && appState.transitionProgress < 1 && planetModels[activePlanetKey]) {
      appState.transitionProgress = Math.min(1, appState.transitionProgress + dt * 3.2);
      const ease = 1 - Math.pow(1 - appState.transitionProgress, 3);
      planetModels[activePlanetKey].scale.setScalar(0.58 + 0.42 * ease);
    }

    if (dualLinkState.active) {
      updateDualLinkPulses(elapsed);
    }

    if (planetModels.earth && planetModels.earth.visible) {
      const clouds = planetModels.earth.getObjectByName('clouds');
      if (clouds) clouds.rotation.y += dt * 0.055;
    }

    const starField = threeCtx.scene.getObjectByName('starfield');
    if (starField) starField.rotation.y += dt * 0.005;

    threeCtx.controls.update();
    threeCtx.renderer.render(threeCtx.scene, threeCtx.camera);
  }

  window.addEventListener('resize', () => {
    threeCtx.camera.aspect = window.innerWidth / window.innerHeight;
    threeCtx.camera.updateProjectionMatrix();
    threeCtx.renderer.setSize(window.innerWidth, window.innerHeight);
    clampAllFloatingWindows();
  });

  init();
  animate();
}

bootstrap();
