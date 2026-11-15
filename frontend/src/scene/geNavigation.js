import { appState } from '../state/appState.js';
import { threeCtx } from './threeScene.js';

// ==========================================
// 5C. CỤM ĐIỀU HƯỚNG KIỂU GOOGLE EARTH
// ==========================================
let geCompassRing = null;
let geNorthBtn = null;
let geZoomTrack = null;
let geZoomThumb = null;
let geDpadCenter = null;

let activeGeAction = null;
let isDraggingZoom = false;
const northTween = { active: false, targetTheta: 0, targetPhi: 1.42 };

function getCameraSpherical() {
  const { camera, controls } = threeCtx;
  const offset = camera.position.clone().sub(controls.target);
  return new THREE.Spherical().setFromVector3(offset);
}

function applyCameraSpherical(spherical) {
  const { camera, controls } = threeCtx;
  spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.06, Math.PI - 0.06);
  spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
  const offset = new THREE.Vector3().setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
  camera.up.set(0, 1, 0);
  controls.update();
}

export function initGoogleEarthNav({ applyAxisMode } = {}) {
  const { controls } = threeCtx;

  geCompassRing = document.getElementById('ge-compass-ring');
  geNorthBtn = document.getElementById('ge-north-btn');
  geZoomTrack = document.getElementById('ge-zoom-track');
  geZoomThumb = document.getElementById('ge-zoom-thumb');
  geDpadCenter = document.getElementById('ge-dpad-center');

  function resetNorthAndAxis() {
    appState.isUprightAxis = true;
    try {
      localStorage.setItem('dlt_axis_upright', 'true');
    } catch (_) {}
    const btnUprightAxis = document.getElementById('btn-upright-axis');
    if (btnUprightAxis) btnUprightAxis.classList.add('active');
    if (applyAxisMode) applyAxisMode();
    northTween.targetTheta = 0;
    northTween.targetPhi = appState.dualLinkState.active ? 1.51 : 1.42;
    northTween.active = true;
  }

  controls.addEventListener('start', () => {
    northTween.active = false;
  });

  document.querySelectorAll('[data-ge-action]').forEach(btn => {
    const action = btn.dataset.geAction;
    const startHold = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      northTween.active = false;
      activeGeAction = action;
    };
    const stopHold = () => {
      if (activeGeAction === action) activeGeAction = null;
    };
    btn.addEventListener('pointerdown', startHold);
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);
  });

  if (geDpadCenter) {
    geDpadCenter.addEventListener('click', () => {
      northTween.active = false;
      const btnReset = document.getElementById('btn-reset');
      if (btnReset) btnReset.click();
    });
  }

  if (geCompassRing) {
    geCompassRing.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      northTween.active = false;

      const rect = geCompassRing.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let lastAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
      const startX = e.clientX;
      const startY = e.clientY;
      const startedOnNorth = (e.target === geNorthBtn || (geNorthBtn && geNorthBtn.contains(e.target)));
      let moved = false;
      const pointerId = e.pointerId;
      geCompassRing.setPointerCapture(pointerId);

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) moved = true;
        if (!moved) return;
        const curAngle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
        let delta = curAngle - lastAngle;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        lastAngle = curAngle;

        const sp = getCameraSpherical();
        sp.theta += delta;
        applyCameraSpherical(sp);
      }

      function onEnd(ev) {
        if (ev.pointerId !== pointerId) return;
        if (geCompassRing.hasPointerCapture(pointerId)) {
          geCompassRing.releasePointerCapture(pointerId);
        }
        geCompassRing.removeEventListener('pointermove', onMove);
        geCompassRing.removeEventListener('pointerup', onEnd);
        geCompassRing.removeEventListener('pointercancel', onEnd);

        if (!moved && startedOnNorth) {
          resetNorthAndAxis();
        }
      }

      geCompassRing.addEventListener('pointermove', onMove);
      geCompassRing.addEventListener('pointerup', onEnd);
      geCompassRing.addEventListener('pointercancel', onEnd);
    });
  }

  function setZoomFromTrackY(clientY) {
    if (!geZoomTrack) return;
    const rect = geZoomTrack.getBoundingClientRect();
    const pct = THREE.MathUtils.clamp((clientY - rect.top) / rect.height, 0, 1);
    const sp = getCameraSpherical();
    sp.radius = controls.minDistance * Math.pow(controls.maxDistance / controls.minDistance, pct);
    applyCameraSpherical(sp);
    if (geZoomThumb) geZoomThumb.style.top = (pct * 100) + '%';
  }

  if (geZoomTrack) {
    geZoomTrack.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      northTween.active = false;
      isDraggingZoom = true;
      const pointerId = e.pointerId;
      geZoomTrack.setPointerCapture(pointerId);
      setZoomFromTrackY(e.clientY);

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        setZoomFromTrackY(ev.clientY);
      }

      function onEnd(ev) {
        if (ev.pointerId !== pointerId) return;
        isDraggingZoom = false;
        if (geZoomTrack.hasPointerCapture(pointerId)) {
          geZoomTrack.releasePointerCapture(pointerId);
        }
        geZoomTrack.removeEventListener('pointermove', onMove);
        geZoomTrack.removeEventListener('pointerup', onEnd);
        geZoomTrack.removeEventListener('pointercancel', onEnd);
      }

      geZoomTrack.addEventListener('pointermove', onMove);
      geZoomTrack.addEventListener('pointerup', onEnd);
      geZoomTrack.addEventListener('pointercancel', onEnd);
    });
  }
}

export function updateGoogleEarthNav(dt) {
  const { camera, controls } = threeCtx;
  if (!camera || !controls) return;

  if (activeGeAction) {
    const sp = getCameraSpherical();
    const panSpeed = 1.35 * dt;
    const lookSpeed = 0.72 * dt;
    if (activeGeAction === 'pan-left') sp.theta -= panSpeed;
    else if (activeGeAction === 'pan-right') sp.theta += panSpeed;
    else if (activeGeAction === 'pan-up') sp.phi -= panSpeed;
    else if (activeGeAction === 'pan-down') sp.phi += panSpeed;
    else if (activeGeAction === 'look-left') sp.theta -= lookSpeed;
    else if (activeGeAction === 'look-right') sp.theta += lookSpeed;
    else if (activeGeAction === 'look-up') sp.phi -= lookSpeed;
    else if (activeGeAction === 'look-down') sp.phi += lookSpeed;
    else if (activeGeAction === 'zoom-in') sp.radius *= Math.exp(-1.15 * dt);
    else if (activeGeAction === 'zoom-out') sp.radius *= Math.exp(1.15 * dt);
    applyCameraSpherical(sp);
  } else if (northTween.active) {
    const sp = getCameraSpherical();
    const alpha = 1 - Math.exp(-9 * dt);
    sp.theta += (northTween.targetTheta - sp.theta) * alpha;
    sp.phi += (northTween.targetPhi - sp.phi) * alpha;
    if (Math.abs(sp.theta - northTween.targetTheta) < 0.004 && Math.abs(sp.phi - northTween.targetPhi) < 0.004) {
      sp.theta = northTween.targetTheta;
      sp.phi = northTween.targetPhi;
      northTween.active = false;
    }
    applyCameraSpherical(sp);
  }

  if (geCompassRing) {
    const azDeg = THREE.MathUtils.radToDeg(controls.getAzimuthalAngle());
    geCompassRing.style.transform = `rotate(${azDeg.toFixed(2)}deg)`;
  }

  if (geZoomThumb && !isDraggingZoom) {
    const dist = camera.position.distanceTo(controls.target);
    const clamped = THREE.MathUtils.clamp(dist, controls.minDistance, controls.maxDistance);
    const pct = Math.log(clamped / controls.minDistance) / Math.log(controls.maxDistance / controls.minDistance);
    geZoomThumb.style.top = (THREE.MathUtils.clamp(pct, 0, 1) * 100).toFixed(2) + '%';
  }
}
