// ==========================================
// TRẠNG THÁI CHUNG TOÀN ỨNG DỤNG
// ==========================================
function getInitialUprightAxis() {
  try {
    return localStorage.getItem('dlt_axis_upright') !== 'false';
  } catch (_) {
    return true;
  }
}

export const appState = {
  planetModels: {},
  isUprightAxis: getInitialUprightAxis(),
  textureState: {
    earth: { status: 'loading', fileName: '' },
    moon: { status: 'loading', fileName: '' },
    mars: { status: 'loading', fileName: '' }
  },
  activePlanetKey: 'earth',
  transitionProgress: 1,
  isWireframe: false,
  showMarkers: true,
  pendingLinkArgs: null,

  dualLinkState: {
    active: false,
    targetPlanet: 'mars',
    earthLat: 0,
    earthLon: 0,
    targetLat: 0,
    targetLon: 0,
    earthPin: null,
    targetPin: null
  },

  finderState: {
    data: null,
    apiBase: null,
    selectedTargetId: null,
    selectedMissionId: null,
    selectedSiteId: null,
    loading: false,
    matchReqSeq: 0
  },

  map2dState: {
    planetKey: 'earth',
    layerId: 'esri',
    lat: 0,
    lon: 0,
    label: ''
  },

  topWindowZ: 22,
  floatingWindows: []
};
