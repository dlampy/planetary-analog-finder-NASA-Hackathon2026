import { FINDER_FEATURES } from '../config/constants.js';
import { appState } from '../state/appState.js';
import { renderTopAnalogPins } from '../scene/markersAndArcs.js';
import { applyAnalogLink } from '../ui/infoPanel.js';
import { bringWindowToFront, clampWindowToViewport, makeWindowDraggable } from '../ui/windowManager.js';
import { toggleToolsMenu } from '../ui/popups.js';
import { open2DMapAt, registerAnalogPinClickCallback, registerMap2DFinderCallback } from '../map2d/leafletMap.js';
import { escapeHtml } from './csvAndTopsis.js';
import { openTerrainComparison } from '../terrain/terrainComparatorPanel.js';
import {
  computeBundleFromCSVs,
  computePointAnalogsFromCSVs,
  fetchBackendMatch,
  fetchFromBackendBundle,
  fetchPrecomputedAnalogsJson,
  loadMissionCatalogMetadata,
  probeLiveBackendBase
} from './finderApi.js';

// ==========================================
// 5D. PLANETARY ANALOG FINDER (KNN -> TOPSIS + FALLBACK)
// ==========================================
let btnFinderMenu = null;
let finderPopup = null;
let finderTargetSelect = null;
let finderTargetBadge = null;
let finderTargetTelemetry = null;
let finderMissionTabs = null;
let finderWeightsStrip = null;
let finderResultsTitle = null;
let btnFilterSuitable = null;
let btnFilterAll = null;
let finderCountLabel = null;
let finderRankList = null;
let finderDetailCard = null;
let finderSourceStatus = null;
let btnFinderCsv = null;
let btnFinderPickGlobe = null;
let btnFinderReselect = null;
let btnFinderPick2d = null;
let reopenWizardCallback = null;
let directReselectCallback = null;

export function registerReopenWizardCallback(cb) {
  reopenWizardCallback = typeof cb === 'function' ? cb : null;
}

export function registerDirectReselectCallback(cb) {
  directReselectCallback = typeof cb === 'function' ? cb : null;
}

function ensureMissionInData(missionObj) {
  const missions = appState.finderState.data?.missions;
  if (!missionObj || !Array.isArray(missions)) return;
  if (!missions.some(m => m.mission_id === missionObj.mission_id)) {
    missions.push(missionObj);
  }
}

function formatCustomTargetLabel(planet, lat, lon, explicitLabel) {
  if (explicitLabel) return explicitLabel;
  const bodyLabel = planet === 'mars' ? 'Mars' : 'Moon';
  return `Picked ${bodyLabel} (${Number(lat).toFixed(2)}°, ${Number(lon).toFixed(2)}°)`;
}

function getDisplayedMatches(ranked) {
  if (!Array.isArray(ranked) || !ranked.length) return [];
  if (appState.finderState.showAllSites) return ranked;
  const threshold = appState.finderState.minScoreFilter || 60;
  const passing = ranked.filter(item => Number(item.topsis_score || 0) >= threshold);
  return passing.length ? passing : ranked.slice(0, Math.min(5, ranked.length));
}

async function refreshMatchForTarget(targetObj, missionId) {
  const { finderState } = appState;
  if (!targetObj || !finderState.data) return;
  const seq = ++finderState.matchReqSeq;

  if (targetObj.isCustom) {
    try {
      let payload = null;
      let sourceNote = '';
      if (!finderState.apiBase) {
        finderState.apiBase = await probeLiveBackendBase();
      }
      if (finderState.apiBase) {
        payload = await fetchBackendMatch(finderState.apiBase, {
          targetBody: targetObj.planet,
          lat: targetObj.lat,
          lon: targetObj.lon,
          missionId,
          evaluateAll: true
        });
        sourceNote = `Source: Live Backend Engine (${payload.meta?.earth_site_count || 51} Earth sites)`;
      } else {
        payload = await computePointAnalogsFromCSVs({
          targetBody: targetObj.planet,
          lat: targetObj.lat,
          lon: targetObj.lon,
          label: targetObj.target_name,
          missionId,
          evaluateAll: true
        });
        sourceNote = payload.meta?.source_mode === 'json_nearest_fallback'
          ? `Fallback: Nearest precomputed base (${payload.meta.nearest_catalog_target})`
          : `Source: Offline CSV Engine (${payload.meta?.earth_site_count || 51} Earth sites)`;
      }

      if (seq !== finderState.matchReqSeq || !payload || !Array.isArray(payload.results)) return;
      if (payload.target) {
        targetObj.features = payload.target.features || targetObj.features;
        targetObj.resolved_profile = payload.target.resolved_profile || targetObj.resolved_profile;
      }
      if (payload.mission) ensureMissionInData(payload.mission);
      if (!finderState.data.results[targetObj.target_id]) finderState.data.results[targetObj.target_id] = {};
      finderState.data.results[targetObj.target_id][missionId] = payload.results;
      finderSourceStatus.textContent = sourceNote;
      renderFinderUI(true);
    } catch (err) {
      console.warn('Custom target match failed:', err);
    }
    return;
  }

  if (!finderState.apiBase) {
    finderState.apiBase = await probeLiveBackendBase();
  }

  if (finderState.apiBase) {
    try {
      const payload = await fetchBackendMatch(finderState.apiBase, {
        targetId: targetObj.target_id,
        missionId,
        evaluateAll: true
      });
      if (seq !== finderState.matchReqSeq) return;
      if (payload && Array.isArray(payload.results)) {
        if (payload.mission) ensureMissionInData(payload.mission);
        if (!finderState.data.results[targetObj.target_id]) finderState.data.results[targetObj.target_id] = {};
        finderState.data.results[targetObj.target_id][missionId] = payload.results;
        const cnt = payload.meta && payload.meta.earth_site_count ? payload.meta.earth_site_count : '?';
        finderSourceStatus.textContent = `Source: Live Backend API (${cnt} Earth sites)`;
        renderFinderUI(true);
      }
      return;
    } catch (err) {
      console.warn('Backend /analogs/match fallback to CSV/cached data:', err);
    }
  }

  // Offline full evaluation fallback for preset targets when cached JSON only has top 10
  const cached = finderState.data.results[targetObj.target_id]?.[missionId] || [];
  if (cached.length <= 10) {
    try {
      const payload = await computePointAnalogsFromCSVs({
        targetBody: targetObj.planet,
        lat: targetObj.lat,
        lon: targetObj.lon,
        label: targetObj.target_name,
        missionId,
        evaluateAll: true,
        featuresOverride: targetObj.features
      });
      if (seq !== finderState.matchReqSeq || !payload || !Array.isArray(payload.results)) return;
      if (payload.meta?.source_mode === 'csv' && payload.results.length > cached.length) {
        if (!finderState.data.results[targetObj.target_id]) finderState.data.results[targetObj.target_id] = {};
        finderState.data.results[targetObj.target_id][missionId] = payload.results;
        finderSourceStatus.textContent = `Source: Offline CSV Engine (${payload.meta.earth_site_count} Earth sites)`;
        renderFinderUI(true);
      }
    } catch (_) {
      // Keep precomputed JSON results
    }
  }
}

export async function runMissionAnalogSearch({ targetBody, lat, lon, label, missionId, targetId = null }) {
  const { finderState } = appState;
  finderPopup.hidden = false;
  if (btnFinderMenu) btnFinderMenu.classList.add('active');
  toggleToolsMenu(false);
  bringWindowToFront(finderPopup);
  clampWindowToViewport(finderPopup);

  finderSourceStatus.textContent = 'Running backend/engine KNN -> TOPSIS across all Earth sites...';
  await ensureFinderDataLoaded(false, { autoRender: false });

  if (!finderState.data) {
    finderSourceStatus.textContent = 'Unable to load analog datasets.';
    return;
  }

  if (targetId && finderState.data.targets.some(t => t.target_id === targetId)) {
    finderState.selectedTargetId = targetId;
    finderState.selectedMissionId = missionId || finderState.selectedMissionId;
    finderState.selectedSiteId = null;
    const presetTarget = finderState.data.targets.find(t => t.target_id === targetId);
    renderFinderUI(true);
    refreshMatchForTarget(presetTarget, finderState.selectedMissionId);
    return;
  }

  const planet = String(targetBody || 'moon').toLowerCase() === 'mars' ? 'mars' : 'moon';
  const customId = `custom_${planet}`;
  const customLabel = formatCustomTargetLabel(planet, lat, lon, label);

  let customTarget = finderState.data.targets.find(t => t.target_id === customId);
  if (!customTarget) {
    customTarget = {
      target_id: customId,
      planet,
      target_name: customLabel,
      lat: Number(lat),
      lon: Number(lon),
      isCustom: true,
      features: {}
    };
    finderState.data.targets.unshift(customTarget);
  } else {
    customTarget.target_name = customLabel;
    customTarget.lat = Number(lat);
    customTarget.lon = Number(lon);
    customTarget.isCustom = true;
  }

  finderState.selectedTargetId = customId;
  finderState.selectedMissionId = missionId || finderState.selectedMissionId || (finderState.data.missions[0] && finderState.data.missions[0].mission_id);
  finderState.selectedSiteId = null;
  await refreshMatchForTarget(customTarget, finderState.selectedMissionId);
}

async function recomputeFinderFromCSVs() {
  const { finderState } = appState;
  finderSourceStatus.textContent = 'Reading backend/data CSVs and computing KNN -> TOPSIS...';
  btnFinderCsv.disabled = true;
  try {
    const bundle = await computeBundleFromCSVs();
    finderState.apiBase = null;
    finderState.data = bundle;
    finderSourceStatus.textContent = `Source: Live JS CSV (${bundle.meta.earth_site_count} Earth sites)`;
    renderFinderUI(true);
  } catch (err) {
    console.warn(err);
    finderSourceStatus.textContent = 'CSV read error (run backend or start_local.bat)';
  } finally {
    btnFinderCsv.disabled = false;
  }
}

export async function ensureFinderDataLoaded(forceRefresh = false, { autoRender = true } = {}) {
  const { finderState } = appState;
  if ((finderState.data && !forceRefresh) || finderState.loading) return;
  finderState.loading = true;
  finderSourceStatus.textContent = 'Connecting to Backend API for similarity matching...';
  try {
    const backendRes = await fetchFromBackendBundle();
    if (backendRes) {
      finderState.apiBase = backendRes.base;
      finderState.data = backendRes.json;
      const cnt = backendRes.json.meta && backendRes.json.meta.earth_site_count ? backendRes.json.meta.earth_site_count : '?';
      finderSourceStatus.textContent = `Source: Live Backend API (${cnt} Earth sites)`;
      if (autoRender) renderFinderUI(true);
      return;
    }

    const catalog = await loadMissionCatalogMetadata();
    if (catalog.source === 'csv') {
      finderSourceStatus.textContent = 'Backend offline · Computing live CSV KNN -> TOPSIS...';
      const bundle = await computeBundleFromCSVs();
      finderState.apiBase = null;
      finderState.data = bundle;
      finderSourceStatus.textContent = `Source: Live JS CSV (${bundle.meta.earth_site_count} Earth sites · ${bundle.missions.length} missions)`;
      if (autoRender) renderFinderUI(true);
      return;
    }

    finderSourceStatus.textContent = 'Backend offline · Loading analogs_results.json...';
    const json = await fetchPrecomputedAnalogsJson();
    finderState.apiBase = null;
    finderState.data = json;
    const cnt = json.meta && json.meta.earth_site_count ? json.meta.earth_site_count : '?';
    finderSourceStatus.textContent = `Source: Precomputed JSON (${cnt} Earth sites)`;
    if (autoRender) renderFinderUI(true);
  } catch (err) {
    finderState.loading = false;
    await recomputeFinderFromCSVs();
    return;
  } finally {
    finderState.loading = false;
  }
}

export function selectAnalogRankItem(item, targetObj, missionObj, shouldDrawMap = true) {
  if (!item || !targetObj || !missionObj) return;
  const { finderState } = appState;
  finderState.selectedSiteId = item.site_id;

  finderRankList.querySelectorAll('.finder-rank-item').forEach(el => {
    el.classList.toggle('active', el.dataset.siteId === item.site_id);
  });

  const barsHtml = FINDER_FEATURES.map(f => {
    const pct = item.similarity_Si && typeof item.similarity_Si[f.col] === 'number'
      ? Math.round(item.similarity_Si[f.col])
      : 0;
    const isWeak = item.weakest_factor === f.col;
    const barColor = isWeak ? '#f59e0b' : (pct >= 75 ? '#34d399' : '#38bdf8');
    const eVal = item.features && item.features[f.col] !== undefined ? item.features[f.col] : '—';
    const tVal = targetObj.features && targetObj.features[f.col] !== undefined ? targetObj.features[f.col] : '—';
    return `
      <div class="finder-bar-row">
        <span class="finder-bar-label">${escapeHtml(f.label)}${isWeak ? ' [Weakest]' : ''}</span>
        <div class="finder-bar-track"><div class="finder-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <span class="finder-bar-val">${pct}% (${eVal}${f.unit} / ${tVal}${f.unit})</span>
      </div>
    `;
  }).join('');

  const footprintLabelMap = {
    square_1km: '1 km × 1 km Grid (ISRU)',
    circle_5km: 'Circle r = 5 km (Rover)',
    circle_500m: 'Circle r = 500 m (Habitat)'
  };
  const fpLabel = footprintLabelMap[missionObj.footprint_mode] || missionObj.footprint_mode;
  const isFallback = Boolean(item.is_fallback_note);
  const geoParts = [];
  if (item.dominant_lithology && String(item.dominant_lithology).toLowerCase() !== 'unknown') {
    geoParts.push(`Lithology: ${escapeHtml(item.dominant_lithology)}`);
  }
  if (item.surface_mineral_class) {
    geoParts.push(`Mineral: ${escapeHtml(item.surface_mineral_class)}`);
  }
  if (item.elevation_m !== undefined && item.elevation_m !== null) {
    geoParts.push(`Elevation: ${item.elevation_m} m`);
  }
  const geoLineHtml = geoParts.length
    ? `<div style="font-size:10.5px;color:#94a3b8;margin-bottom:6px">${geoParts.join(' · ')}</div>`
    : '';

  finderDetailCard.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
      <strong style="font-size:12.5px;color:#e2e8f0">#${item.rank} · ${escapeHtml(item.micro_site_name)}</strong>
      <span class="finder-badge ${isFallback ? 'fallback' : 'manual'}">${isFallback ? 'Auto-Fallback' : 'Verified CSV'}</span>
    </div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:4px">
      Coords: ${Number(item.lat).toFixed(3)}°, ${Number(item.lon).toFixed(3)}° · Footprint: <strong style="color:#7dd3fc">${escapeHtml(fpLabel)}</strong>
    </div>
    ${geoLineHtml}
    ${barsHtml}
    <div style="margin-top:8px;font-size:11.5px;color:#cbd5e1;line-height:1.45">
      <strong style="color:#38bdf8">Technology to Test:</strong> ${escapeHtml(item.technology_to_test)}
    </div>
    <div style="margin-top:5px;font-size:11.5px;color:#cbd5e1;line-height:1.45">
      <strong style="color:#34d399">Why Suitable:</strong> ${escapeHtml(item.why_suitable)}
    </div>
    <div class="finder-warn-box">
      <strong>Where the Analogy Breaks Down:</strong>
      ${escapeHtml(item.analogy_limitations)}
    </div>
    <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px">
      <a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:none">Reference Source</a>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <button type="button" class="finder-recalc-btn" id="btn-finder-compare-terrain">Compare 3D Terrain</button>
        <button type="button" class="finder-recalc-btn" id="btn-finder-focus-link">Draw 3D Link &amp; 2D Footprint</button>
      </div>
    </div>
  `;

  const btnCompareTerrain = document.getElementById('btn-finder-compare-terrain');
  if (btnCompareTerrain) {
    btnCompareTerrain.addEventListener('click', () => {
      appState.lastTerrainPairSource = 'finder';
      const fp = String(missionObj.footprint_mode || 'circle_5km');
      openTerrainComparison({
        viewMode: 'compare',
        earthSite: {
          name: item.micro_site_name || item.name || 'Earth Analog',
          lat: item.lat,
          lon: item.lon,
          features: item.features
        },
        targetSite: {
          name: targetObj.target_name || targetObj.target_id,
          planet: String(targetObj.planet || 'moon').toLowerCase(),
          lat: targetObj.lat,
          lon: targetObj.lon,
          features: targetObj.features
        },
        radiusKm: fp === 'circle_5km' ? 10 : 5
      });
    });
  }

  const btnFocus = document.getElementById('btn-finder-focus-link');
  const triggerVisualSync = () => {
    const rankList = (finderState.data.results[targetObj.target_id] && finderState.data.results[targetObj.target_id][missionObj.mission_id]) || [];
    const displayed = getDisplayedMatches(rankList);
    renderTopAnalogPins(displayed, item.site_id);
    applyAnalogLink({
      earthLat: item.lat,
      earthLon: item.lon,
      targetPlanet: targetObj.planet.toLowerCase(),
      targetLat: targetObj.lat,
      targetLon: targetObj.lon,
      pairSource: 'finder'
    });
    open2DMapAt('earth', item.lat, item.lon, `#${item.rank} ${item.micro_site_name}`, missionObj.footprint_mode);
  };
  if (btnFocus) btnFocus.addEventListener('click', triggerVisualSync);

  if (shouldDrawMap) {
    triggerVisualSync();
  }
}

export function renderFinderUI(autoFocusTop1 = false) {
  const { finderState } = appState;
  const data = finderState.data;
  if (!data || !data.targets || !data.missions) return;

  if (!finderState.selectedTargetId || !data.targets.some(t => t.target_id === finderState.selectedTargetId)) {
    finderState.selectedTargetId = data.targets[0].target_id;
  }
  if (!finderState.selectedMissionId || !data.missions.some(m => m.mission_id === finderState.selectedMissionId)) {
    finderState.selectedMissionId = data.missions[0].mission_id;
  }

  finderTargetSelect.innerHTML = data.targets.map(t => `
    <option value="${escapeHtml(t.target_id)}" ${t.target_id === finderState.selectedTargetId ? 'selected' : ''}>
      [${t.planet === 'moon' ? 'Moon' : 'Mars'}] ${escapeHtml(t.target_name)} (${Number(t.lat).toFixed(2)}°, ${Number(t.lon).toFixed(2)}°)
    </option>
  `).join('');

  const targetObj = data.targets.find(t => t.target_id === finderState.selectedTargetId);
  const tFeat = (targetObj && targetObj.features) || {};
  const slopeTxt = tFeat.slope_deg !== undefined ? `${tFeat.slope_deg}°` : '—';
  const voidTxt = tFeat.has_subsurface_void !== undefined ? `void=${tFeat.has_subsurface_void}` : '';
  finderTargetBadge.textContent = targetObj ? `${targetObj.planet.toUpperCase()} · ${slopeTxt}${voidTxt ? ' · ' + voidTxt : ''}` : '';
  if (btnFinderReselect) {
    btnFinderReselect.textContent = targetObj
      ? `Reselect on ${targetObj.planet === 'mars' ? 'Mars' : 'Moon'}`
      : 'Reselect 3D';
  }

  if (finderTargetTelemetry) {
    const prof = targetObj && targetObj.resolved_profile;
    if (prof) {
      finderTargetTelemetry.hidden = false;
      const iceNote = prof.water_ice_presence ? `Ice ${prof.surface_ice_fraction_pct || 0}%` : 'Dry surface';
      finderTargetTelemetry.innerHTML = `<strong>Resolved ${escapeHtml(targetObj.planet.toUpperCase())} Profile:</strong> ${escapeHtml(String(prof.terrain_type || 'terrain').replace(/_/g, ' '))} · ${escapeHtml(String(prof.dominant_lithology || ''))} (${prof.basalt_fraction_pct ?? 0}% basalt) · Elev ${prof.elevation_m ?? 0} m · Mean ${tFeat.mean_temp_c ?? '—'}°C · ${iceNote}`;
    } else {
      finderTargetTelemetry.hidden = true;
    }
  }

  finderMissionTabs.innerHTML = data.missions.map(m => `
    <button type="button" class="finder-mission-tab ${m.mission_id === finderState.selectedMissionId ? 'active' : ''}" data-mission="${escapeHtml(m.mission_id)}">
      ${escapeHtml(m.mission_type)}
    </button>
  `).join('');

  finderMissionTabs.querySelectorAll('.finder-mission-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      finderState.selectedMissionId = btn.dataset.mission;
      finderState.selectedSiteId = null;
      renderFinderUI(true);
      refreshMatchForTarget(targetObj, finderState.selectedMissionId);
    });
  });

  const missionObj = data.missions.find(m => m.mission_id === finderState.selectedMissionId);
  const w = (missionObj && missionObj.weights) || {};
  finderWeightsStrip.textContent = `Weights: Slope ${(w.slope_deg * 100 || 0).toFixed(0)}% · Temp ${(w.mean_temp_c * 100 || 0).toFixed(0)}% · Swing ${(w.temp_swing_c * 100 || 0).toFixed(0)}% · Ice/Aridity ${(w.aridity_ice_idx * 100 || 0).toFixed(0)}% · Void ${(w.has_subsurface_void * 100 || 0).toFixed(0)}%`;

  if (btnFilterSuitable) btnFilterSuitable.classList.toggle('active', !finderState.showAllSites);
  if (btnFilterAll) btnFilterAll.classList.toggle('active', finderState.showAllSites);

  const ranked = (data.results && data.results[targetObj.target_id] && data.results[targetObj.target_id][missionObj.mission_id]) || [];
  const displayed = getDisplayedMatches(ranked);
  const threshold = finderState.minScoreFilter || 60;
  const passingCount = ranked.filter(r => Number(r.topsis_score || 0) >= threshold).length;

  if (finderResultsTitle) {
    finderResultsTitle.textContent = finderState.showAllSites
      ? `All Ranked Earth Sites (${ranked.length})`
      : (passingCount ? `Suitable Earth Sites (≥${threshold}%)` : `Top 5 Closest Earth Sites`);
  }
  finderCountLabel.textContent = `${displayed.length}/${ranked.length}`;

  finderRankList.innerHTML = displayed.map(item => `
    <div class="finder-rank-item ${item.site_id === finderState.selectedSiteId ? 'active' : ''}" data-site-id="${escapeHtml(item.site_id)}">
      <div class="finder-rank-num">#${item.rank}</div>
      <div style="flex:1;min-width:0">
        <div class="finder-rank-name">${escapeHtml(item.micro_site_name)}</div>
        <div class="finder-rank-biome">
          ${escapeHtml(item.parent_biome)}
          <span class="finder-badge ${item.is_fallback_note ? 'fallback' : 'manual'}">${item.is_fallback_note ? 'Fallback' : 'CSV'}</span>
        </div>
      </div>
      <div class="finder-score-pill">${item.topsis_score.toFixed(1)}%</div>
    </div>
  `).join('');

  finderRankList.querySelectorAll('.finder-rank-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = displayed.find(r => r.site_id === el.dataset.siteId);
      selectAnalogRankItem(item, targetObj, missionObj, true);
    });
  });

  if (displayed.length) {
    const picked = displayed.find(r => r.site_id === finderState.selectedSiteId) || displayed[0];
    renderTopAnalogPins(displayed, picked.site_id);
    selectAnalogRankItem(picked, targetObj, missionObj, autoFocusTop1);
  } else {
    finderDetailCard.innerHTML = '<div style="font-size:11.5px;color:#94a3b8">No Earth analog matches loaded yet.</div>';
  }
}

export function toggleFinderPopup(forceOpen, { skipLoad = false } = {}) {
  if (!finderPopup) return;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : finderPopup.hidden;
  finderPopup.hidden = !nextOpen;
  if (btnFinderMenu) btnFinderMenu.classList.toggle('active', nextOpen);
  if (nextOpen) {
    toggleToolsMenu(false);
    bringWindowToFront(finderPopup);
    clampWindowToViewport(finderPopup);
    if (!skipLoad) ensureFinderDataLoaded();
  }
}

export function initFinderPanel() {
  btnFinderMenu = document.getElementById('btn-finder-menu');
  finderPopup = document.getElementById('finder-popup');
  finderTargetSelect = document.getElementById('finder-target-select');
  finderTargetBadge = document.getElementById('finder-target-badge');
  finderTargetTelemetry = document.getElementById('finder-target-telemetry');
  finderMissionTabs = document.getElementById('finder-mission-tabs');
  finderWeightsStrip = document.getElementById('finder-weights-strip');
  finderResultsTitle = document.getElementById('finder-results-title');
  btnFilterSuitable = document.getElementById('btn-filter-suitable');
  btnFilterAll = document.getElementById('btn-filter-all');
  finderCountLabel = document.getElementById('finder-count-label');
  finderRankList = document.getElementById('finder-rank-list');
  finderDetailCard = document.getElementById('finder-detail-card');
  finderSourceStatus = document.getElementById('finder-source-status');
  btnFinderCsv = document.getElementById('btn-finder-csv');
  btnFinderPickGlobe = document.getElementById('btn-finder-pick-globe');
  btnFinderReselect = document.getElementById('btn-finder-reselect');
  btnFinderPick2d = document.getElementById('btn-finder-pick-2d');

  function getActiveFinderTargetContext() {
    const { finderState, missionWizardState } = appState;
    const targetObj = finderState.data && finderState.data.targets.find(t => t.target_id === finderState.selectedTargetId);
    const planet = targetObj && (targetObj.planet === 'mars' || targetObj.planet === 'moon')
      ? targetObj.planet
      : (missionWizardState.targetBody === 'mars' ? 'mars' : 'moon');
    const missionId = finderState.selectedMissionId || missionWizardState.missionId || null;
    const fallback = planet === 'mars'
      ? { lat: 18.38, lon: 77.58, label: 'Jezero Crater' }
      : { lat: -89.54, lon: 0.0, label: 'Lunar South Pole (Shackleton)' };
    return {
      planet,
      missionId,
      lat: targetObj && Number.isFinite(Number(targetObj.lat)) ? Number(targetObj.lat) : fallback.lat,
      lon: targetObj && Number.isFinite(Number(targetObj.lon)) ? Number(targetObj.lon) : fallback.lon,
      label: (targetObj && targetObj.target_name) || fallback.label
    };
  }

  makeWindowDraggable(finderPopup, finderPopup.querySelector('.finder-popup-header'));

  finderTargetSelect.addEventListener('change', () => {
    const { finderState } = appState;
    finderState.selectedTargetId = finderTargetSelect.value;
    finderState.selectedSiteId = null;
    const targetObj = finderState.data && finderState.data.targets.find(t => t.target_id === finderState.selectedTargetId);
    renderFinderUI(true);
    refreshMatchForTarget(targetObj, finderState.selectedMissionId);
  });

  if (btnFilterSuitable) {
    btnFilterSuitable.addEventListener('click', () => {
      appState.finderState.showAllSites = false;
      renderFinderUI(false);
    });
  }
  if (btnFilterAll) {
    btnFilterAll.addEventListener('click', () => {
      appState.finderState.showAllSites = true;
      renderFinderUI(false);
    });
  }
  if (btnFinderReselect) {
    btnFinderReselect.addEventListener('click', () => {
      if (!directReselectCallback) return;
      const { planet, missionId } = getActiveFinderTargetContext();
      directReselectCallback({ planet, missionId });
    });
  }
  if (btnFinderPick2d) {
    btnFinderPick2d.addEventListener('click', () => {
      const { planet, lat, lon, label } = getActiveFinderTargetContext();
      open2DMapAt(planet, lat, lon, label, null, { missionFinderHint: true });
    });
  }
  if (btnFinderPickGlobe) {
    btnFinderPickGlobe.addEventListener('click', () => {
      if (reopenWizardCallback) reopenWizardCallback();
    });
  }

  registerMap2DFinderCallback(({ planet, lat, lon, label }) => {
    const { finderState, missionWizardState } = appState;
    const missionId = finderState.selectedMissionId || missionWizardState.missionId || null;
    runMissionAnalogSearch({
      targetBody: planet,
      lat,
      lon,
      label: label || null,
      missionId
    });
  });

  registerAnalogPinClickCallback(site => {
    const { finderState } = appState;
    const data = finderState.data;
    if (!data) return;
    const targetObj = data.targets.find(t => t.target_id === finderState.selectedTargetId);
    const missionObj = data.missions.find(m => m.mission_id === finderState.selectedMissionId);
    const ranked = (targetObj && missionObj && data.results[targetObj.target_id]?.[missionObj.mission_id]) || [];
    const item = ranked.find(r => r.site_id === site.site_id);
    if (item && targetObj && missionObj) {
      toggleFinderPopup(true, { skipLoad: true });
      selectAnalogRankItem(item, targetObj, missionObj, true);
    } else {
      open2DMapAt('earth', site.lat, site.lon, site.name);
    }
  });

  btnFinderCsv.addEventListener('click', async () => {
    btnFinderCsv.disabled = true;
    try {
      const backendRes = await fetchFromBackendBundle();
      if (backendRes) {
        appState.finderState.apiBase = backendRes.base;
        appState.finderState.data = backendRes.json;
        const cnt = backendRes.json.meta && backendRes.json.meta.earth_site_count ? backendRes.json.meta.earth_site_count : '?';
        finderSourceStatus.textContent = `Source: Live Backend API (${cnt} Earth sites)`;
        renderFinderUI(true);
        return;
      }
    } finally {
      btnFinderCsv.disabled = false;
    }
    recomputeFinderFromCSVs();
  });

  btnFinderMenu.addEventListener('click', () => toggleFinderPopup());
  document.getElementById('btn-finder-close').addEventListener('click', () => toggleFinderPopup(false));
}
