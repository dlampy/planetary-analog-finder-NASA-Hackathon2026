// ==========================================
// 1. CẤU HÌNH THỐNG NHẤT CHO 3 HÀNH TINH & BẢN ĐỒ
// ==========================================
export const RADIUS = 1.5;
export const ARC_SEGMENTS = 64;

export const PLANET_CONFIG = {
  earth: {
    tag: 'Hành tinh chủ · Phòng thí nghiệm Analog',
    title: 'Trái Đất (Earth)',
    accent: '#38bdf8',
    markerColor: 0x38bdf8,
    placeholderColor: 0x1d4ed8,
    tiltDeg: 23.4,
    materialType: 'phong',
    shininess: 20,
    specular: 0x334155,
    atmosphere: { radius: 1.66, color: 0x38bdf8, intensity: 1.1 },
    desc: 'Nguồn dữ liệu tham chiếu giúp tìm kiếm các địa điểm tương đồng (terrestrial analogs) cho căn cứ Mặt Trăng và Sao Hỏa.',
    stats: [
      { label: 'Bán kính', value: '6.371 km' },
      { label: 'Trọng lực', value: '9,81 m/s²' },
      { label: 'Nhiệt độ TB', value: '15 °C' },
      { label: 'Khí quyển', value: '78% N₂, 21% O₂' }
    ],
    textures: {
      color: ['earth_daymap.jpg', '2k_earth_daymap.jpg', '4k_earth_daymap.jpg', '8k_earth_daymap.jpg', 'earth.jpg', 'earth_daymap.png'],
      clouds: ['earth_clouds.jpg', '2k_earth_clouds.jpg', 'earth_clouds.png'],
      normal: ['earth_normal.jpg', '2k_earth_normal_map.jpg', 'earth_normal.png'],
      bump: ['earth_bump.jpg', 'earth_bump.png'],
      specular: ['earth_specular.jpg', '2k_earth_specular_map.jpg', 'earth_specular.png']
    },
    analogsTitle: 'Địa điểm Analog tiêu biểu',
    analogs: [
      { name: 'Sa mạc Atacama (Chile)', lat: -24.5, lon: -69.2, note: 'Đất siêu khô hạn & bức xạ UV cao — Analog bề mặt Sao Hỏa.' },
      { name: 'Haughton Crater (Canada)', lat: 75.37, lon: -89.68, note: 'Hố va chạm vùng cực lạnh — Analog cho Mặt Trăng & Sao Hỏa.' },
      { name: 'Cao nguyên Iceland', lat: 64.9, lon: -16.8, note: 'Đá bazan núi lửa & băng hà — Thử nghiệm rover & ISRU.' },
      { name: 'Thung lũng Chết (Mỹ)', lat: 36.5, lon: -117.0, note: 'Địa hình khô cằn & đồi cát — Thử nghiệm điều hướng & bụi.' }
    ]
  },
  moon: {
    tag: 'Vệ tinh tự nhiên · Mục tiêu Artemis',
    title: 'Mặt Trăng (Moon)',
    accent: '#e2e8f0',
    markerColor: 0xfacc15,
    placeholderColor: 0x64748b,
    tiltDeg: 6.7,
    materialType: 'standard',
    roughness: 0.94,
    metalness: 0.02,
    atmosphere: null,
    desc: 'Bề mặt phủ bụi regolith, biển basaltic Maria và các vùng tối vĩnh cửu (PSR) ở Cực Nam có tiềm năng băng nước.',
    stats: [
      { label: 'Bán kính', value: '1.737 km' },
      { label: 'Trọng lực', value: '1,62 m/s²' },
      { label: 'Nhiệt độ', value: '-173° đến 127°C' },
      { label: 'Khí quyển', value: 'Chân không' }
    ],
    textures: {
      color: ['moon_color.jpg', '2k_moon.jpg', '4k_moon.jpg', '8k_moon.jpg', 'moon.jpg', 'moon_color.png'],
      bump: ['moon_bump.jpg', 'moon_bump.png']
    },
    analogsTitle: 'Mục tiêu căn cứ Mặt Trăng',
    analogs: [
      { name: 'Shackleton Crater (Cực Nam)', lat: -89.54, lon: 0.0, note: 'Vùng tối vĩnh cửu chứa băng nước + vành hố đón nắng gần liên tục.' },
      { name: 'Marius Hills (Ống dung nham)', lat: 14.1, lon: -53.1, note: 'Hang ống dung nham tiềm năng che chắn bức xạ cho căn cứ.' },
      { name: 'Mare Tranquillitatis', lat: 8.5, lon: 31.4, note: 'Đồng bằng đá bazan cổ đại (khu vực hạ cánh Apollo 11).' }
    ]
  },
  mars: {
    tag: 'Hành tinh Đỏ · Mục tiêu Thám hiểm',
    title: 'Sao Hỏa (Mars)',
    accent: '#fb7185',
    markerColor: 0x34d399,
    placeholderColor: 0xb45309,
    tiltDeg: 25.2,
    materialType: 'standard',
    roughness: 0.88,
    metalness: 0.03,
    atmosphere: { radius: 1.61, color: 0xf97316, intensity: 0.72 },
    desc: 'Bề mặt giàu oxit sắt, hẻm núi Valles Marineris, núi lửa khổng lồ Olympus Mons và chỏm băng CO₂/nước ở hai cực.',
    stats: [
      { label: 'Bán kính', value: '3.389 km' },
      { label: 'Trọng lực', value: '3,72 m/s²' },
      { label: 'Nhiệt độ TB', value: '-63 °C' },
      { label: 'Khí quyển', value: '95% CO₂ (mỏng)' }
    ],
    textures: {
      color: ['mars_color.jpg', '2k_mars.jpg', '4k_mars.jpg', '8k_mars.jpg', 'mars.jpg', 'mars_color.png'],
      bump: ['mars_bump.jpg', 'mars_bump.png']
    },
    analogsTitle: 'Địa điểm thám hiểm Sao Hỏa',
    analogs: [
      { name: 'Jezero Crater', lat: 18.38, lon: 77.58, note: 'Châu thổ hồ cổ đại — Khu vực rover Perseverance tìm dấu vết sự sống.' },
      { name: 'Valles Marineris', lat: -13.9, lon: -59.2, note: 'Hệ thống hẻm núi dài hơn 4.000 km lộ các tầng địa chất cổ.' },
      { name: 'Olympus Mons', lat: 18.65, lon: -133.8, note: 'Núi lửa hình khiên lớn nhất Hệ Mặt Trời.' }
    ]
  }
};

export const FINDER_FEATURES = [
  { col: 'slope_deg', label: 'Độ dốc (Slope)', unit: '°', bounds: [0, 65], weightCol: 'w_slope' },
  { col: 'mean_temp_c', label: 'Nhiệt độ TB', unit: '°C', bounds: [-30, 45], weightCol: 'w_temp' },
  { col: 'temp_swing_c', label: 'Biên độ nhiệt ngày', unit: '°C', bounds: [0, 40], weightCol: 'w_temp_swing' },
  { col: 'aridity_ice_idx', label: 'Độ khô hạn / Băng', unit: '', bounds: [0, 1], weightCol: 'w_aridity_ice' },
  { col: 'has_subsurface_void', label: 'Hang / Hốc ngầm', unit: '', bounds: [0, 1], weightCol: 'w_void' }
];

export const TILE_LAYERS = {
  earth: [
    {
      id: 'esri',
      label: 'Esri Vệ tinh (<1m)',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxNativeZoom: 18,
      maxZoom: 19,
      defaultZoom: 11,
      attribution: 'Esri, Maxar, Earthstar Geographics'
    },
    {
      id: 'osm',
      label: 'Bản đồ Địa danh',
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
