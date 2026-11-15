import { FINDER_FEATURES } from '../config/constants.js';
import {
  computeWeightsJS,
  inferFootprintModeJS,
  parseCsvText,
  preprocessEarthSiteRowJS,
  resolvePlanetaryPointJS,
  runKnnTopsisJS
} from './csvAndTopsis.js';

let cachedCsvBundleParts = null;
let cachedCatalogPromise = null;

export function getBackendApiCandidates() {
  const candidates = [];
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    if (!window.location.hostname.endsWith('github.io')) {
      candidates.push(`${window.location.origin}/api`);
    }
    if (window.location.port !== '8000') {
      candidates.push('http://127.0.0.1:8000/api', 'http://localhost:8000/api');
    }
  } else {
    candidates.push('http://127.0.0.1:8000/api', 'http://localhost:8000/api');
  }
  return candidates;
}

export async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: 'no-store', ...options, signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFromBackendBundle() {
  for (const base of getBackendApiCandidates()) {
    try {
      const json = await fetchJsonWithTimeout(`${base}/analogs/bundle`, {}, 1500);
      if (json && json.targets && json.missions && json.results) {
        return { base, json };
      }
    } catch (_) {
      // Try next candidate
    }
  }
  return null;
}

export async function probeLiveBackendBase() {
  for (const base of getBackendApiCandidates()) {
    try {
      const json = await fetchJsonWithTimeout(`${base}/health`, {}, 1200);
      if (json && json.status === 'ok') return base;
    } catch (_) {
      // Try next candidate
    }
  }
  return null;
}

export async function fetchBackendMatch(apiBase, targetOrOpts, missionId) {
  const opts = typeof targetOrOpts === 'object' && targetOrOpts !== null
    ? targetOrOpts
    : { targetId: targetOrOpts, missionId };

  const bodyPayload = {
    mission_id: opts.missionId || 'rover_mobility',
    evaluate_all: opts.evaluateAll !== undefined ? Boolean(opts.evaluateAll) : true,
    knn_k: opts.knnK || 2000,
    top_n: opts.topN || 2000,
    min_score: opts.minScore || 0.0
  };
  if (opts.targetId) {
    bodyPayload.target_id = opts.targetId;
  } else {
    bodyPayload.target_body = opts.targetBody;
    bodyPayload.lat = Number(opts.lat);
    bodyPayload.lon = Number(opts.lon);
  }

  return fetchJsonWithTimeout(
    `${apiBase}/analogs/match`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    },
    4500
  );
}

export async function fetchPrecomputedAnalogsJson() {
  const res = await fetch('./assets/data/analogs_results.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

export async function fetchFirstAvailableCsv(filename) {
  const paths = [
    `../backend/data/${filename}`,
    `/backend/data/${filename}`,
    `../backend/data/placeholderData/${filename}`,
    `/backend/data/placeholderData/${filename}`,
    `./data/${filename}`
  ];
  for (const url of paths) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.text();
    } catch (_) {
      // Try next path
    }
  }
  throw new Error(`Unable to fetch ${filename} from ../backend/data/, placeholderData/, or ./data/`);
}

async function fetchEarthDatasetCsvText() {
  try {
    return await fetchFirstAvailableCsv('merged_earth_features_clean.csv');
  } catch (_) {
    return await fetchFirstAvailableCsv('earth_sites_1000.csv');
  }
}

function parseMissionRows(missionsText) {
  return parseCsvText(missionsText).map(r => {
    const weights = computeWeightsJS(r);
    const label = r.mission_type || r.mission_name || r.mission_id;
    const desc = r.technology_to_test || r.description || label;
    return {
      mission_id: r.mission_id,
      mission_type: label,
      mission_name: label,
      technology_to_test: desc,
      description: desc,
      footprint_mode: inferFootprintModeJS(r),
      weights
    };
  });
}

function parseTargetRows(basesText) {
  return parseCsvText(basesText).map(r => ({
    target_id: r.target_id,
    planet: (r.planet || 'moon').toLowerCase(),
    target_name: r.target_name,
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    features: {
      slope_deg: parseFloat(r.slope_deg),
      mean_temp_c: parseFloat(r.mean_temp_c),
      temp_swing_c: parseFloat(r.temp_swing_c),
      aridity_ice_idx: parseFloat(r.aridity_ice_idx),
      has_subsurface_void: parseInt(r.has_subsurface_void, 10) || 0
    }
  }));
}

async function getParsedCsvDatasets(forceReload = false) {
  if (cachedCsvBundleParts && !forceReload) return cachedCsvBundleParts;
  const [earthText, basesText, missionsText, testsText] = await Promise.all([
    fetchEarthDatasetCsvText(),
    fetchFirstAvailableCsv('planetary_bases.csv'),
    fetchFirstAvailableCsv('missions.csv'),
    fetchFirstAvailableCsv('site_tests.csv')
  ]);

  const earthSites = parseCsvText(earthText)
    .map(preprocessEarthSiteRowJS)
    .filter(s => s.site_id && !Number.isNaN(s.lat) && !Number.isNaN(s.lon));
  const targets = parseTargetRows(basesText);
  const missions = parseMissionRows(missionsText);

  const testExactMap = {};
  const testSiteMap = {};
  parseCsvText(testsText).forEach(r => {
    if (r.site_id && r.mission_id) {
      testExactMap[`${r.site_id}|${r.mission_id}`] = r;
      if (!testSiteMap[r.site_id]) testSiteMap[r.site_id] = r;
    }
  });

  cachedCsvBundleParts = { earthSites, targets, missions, testExactMap, testSiteMap };
  return cachedCsvBundleParts;
}

export async function loadMissionCatalogMetadata(forceReload = false) {
  if (cachedCatalogPromise && !forceReload) return cachedCatalogPromise;
  cachedCatalogPromise = (async () => {
    const apiBase = await probeLiveBackendBase();
    if (apiBase) {
      try {
        const [missionsRes, targetsRes] = await Promise.all([
          fetchJsonWithTimeout(`${apiBase}/missions`, {}, 2000),
          fetchJsonWithTimeout(`${apiBase}/targets`, {}, 2000)
        ]);
        if (Array.isArray(missionsRes) && missionsRes.length && Array.isArray(targetsRes)) {
          const targets = targetsRes.map(t => ({
            target_id: t.site_id || t.target_id,
            planet: String(t.body || t.planet || 'moon').toLowerCase(),
            target_name: t.target_name,
            lat: Number(t.lat),
            lon: Number(t.lon),
            features: t.features || {}
          }));
          return { source: 'backend', apiBase, missions: missionsRes, targets };
        }
      } catch (_) {
        // Fall through to CSVs
      }
    }

    try {
      const [missionsText, basesText] = await Promise.all([
        fetchFirstAvailableCsv('missions.csv'),
        fetchFirstAvailableCsv('planetary_bases.csv')
      ]);
      return {
        source: 'csv',
        apiBase: null,
        missions: parseMissionRows(missionsText),
        targets: parseTargetRows(basesText)
      };
    } catch (_) {
      const pre = await fetchPrecomputedAnalogsJson();
      return {
        source: 'json',
        apiBase: null,
        missions: pre.missions || [],
        targets: pre.targets || []
      };
    }
  })();
  return cachedCatalogPromise;
}

export async function computePointAnalogsFromCSVs({
  targetBody,
  lat,
  lon,
  label,
  missionId,
  evaluateAll = true,
  featuresOverride = null
}) {
  const planet = String(targetBody || 'moon').toLowerCase() === 'mars' ? 'mars' : 'moon';
  const resolved = resolvePlanetaryPointJS(planet, lat, lon);
  const targetName = label || `${planet === 'moon' ? 'Moon' : 'Mars'} (${Number(lat).toFixed(2)}°, ${Number(lon).toFixed(2)}°)`;
  const hasOverride = featuresOverride && featuresOverride.slope_deg !== undefined;
  const targetObj = {
    target_id: `custom_${planet}_${Number(lat).toFixed(3)}_${Number(lon).toFixed(3)}`,
    planet,
    target_name: targetName,
    lat: Number(lat),
    lon: Number(lon),
    features: hasOverride ? featuresOverride : resolved.features,
    resolved_profile: hasOverride ? null : resolved.resolved_profile
  };

  try {
    const { earthSites, missions, testExactMap, testSiteMap } = await getParsedCsvDatasets();
    const missionObj = missions.find(m => m.mission_id === missionId) || missions[0];
    const results = runKnnTopsisJS(targetObj, missionObj, earthSites, testExactMap, testSiteMap, {
      evaluateAll
    });

    return {
      meta: {
        dataset: 'merged_earth_features_clean.csv',
        source_mode: 'csv',
        earth_site_count: earthSites.length,
        evaluated_count: earthSites.length,
        returned_count: results.length,
        evaluate_all: Boolean(evaluateAll),
        active_features: FINDER_FEATURES.map(f => f.col),
        derived_features: ['aridity_ice_idx', 'has_subsurface_void', 'temp_swing_c']
      },
      target: targetObj,
      mission: missionObj,
      results
    };
  } catch (_) {
    const pre = await fetchPrecomputedAnalogsJson();
    const candidates = (pre.targets || []).filter(t => String(t.planet).toLowerCase() === planet);
    const nearest = candidates.reduce((best, cur) => {
      const curD = Math.hypot(cur.lat - lat, cur.lon - lon);
      const bestD = best ? Math.hypot(best.lat - lat, best.lon - lon) : Infinity;
      return curD < bestD ? cur : best;
    }, null) || (pre.targets && pre.targets[0]);
    const missionObj = (pre.missions || []).find(m => m.mission_id === missionId) || (pre.missions && pre.missions[0]);
    const fallbackResults = (nearest && missionObj && pre.results?.[nearest.target_id]?.[missionObj.mission_id]) || [];

    return {
      meta: {
        dataset: pre.meta?.dataset || 'analogs_results.json',
        source_mode: 'json_nearest_fallback',
        nearest_catalog_target: nearest ? nearest.target_name : '',
        earth_site_count: pre.meta?.earth_site_count || fallbackResults.length,
        evaluated_count: fallbackResults.length,
        returned_count: fallbackResults.length,
        evaluate_all: false
      },
      target: targetObj,
      mission: missionObj,
      results: fallbackResults
    };
  }
}

export async function computeBundleFromCSVs() {
  const { earthSites, targets, missions, testExactMap, testSiteMap } = await getParsedCsvDatasets(true);

  const results = {};
  targets.forEach(t => {
    results[t.target_id] = {};
    missions.forEach(m => {
      results[t.target_id][m.mission_id] = runKnnTopsisJS(t, m, earthSites, testExactMap, testSiteMap);
    });
  });

  return {
    meta: {
      dataset: 'merged_earth_features_clean.csv',
      earth_site_count: earthSites.length,
      active_features: FINDER_FEATURES.map(f => f.col),
      derived_features: ['aridity_ice_idx', 'has_subsurface_void', 'temp_swing_c']
    },
    targets,
    missions,
    results
  };
}
