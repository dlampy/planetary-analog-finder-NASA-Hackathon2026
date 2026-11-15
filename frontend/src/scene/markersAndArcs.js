import { ARC_SEGMENTS, RADIUS } from '../config/constants.js';
import { appState } from '../state/appState.js';
import { latLonToVector3 } from './planetBuilder.js';

let linkGroup = null;
let linkLineGeo = null;
let pulseDots = [];
let arcCurve = null;

export function initLinkGroup(scene) {
  linkGroup = new THREE.Group();
  linkGroup.visible = false;
  scene.add(linkGroup);

  linkLineGeo = new THREE.BufferGeometry();
  linkLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC_SEGMENTS + 1) * 3), 3));
  const linkLineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9 });
  const linkLine = new THREE.Line(linkLineGeo, linkLineMat);
  linkGroup.add(linkLine);

  pulseDots = [0, 1, 2].map((idx) => {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(idx === 0 ? 0.052 : 0.036, 16, 16),
      new THREE.MeshBasicMaterial({ color: idx === 0 ? 0xfef08a : 0x38bdf8 })
    );
    linkGroup.add(dot);
    return dot;
  });

  arcCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 1),
    new THREE.Vector3(1, 0, 0)
  ]);
}

export function setLinkGroupVisible(visible) {
  if (linkGroup) linkGroup.visible = visible;
}

export function updateDualLinkPulses(elapsed) {
  if (!arcCurve || !pulseDots.length) return;
  pulseDots.forEach((dot, idx) => {
    const t = (elapsed * 0.42 - idx * 0.06 + 1) % 1;
    arcCurve.getPointAt(t, dot.position);
  });
}

export function parseGpsInput(raw) {
  if (!raw) return null;
  const parts = String(raw).trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function createCustomPin(planetKey, lat, lon, label, colorHex) {
  const group = appState.planetModels[planetKey];
  if (!group) return null;
  const surface = group.getObjectByName('surface');
  if (!surface) return null;

  const old = surface.getObjectByName('customPin');
  if (old) surface.remove(old);

  const pinGroup = new THREE.Group();
  pinGroup.name = 'customPin';

  const normal = latLonToVector3(lat, lon, 1).normalize();
  const surfacePos = normal.clone().multiplyScalar(RADIUS + 0.015);
  const tipPos = normal.clone().multiplyScalar(RADIUS + 0.16);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.048, 16, 16),
    new THREE.MeshBasicMaterial({ color: colorHex })
  );
  beacon.position.copy(tipPos);
  beacon.userData = { site: { name: label, note: `GPS: ${lat.toFixed(2)}°, ${lon.toFixed(2)}°` } };

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.065, 0.1, 28),
    new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  ring.position.copy(surfacePos);
  ring.lookAt(normal.clone().multiplyScalar(RADIUS * 2));

  const stemGeo = new THREE.BufferGeometry().setFromPoints([surfacePos, tipPos]);
  const stem = new THREE.Line(stemGeo, new THREE.LineBasicMaterial({ color: colorHex }));

  pinGroup.add(beacon, ring, stem);
  surface.add(pinGroup);
  return beacon;
}

export function clearCustomPins() {
  Object.values(appState.planetModels).forEach(group => {
    const surface = group && group.getObjectByName('surface');
    const old = surface && surface.getObjectByName('customPin');
    if (old) surface.remove(old);
  });
  appState.dualLinkState.earthPin = null;
  appState.dualLinkState.targetPin = null;
}

export function clearTopAnalogPins() {
  const earthSurface = appState.planetModels.earth && appState.planetModels.earth.getObjectByName('surface');
  if (!earthSurface) return;
  const old = earthSurface.getObjectByName('topAnalogs');
  if (old) earthSurface.remove(old);
}

export function renderTopAnalogPins(rankedList, selectedSiteId) {
  clearTopAnalogPins();
  const earthSurface = appState.planetModels.earth && appState.planetModels.earth.getObjectByName('surface');
  if (!earthSurface || !Array.isArray(rankedList) || !rankedList.length) return;

  const group = new THREE.Group();
  group.name = 'topAnalogs';
  const lowDotGeo = new THREE.SphereGeometry(0.022, 12, 12);
  const dotGeo = new THREE.SphereGeometry(0.028, 14, 14);
  const topDotGeo = new THREE.SphereGeometry(0.038, 16, 16);

  rankedList.forEach(item => {
    const isSelected = item.site_id === selectedSiteId;
    const isTop3 = item.rank <= 3;
    const score = Number(item.topsis_score || 0);
    let color = 0x94a3b8;
    if (isSelected) color = 0x38bdf8;
    else if (isTop3) color = 0xfbbf24;
    else if (score >= 70) color = 0x34d399;
    else if (score >= 55) color = 0x22d3ee;

    const geo = (isSelected || isTop3) ? topDotGeo : (score >= 55 ? dotGeo : lowDotGeo);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(latLonToVector3(item.lat, item.lon, RADIUS + (isSelected ? 0.034 : 0.02)));
    mesh.userData.site = {
      site_id: item.site_id,
      lat: item.lat,
      lon: item.lon,
      name: `#${item.rank} ${item.micro_site_name}`,
      note: `TOPSIS ${score.toFixed(1)}% · ${item.parent_biome}`
    };
    group.add(mesh);
  });

  earthSurface.add(group);
}

export function rotateSurfaceToFront(planetKey, lat, lon, yawOffset = 0) {
  const group = appState.planetModels[planetKey];
  if (!group) return;
  const surface = group.getObjectByName('surface');
  if (!surface) return;
  const v = latLonToVector3(lat, lon, 1);
  const beta = Math.atan2(v.x, v.z);
  surface.rotation.y = -beta + yawOffset;
}

export function updateLinkArcGeometry() {
  const { dualLinkState, planetModels } = appState;
  if (!dualLinkState.active || !dualLinkState.earthPin || !dualLinkState.targetPin) return;
  if (!arcCurve || !linkLineGeo) return;

  const earth = planetModels.earth;
  const target = planetModels[dualLinkState.targetPlanet];
  if (!earth || !target) return;

  earth.updateMatrixWorld(true);
  target.updateMatrixWorld(true);

  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();
  dualLinkState.earthPin.getWorldPosition(p1);
  dualLinkState.targetPin.getWorldPosition(p2);

  const mid = p1.clone().add(p2).multiplyScalar(0.5);
  mid.y += 1.05;
  mid.z += 0.95;

  arcCurve.points[0].copy(p1);
  arcCurve.points[1].copy(mid);
  arcCurve.points[2].copy(p2);

  const pts = arcCurve.getPoints(ARC_SEGMENTS);
  const posAttr = linkLineGeo.getAttribute('position');
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    posAttr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
  }
  posAttr.needsUpdate = true;
}

export function setPickedPin3D(planetKey, lat, lon, colorHex = 0x22d3ee) {
  Object.values(appState.planetModels).forEach(group => {
    const surface = group && group.getObjectByName('surface');
    const old = surface && surface.getObjectByName('pickedPin');
    if (old) surface.remove(old);
  });

  const group = appState.planetModels[planetKey];
  const surface = group && group.getObjectByName('surface');
  if (!surface) return;

  const pin = new THREE.Group();
  pin.name = 'pickedPin';
  const pos = latLonToVector3(lat, lon, RADIUS + 0.018);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 16, 16),
    new THREE.MeshBasicMaterial({ color: colorHex })
  );
  dot.position.copy(pos);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.095, 24),
    new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
  );
  ring.position.copy(pos);
  ring.lookAt(pos.clone().multiplyScalar(2));

  pin.add(dot, ring);
  surface.add(pin);
}
