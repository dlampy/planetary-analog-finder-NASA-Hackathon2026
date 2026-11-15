import { PLANET_CONFIG, RADIUS } from '../config/constants.js';
import { appState } from '../state/appState.js';
import { threeCtx } from './threeScene.js';

let textureLoader = null;

function getTextureLoader() {
  if (!textureLoader) {
    textureLoader = new THREE.TextureLoader();
  }
  return textureLoader;
}

// ==========================================
// 3. TIỆN ÍCH NẠP TEXTURE & TỌA ĐỘ CẦU
// ==========================================
export function loadSingleTexture(url, isColor) {
  return new Promise((resolve) => {
    getTextureLoader().load(
      url,
      (tex) => {
        if (isColor) tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = Math.min(8, threeCtx.renderer.capabilities.getMaxAnisotropy());
        tex.userData = { url };
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

export async function loadFirstAvailable(fileNames, isColor = true) {
  if (!fileNames || !fileNames.length || window.location.protocol === 'file:') return null;
  for (const name of fileNames) {
    const tex = await loadSingleTexture('./assets/textures/' + name, isColor);
    if (tex) return tex;
  }
  return null;
}

export function createAtmosphereMesh(radius, colorHex, intensity) {
  const geo = new THREE.SphereGeometry(radius, 64, 64);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(colorHex) },
      intensity: { value: intensity }
    },
    vertexShader: `
      varying vec3 vNormal;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float intensity;
      varying vec3 vNormal;
      void main() {
        float fresnel = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
        gl_FragColor = vec4(glowColor, 1.0) * clamp(fresnel, 0.0, 1.0) * intensity;
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  });
  return new THREE.Mesh(geo, mat);
}

export function latLonToVector3(lat, lon, radius) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

export function vector3ToLatLon(localVec) {
  const v = localVec.clone().normalize();
  const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v.y, -1, 1)));
  const theta = Math.atan2(v.z, -v.x);
  let lon = THREE.MathUtils.radToDeg(theta) - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}

export function createAnalogMarkers(cfg) {
  const markersGroup = new THREE.Group();
  markersGroup.name = 'markers';

  const dotGeo = new THREE.SphereGeometry(0.032, 16, 16);
  const ringGeo = new THREE.RingGeometry(0.042, 0.06, 24);

  cfg.analogs.forEach((site, index) => {
    const pos = latLonToVector3(site.lat, site.lon, RADIUS + 0.015);
    const dotMat = new THREE.MeshBasicMaterial({ color: cfg.markerColor });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(pos);
    dot.userData = { site, index };

    const ringMat = new THREE.MeshBasicMaterial({
      color: cfg.markerColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.lookAt(pos.clone().multiplyScalar(2));

    markersGroup.add(dot);
    markersGroup.add(ring);
  });

  return markersGroup;
}

// ==========================================
// 4. DỰNG MÔ HÌNH HÀNH TINH TỪ PLANET_CONFIG
// ==========================================
export async function buildPlanet(key) {
  const cfg = PLANET_CONFIG[key];
  const group = new THREE.Group();

  // Placeholder ban đầu (hiện ngay nếu chưa có ảnh hoặc đang mở file://)
  const placeholderMat = new THREE.MeshStandardMaterial({
    color: cfg.placeholderColor,
    roughness: 0.85,
    metalness: 0.1,
    wireframe: true,
    transparent: true,
    opacity: 0.45
  });

  const surfaceMesh = new THREE.Mesh(threeCtx.sphereGeo, placeholderMat);
  surfaceMesh.name = 'surface';
  surfaceMesh.userData.planetKey = key;
  group.add(surfaceMesh);

  // Ghim tọa độ Analog gắn chặt lên surfaceMesh để xoay theo hành tinh
  const markersGroup = createAnalogMarkers(cfg);
  surfaceMesh.add(markersGroup);

  if (cfg.atmosphere) {
    group.add(createAtmosphereMesh(cfg.atmosphere.radius, cfg.atmosphere.color, cfg.atmosphere.intensity));
  }

  group.rotation.z = appState.isUprightAxis ? 0 : THREE.MathUtils.degToRad(cfg.tiltDeg);

  // Nạp ảnh thật từ assets/textures/
  const [colorMap, cloudMap, normalMap, bumpMap, specMap] = await Promise.all([
    loadFirstAvailable(cfg.textures.color, true),
    loadFirstAvailable(cfg.textures.clouds, false),
    loadFirstAvailable(cfg.textures.normal, false),
    loadFirstAvailable(cfg.textures.bump, false),
    loadFirstAvailable(cfg.textures.specular, false)
  ]);

  if (colorMap) {
    let realMat;
    if (cfg.materialType === 'phong') {
      const opts = {
        map: colorMap,
        specular: new THREE.Color(cfg.specular || 0x1e293b),
        shininess: cfg.shininess || 14
      };
      if (normalMap) {
        opts.normalMap = normalMap;
        opts.normalScale = new THREE.Vector2(0.85, 0.85);
      } else if (bumpMap) {
        opts.bumpMap = bumpMap;
        opts.bumpScale = 0.04;
      }
      if (specMap) {
        opts.specularMap = specMap;
        opts.shininess = 24;
      }
      realMat = new THREE.MeshPhongMaterial(opts);
    } else {
      realMat = new THREE.MeshStandardMaterial({
        map: colorMap,
        bumpMap: bumpMap || colorMap,
        bumpScale: bumpMap ? 0.045 : 0.022,
        roughness: cfg.roughness ?? 0.9,
        metalness: cfg.metalness ?? 0.02
      });
    }

    realMat.wireframe = appState.isWireframe;
    surfaceMesh.material.dispose();
    surfaceMesh.material = realMat;

    if (cloudMap) {
      const isPng = cloudMap.userData.url.endsWith('.png');
      const cloudMat = isPng
        ? new THREE.MeshPhongMaterial({ map: cloudMap, transparent: true, opacity: 0.88, depthWrite: false })
        : new THREE.MeshPhongMaterial({ color: 0xffffff, alphaMap: cloudMap, transparent: true, opacity: 0.85, depthWrite: false });
      const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS + 0.028, 64, 64), cloudMat);
      cloudMesh.name = 'clouds';
      group.add(cloudMesh);
    }

    const url = colorMap.userData && colorMap.userData.url ? colorMap.userData.url.split('/').pop() : '';
    appState.textureState[key] = { status: 'real', fileName: url };
  } else {
    appState.textureState[key] = { status: 'missing', fileName: cfg.textures.color[0] };
  }

  return group;
}

// Chọn ảnh trực tiếp từ máy (dùng khi mở file:// hoặc muốn đổi texture nhanh)
export function initLocalTexturePicker(onTextureUpdated) {
  const pickBtn = document.getElementById('btn-pick-texture');
  const fileInput = document.getElementById('local-texture-input');
  if (!pickBtn || !fileInput) return;

  pickBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = Math.min(8, threeCtx.renderer.capabilities.getMaxAnisotropy());
        tex.needsUpdate = true;

        const key = appState.activePlanetKey;
        const group = appState.planetModels[key];
        const cfg = PLANET_CONFIG[key];
        if (group) {
          const surface = group.getObjectByName('surface');
          if (surface) {
            surface.material.dispose();
            surface.material = cfg.materialType === 'phong'
              ? new THREE.MeshPhongMaterial({
                map: tex,
                specular: new THREE.Color(0x1e293b),
                shininess: 14,
                wireframe: appState.isWireframe
              })
              : new THREE.MeshStandardMaterial({
                map: tex,
                bumpMap: tex,
                bumpScale: 0.022,
                roughness: cfg.roughness ?? 0.9,
                metalness: 0.02,
                wireframe: appState.isWireframe
              });
          }
          appState.textureState[key] = { status: 'real', fileName: file.name };
          if (onTextureUpdated) onTextureUpdated(key);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    fileInput.value = '';
  });
}

// Tooltip khi di chuột qua các ghim 3D
export function initMarkerHoverTooltip() {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tooltip = document.getElementById('marker-tooltip');
  const { renderer, camera } = threeCtx;

  renderer.domElement.addEventListener('pointermove', (e) => {
    const visibleGroups = Object.values(appState.planetModels).filter(g => g && g.visible);
    if (!visibleGroups.length) {
      tooltip.style.display = 'none';
      return;
    }

    const pickTargets = [];
    const surfaceTargets = [];
    visibleGroups.forEach(group => {
      const surface = group.getObjectByName('surface');
      if (!surface) return;
      surfaceTargets.push(surface);
      if (appState.showMarkers) {
        const markers = surface.getObjectByName('markers');
        if (markers) pickTargets.push(...markers.children);
      }
      const customPin = surface.getObjectByName('customPin');
      if (customPin) pickTargets.push(...customPin.children);
      const topAnalogs = surface.getObjectByName('topAnalogs');
      if (topAnalogs) pickTargets.push(...topAnalogs.children);
    });

    if (!pickTargets.length) {
      tooltip.style.display = 'none';
      return;
    }

    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObjects(pickTargets, false);
    const hitWithSite = hits.find(h => h.object.userData && h.object.userData.site);
    const surfaceHits = raycaster.intersectObjects(surfaceTargets, false);
    const isFrontSide = !surfaceHits.length || (hitWithSite && hitWithSite.distance <= surfaceHits[0].distance + 0.12);

    if (hitWithSite && isFrontSide) {
      const site = hitWithSite.object.userData.site;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 14) + 'px';
      tooltip.style.top = (e.clientY + 14) + 'px';
      tooltip.innerHTML = `<strong>${site.name}</strong><br><span style="color:#94a3b8">${site.note}</span>`;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      renderer.domElement.style.cursor = 'grab';
    }
  });
}
