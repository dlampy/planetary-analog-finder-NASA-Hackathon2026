import { FINDER_FEATURES } from '../config/constants.js';
import {
  computeWeightsJS,
  parseCsvText,
  preprocessEarthSiteRowJS,
  runKnnTopsisJS
} from './csvAndTopsis.js';

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

export async function fetchBackendMatch(apiBase, targetId, missionId) {
  return fetchJsonWithTimeout(
    `${apiBase}/analogs/match`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_id: targetId, mission_id: missionId })
    },
    3000
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
  throw new Error(`Không thể fetch ${filename} từ ../backend/data/, placeholderData/ hoặc ./data/`);
}

async function fetchEarthDatasetCsvText() {
  try {
    return await fetchFirstAvailableCsv('merged_earth_features_clean.csv');
  } catch (_) {
    return await fetchFirstAvailableCsv('earth_sites_1000.csv');
  }
}

export async function computeBundleFromCSVs() {
  const [earthText, basesText, missionsText, testsText] = await Promise.all([
    fetchEarthDatasetCsvText(),
    fetchFirstAvailableCsv('planetary_bases.csv'),
    fetchFirstAvailableCsv('missions.csv'),
    fetchFirstAvailableCsv('site_tests.csv')
  ]);

  const earthSites = parseCsvText(earthText)
    .map(preprocessEarthSiteRowJS)
    .filter(s => s.site_id && !Number.isNaN(s.lat) && !Number.isNaN(s.lon));

  const targets = parseCsvText(basesText).map(r => ({
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

  const missions = parseCsvText(missionsText).map(r => {
    const weights = computeWeightsJS(r);
    return {
      mission_id: r.mission_id,
      mission_type: r.mission_type,
      technology_to_test: r.technology_to_test || '',
      footprint_mode: r.footprint_mode || 'square_1km',
      w_slope: parseFloat(r.w_slope) || 0,
      w_temp: parseFloat(r.w_temp) || 0,
      w_temp_swing: parseFloat(r.w_temp_swing) || 0,
      w_aridity_ice: parseFloat(r.w_aridity_ice) || 0,
      w_void: parseFloat(r.w_void) || 0,
      weights
    };
  });

  const testExactMap = {};
  const testSiteMap = {};
  parseCsvText(testsText).forEach(r => {
    if (r.site_id && r.mission_id) {
      testExactMap[`${r.site_id}|${r.mission_id}`] = r;
      if (!testSiteMap[r.site_id]) testSiteMap[r.site_id] = r;
    }
  });

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
