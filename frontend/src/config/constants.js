// ==========================================
// 1. UNIFIED CONFIGURATION FOR 3 PLANETS & MAPS
// ==========================================
export const RADIUS = 1.5;
export const ARC_SEGMENTS = 64;

export const PLANET_CONFIG = {
  earth: {
    tag: 'Home Planet · Terrestrial Analog Lab',
    title: 'Earth',
    accent: '#38bdf8',
    markerColor: 0x38bdf8,
    placeholderColor: 0x1d4ed8,
    tiltDeg: 23.4,
    materialType: 'phong',
    shininess: 20,
    specular: 0x334155,
    atmosphere: null,
    desc: 'Reference environmental dataset for identifying terrestrial analog sites matching future Moon and Mars base locations.',
    stats: [
      { label: 'Radius', value: '6,371 km' },
      { label: 'Gravity', value: '9.81 m/s²' },
      { label: 'Mean Temp', value: '15 °C' },
      { label: 'Atmosphere', value: '78% N₂, 21% O₂' }
    ],
    textures: {
      color: ['earth_daymap.jpg', '2k_earth_daymap.jpg', '4k_earth_daymap.jpg', '8k_earth_daymap.jpg', 'earth.jpg', 'earth_daymap.png'],
      clouds: ['earth_clouds.jpg', '2k_earth_clouds.jpg', 'earth_clouds.png'],
      normal: ['earth_normal.jpg', '2k_earth_normal_map.jpg', 'earth_normal.png'],
      bump: ['earth_bump.jpg', 'earth_bump.png'],
      specular: ['earth_specular.jpg', '2k_earth_specular_map.jpg', 'earth_specular.png']
    },
    analogsTitle: 'Featured Analog Sites',
    analogs: [
      { name: 'Atacama Desert (Chile)', lat: -24.5, lon: -69.2, note: 'Hyper-arid soil & high UV radiation — Mars surface analog.' },
      { name: 'Haughton Crater (Canada)', lat: 75.37, lon: -89.68, note: 'Polar impact crater — Lunar & Martian cold-terrain analog.' },
      { name: 'Icelandic Highlands', lat: 64.9, lon: -16.8, note: 'Volcanic basalt & glaciers — Rover mobility & ISRU testing.' },
      { name: 'Death Valley (USA)', lat: 36.5, lon: -117.0, note: 'Arid dunes & rocky washes — Navigation & dust testing.' }
    ]
  },
  moon: {
    tag: 'Natural Satellite · Artemis Target',
    title: 'Moon',
    accent: '#e2e8f0',
    markerColor: 0xfacc15,
    placeholderColor: 0x64748b,
    tiltDeg: 6.7,
    materialType: 'standard',
    roughness: 0.94,
    metalness: 0.02,
    atmosphere: null,
    desc: 'Regolith-covered surface, basaltic Maria plains, and Permanently Shadowed Regions (PSRs) near the South Pole holding potential water ice.',
    stats: [
      { label: 'Radius', value: '1,737 km' },
      { label: 'Gravity', value: '1.62 m/s²' },
      { label: 'Temp Range', value: '-173° to 127°C' },
      { label: 'Atmosphere', value: 'Vacuum' }
    ],
    textures: {
      color: ['moon_color.jpg', '2k_moon.jpg', '4k_moon.jpg', '8k_moon.jpg', 'moon.jpg', 'moon_color.png'],
      bump: ['moon_bump.jpg', 'moon_bump.png']
    },
    analogsTitle: 'Lunar Base Targets',
    analogs: [
      { name: 'Shackleton Crater (South Pole)', lat: -89.54, lon: 0.0, note: 'Permanently shadowed water-ice floor + near-continuous sunlit rim.' },
      { name: 'Marius Hills (Lava Tubes)', lat: 14.1, lon: -53.1, note: 'Subsurface lava tubes offering natural radiation & thermal shielding.' },
      { name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4, note: 'Ancient basaltic plain (Apollo 11 landing region).' }
    ]
  },
  mars: {
    tag: 'Red Planet · Exploration Target',
    title: 'Mars',
    accent: '#fb7185',
    markerColor: 0x34d399,
    placeholderColor: 0xb45309,
    tiltDeg: 25.2,
    materialType: 'standard',
    roughness: 0.88,
    metalness: 0.03,
    atmosphere: { radius: 1.61, color: 0xf97316, intensity: 0.72 },
    desc: 'Iron-oxide surface, Valles Marineris canyon system, giant shield volcano Olympus Mons, and CO₂/water-ice polar caps.',
    stats: [
      { label: 'Radius', value: '3,389 km' },
      { label: 'Gravity', value: '3.72 m/s²' },
      { label: 'Mean Temp', value: '-63 °C' },
      { label: 'Atmosphere', value: '95% CO₂ (thin)' }
    ],
    textures: {
      color: ['mars_color.jpg', '2k_mars.jpg', '4k_mars.jpg', '8k_mars.jpg', 'mars.jpg', 'mars_color.png'],
      bump: ['mars_bump.jpg', 'mars_bump.png']
    },
    analogsTitle: 'Mars Exploration Sites',
    analogs: [
      { name: 'Jezero Crater', lat: 18.38, lon: 77.58, note: 'Ancient lake delta — Perseverance rover astrobiology site.' },
      { name: 'Valles Marineris', lat: -13.9, lon: -59.2, note: '4,000+ km canyon system exposing ancient geological strata.' },
      { name: 'Olympus Mons', lat: 18.65, lon: -133.8, note: 'Largest shield volcano in the Solar System.' }
    ]
  }
};

export const FINDER_FEATURES = [
  { col: 'slope_deg', label: 'Slope', unit: '°', bounds: [0, 65], weightCol: 'w_slope' },
  { col: 'mean_temp_c', label: 'Mean Temp', unit: '°C', bounds: [-30, 45], weightCol: 'w_temp' },
  { col: 'temp_swing_c', label: 'Diurnal Temp Swing', unit: '°C', bounds: [0, 40], weightCol: 'w_temp_swing' },
  { col: 'aridity_ice_idx', label: 'Aridity / Ice Index', unit: '', bounds: [0, 1], weightCol: 'w_aridity_ice' },
  { col: 'has_subsurface_void', label: 'Subsurface Void', unit: '', bounds: [0, 1], weightCol: 'w_void' }
];

export const TILE_LAYERS = {
  earth: [
    {
      id: 'esri',
      label: 'Esri Satellite (<1m)',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxNativeZoom: 18,
      maxZoom: 19,
      defaultZoom: 11,
      attribution: 'Esri, Maxar, Earthstar Geographics'
    },
    {
      id: 'osm',
      label: 'Street & Place Map',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxNativeZoom: 19,
      maxZoom: 19,
      defaultZoom: 10,
      attribution: 'OpenStreetMap contributors'
    },
    {
      id: 'gibs',
      label: 'NASA GIBS MODIS',
      url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-10-01/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
      maxNativeZoom: 9,
      maxZoom: 13,
      defaultZoom: 7,
      attribution: 'NASA EOSDIS GIBS'
    }
  ],
  moon: [
    {
      id: 'opm-moon',
      label: 'OpenPlanetaryMap LRO',
      url: 'https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-moon-basemap-v0-1/all/{z}/{x}/{y}.png',
      maxNativeZoom: 9,
      maxZoom: 14,
      defaultZoom: 6,
      attribution: 'OpenPlanetaryMap / NASA LRO'
    }
  ],
  mars: [
    {
      id: 'opm-mars',
      label: 'OpenPlanetaryMap Mars',
      url: 'https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-mars-basemap-v0-2/all/{z}/{x}/{y}.png',
      maxNativeZoom: 9,
      maxZoom: 14,
      defaultZoom: 6,
      attribution: 'OpenPlanetaryMap / NASA Viking & MOLA'
    }
  ]
};
