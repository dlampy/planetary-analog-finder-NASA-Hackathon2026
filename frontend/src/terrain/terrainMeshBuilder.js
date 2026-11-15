const BLOCK_SIZE = 10;
const SKIRT_DEPTH = -1.25;

const SKIRT_COLORS = {
  earth: 0x3b2f28,
  moon: 0x262d38,
  mars: 0x4a2417
};

const FALLBACK_ROCK_TINTS = {
  earth: 0xb8865e,
  moon: 0x9ca3af,
  mars: 0xc26a4a
};

function hypsometricColor(t) {
  const stops = [
    [0.0, 0.14, 0.22, 0.42],
    [0.25, 0.18, 0.45, 0.48],
    [0.52, 0.72, 0.62, 0.36],
    [0.78, 0.76, 0.36, 0.22],
    [1.0, 0.96, 0.94, 0.90]
  ];
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a[0] && clamped <= b[0]) {
      const f = (clamped - a[0]) / Math.max(1e-5, b[0] - a[0]);
      return [
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        a[3] + (b[3] - a[3]) * f
      ];
    }
  }
  return [0.95, 0.92, 0.88];
}

function buildSkirtGeometry(topPositions, n) {
  const verts = [];
  const norms = [];

  const pushQuad = (ax, ay, az, bx, by, bz, nx, ny, nz) => {
    verts.push(
      ax, ay, az,
      ax, SKIRT_DEPTH, az,
      bx, ay, bz,
      bx, ay, bz,
      ax, SKIRT_DEPTH, az,
      bx, SKIRT_DEPTH, bz
    );
    for (let k = 0; k < 6; k++) {
      norms.push(nx, ny, nz);
    }
  };

  const getP = (r, c) => {
    const idx = (r * n + c) * 3;
    return [topPositions[idx], topPositions[idx + 1], topPositions[idx + 2]];
  };

  // Front edge (r = n - 1), left-to-right
  for (let c = 0; c < n - 1; c++) {
    const a = getP(n - 1, c);
    const b = getP(n - 1, c + 1);
    pushQuad(a[0], a[1], a[2], b[0], b[1], b[2], 0, 0, 1);
  }
  // Back edge (r = 0), right-to-left
  for (let c = n - 1; c > 0; c--) {
    const a = getP(0, c);
    const b = getP(0, c - 1);
    pushQuad(a[0], a[1], a[2], b[0], b[1], b[2], 0, 0, -1);
  }
  // Left edge (c = 0), back-to-front
  for (let r = 0; r < n - 1; r++) {
    const a = getP(r, 0);
    const b = getP(r + 1, 0);
    pushQuad(a[0], a[1], a[2], b[0], b[1], b[2], -1, 0, 0);
  }
  // Right edge (c = n - 1), front-to-back
  for (let r = n - 1; r > 0; r--) {
    const a = getP(r, n - 1);
    const b = getP(r - 1, n - 1);
    pushQuad(a[0], a[1], a[2], b[0], b[1], b[2], 1, 0, 0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  return geo;
}

export function createTerrainViewport(containerEl) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  const w = Math.max(240, containerEl.clientWidth || 380);
  const h = Math.max(200, containerEl.clientHeight || 280);

  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 120);
  camera.position.set(8.6, 7.8, 9.6);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  containerEl.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4.5;
  controls.maxDistance = 28;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.target.set(0, 0.4, 0);

  const hemiLight = new THREE.HemisphereLight(0xffe8d6, 0x1e293b, 0.65);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.35);
  sunLight.position.set(11, 14, 7);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 2;
  sunLight.shadow.camera.far = 36;
  const d = 8;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.35);
  fillLight.position.set(-9, 6, -8);
  scene.add(fillLight);

  const blockGroup = new THREE.Group();
  scene.add(blockGroup);

  let currentPatch = null;
  let topMesh = null;
  let skirtMesh = null;
  let baseMesh = null;
  let centerMarker = null;
  let surfaceTexture = null;
  let shadingMode = 'satellite';
  let exaggeration = 2.0;
  let syncingCamera = false;
  let cameraSyncListener = null;

  controls.addEventListener('change', () => {
    if (syncingCamera || !cameraSyncListener) return;
    const offset = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    cameraSyncListener(sph);
  });

  function disposeObject3D(obj) {
    obj.traverse(node => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) node.material.dispose();
    });
  }

  function clearMeshes() {
    while (blockGroup.children.length) {
      const child = blockGroup.children.pop();
      disposeObject3D(child);
    }
    if (surfaceTexture) {
      surfaceTexture.dispose();
      surfaceTexture = null;
    }
    topMesh = null;
    skirtMesh = null;
    baseMesh = null;
    centerMarker = null;
  }

  function applySurfaceStyle() {
    if (!topMesh || !currentPatch) return;
    const oldMat = topMesh.material;
    if (oldMat) oldMat.dispose();

    const useTex = shadingMode === 'satellite' && surfaceTexture;
    const useRamp = shadingMode === 'elevation' || (shadingMode === 'satellite' && !surfaceTexture);

    topMesh.material = new THREE.MeshStandardMaterial({
      map: useTex ? surfaceTexture : null,
      vertexColors: useRamp,
      color: useTex ? 0xffffff : (useRamp ? 0xffffff : (FALLBACK_ROCK_TINTS[currentPatch.planet] || 0x94a3b8)),
      roughness: 0.88,
      metalness: 0.04,
      wireframe: shadingMode === 'wireframe',
      flatShading: false
    });
  }

  function rebuildBlockGeometry() {
    clearMeshes();
    if (!currentPatch) return;

    const { gridSize: n, elevations, minElevationM, reliefM, spanM, surfaceCanvas, planet } = currentPatch;
    const geom = new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE, n - 1, n - 1);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // Physical relief ratio normalized cleanly so flat vs rugged terrains remain visually distinct
    const safeRelief = Math.max(40, reliefM);
    const naturalRatio = Math.min(2.4, Math.max(0.45, (safeRelief / Math.max(500, spanM)) * 18.0));
    const maxHeightUnits = naturalRatio * exaggeration;

    for (let i = 0; i < pos.count; i++) {
      const hNorm = (elevations[i] - minElevationM) / safeRelief;
      const y = hNorm * maxHeightUnits;
      pos.setY(i, y);

      const rgb = hypsometricColor(hNorm);
      // Tint hypsometric lightly by planet hue when texture is missing in satellite fallback
      if (shadingMode === 'satellite' && !surfaceCanvas) {
        const tint = new THREE.Color(FALLBACK_ROCK_TINTS[planet] || 0xb45309);
        const shade = 0.55 + 0.55 * hNorm;
        colors[i * 3] = Math.min(1, tint.r * shade);
        colors[i * 3 + 1] = Math.min(1, tint.g * shade);
        colors[i * 3 + 2] = Math.min(1, tint.b * shade);
      } else {
        colors[i * 3] = rgb[0];
        colors[i * 3 + 1] = rgb[1];
        colors[i * 3 + 2] = rgb[2];
      }
    }

    pos.needsUpdate = true;
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    if (surfaceCanvas) {
      surfaceTexture = new THREE.CanvasTexture(surfaceCanvas);
      surfaceTexture.anisotropy = 4;
      surfaceTexture.needsUpdate = true;
    }

    topMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
    topMesh.castShadow = true;
    topMesh.receiveShadow = true;
    applySurfaceStyle();
    blockGroup.add(topMesh);

    const skirtGeo = buildSkirtGeometry(pos.array, n);
    const skirtMat = new THREE.MeshStandardMaterial({
      color: SKIRT_COLORS[planet] || 0x262d38,
      roughness: 0.95,
      metalness: 0.02
    });
    skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.receiveShadow = true;
    blockGroup.add(skirtMesh);

    const baseGeo = new THREE.BoxGeometry(BLOCK_SIZE, 0.14, BLOCK_SIZE);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
    baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = SKIRT_DEPTH - 0.07;
    blockGroup.add(baseMesh);

    // Center reference pin marking exact site coordinate
    const centerIdx = Math.floor(n / 2) * n + Math.floor(n / 2);
    const centerY = pos.getY(centerIdx);
    const pinGroup = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.65, 8),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    stem.position.set(0, centerY + 0.32, 0);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 14, 14),
      new THREE.MeshBasicMaterial({ color: planet === 'earth' ? 0x38bdf8 : 0xfacc15 })
    );
    orb.position.set(0, centerY + 0.7, 0);
    pinGroup.add(stem, orb);
    centerMarker = pinGroup;
    blockGroup.add(centerMarker);
  }

  function setTerrainPatch(patchData) {
    currentPatch = patchData;
    rebuildBlockGeometry();
  }

  function setVerticalExaggeration(factor) {
    exaggeration = Number(factor) || 2.0;
    if (currentPatch) rebuildBlockGeometry();
  }

  function setShadingMode(mode) {
    shadingMode = mode || 'satellite';
    if (currentPatch) {
      if (shadingMode === 'satellite' && !currentPatch.surfaceCanvas) {
        rebuildBlockGeometry();
      } else {
        applySurfaceStyle();
      }
    }
  }

  function applySphericalCamera(sph) {
    syncingCamera = true;
    const offset = new THREE.Vector3().setFromSpherical(sph);
    camera.position.copy(controls.target).add(offset);
    controls.update();
    syncingCamera = false;
  }

  function setCameraSyncListener(fn) {
    cameraSyncListener = fn;
  }

  function resetCamera() {
    syncingCamera = true;
    camera.position.set(8.6, 7.8, 9.6);
    controls.target.set(0, 0.4, 0);
    controls.update();
    syncingCamera = false;
  }

  function resize() {
    const cw = containerEl.clientWidth;
    const ch = containerEl.clientHeight;
    if (!cw || !ch) return;
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();
    renderer.setSize(cw, ch);
  }

  function renderFrame() {
    controls.update();
    renderer.render(scene, camera);
  }

  function dispose() {
    clearMeshes();
    controls.dispose();
    renderer.dispose();
  }

  return {
    setTerrainPatch,
    setVerticalExaggeration,
    setShadingMode,
    applySphericalCamera,
    setCameraSyncListener,
    resetCamera,
    resize,
    renderFrame,
    dispose
  };
}
