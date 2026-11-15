// ==========================================
// SHARED APPLICATION STATE
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

  missionWizardState: {
    planet: 'moon',
    missionId: 'rover_mobility',
    pickingOnGlobe: false,
    customTarget: null
  },

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
    showAllSites: false,
    minScoreFilter: 60,
    loading: false,
    matchReqSeq: 0
  },

  map2dState: {
    planetKey: 'earth',
    layerId: 'esri',
    lat: 0,
    lon: 0,
    label: '',
    footprintMode: null
  },

  lastTerrainPairSource: 'finder',

  topWindowZ: 22,
  floatingWindows: []
};
