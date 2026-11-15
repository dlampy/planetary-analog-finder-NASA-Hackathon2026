import { RADIUS } from '../config/constants.js';

export const threeCtx = {
  container: null,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  sunLight: null,
  rimLight: null,
  clock: null,
  sphereGeo: null
};

function createStarfield(scene) {
  const starGeo = new THREE.BufferGeometry();
  const count = 2400;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 45 + Math.random() * 80;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const t = 0.75 + Math.random() * 0.25;
    col[i * 3] = t;
    col[i * 3 + 1] = t;
    col[i * 3 + 2] = Math.min(1, t + 0.12);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const starField = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 0.22,
    vertexColors: true,
    transparent: true,
    opacity: 0.85
  }));
  starField.name = 'starfield';
  scene.add(starField);
}

// ==========================================
// 2. INITIALIZE THREE.JS SCENE & LIGHTING
// ==========================================
export function initThreeScene(statusText) {
  const container = document.getElementById('canvas-container');
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0.8, 5.4);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);
  } catch (err) {
    if (statusText) {
      statusText.textContent = 'WebGL is not enabled on this device for 3D rendering: ' + (err && err.message ? err.message : err);
    }
    return null;
  }

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 2.6;
  controls.maxDistance = 16;
  controls.enablePan = false;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.85;

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.55);
  sunLight.position.set(6, 3, 5);
  scene.add(sunLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.25);
  rimLight.position.set(-6, -2, -5);
  scene.add(rimLight);

  scene.add(new THREE.AmbientLight(0x475569, 0.65));
  createStarfield(scene);

  threeCtx.container = container;
  threeCtx.scene = scene;
  threeCtx.camera = camera;
  threeCtx.renderer = renderer;
  threeCtx.controls = controls;
  threeCtx.sunLight = sunLight;
  threeCtx.rimLight = rimLight;
  threeCtx.clock = new THREE.Clock();
  threeCtx.sphereGeo = new THREE.SphereGeometry(RADIUS, 64, 64);

  return threeCtx;
}
