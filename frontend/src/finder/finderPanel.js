import { FINDER_FEATURES } from '../config/constants.js';
import { appState } from '../state/appState.js';
import { renderTopAnalogPins } from '../scene/markersAndArcs.js';
import { applyAnalogLink } from '../ui/infoPanel.js';
import { bringWindowToFront, clampWindowToViewport, makeWindowDraggable } from '../ui/windowManager.js';
import { toggleSettingsMenu } from '../ui/popups.js';
import { open2DMapAt } from '../map2d/leafletMap.js';
import { escapeHtml } from './csvAndTopsis.js';
import {
  computeBundleFromCSVs,
  fetchBackendMatch,
  fetchFromBackendBundle,
  fetchPrecomputedAnalogsJson
} from './finderApi.js';

// ==========================================
// 5D. PLANETARY ANALOG FINDER (KNN -> TOPSIS + FALLBACK)
// ==========================================
let btnFinderMenu = null;
let finderPopup = null;
let finderTargetSelect = null;
let finderTargetBadge = null;
let finderMissionTabs = null;
let finderWeightsStrip = null;
let finderCountLabel = null;
let finderRankList = null;
let finderDetailCard = null;
let finderSourceStatus = null;
let btnFinderCsv = null;

async function refreshMatchFromBackend(targetId, missionId) {
  const { finderState } = appState;
  if (!finderState.apiBase || !finderState.data) return;
  const seq = ++finderState.matchReqSeq;
  try {
    const payload = await fetchBackendMatch(finderState.apiBase, targetId, missionId);
    if (seq !== finderState.matchReqSeq) return;
    if (payload && Array.isArray(payload.results)) {
      if (!finderState.data.results[targetId]) finderState.data.results[targetId] = {};
      finderState.data.results[targetId][missionId] = payload.results;
      const cnt = payload.meta && payload.meta.earth_site_count ? payload.meta.earth_site_count : '?';
      finderSourceStatus.textContent = `Nguồn: Live Backend API (${cnt} điểm Earth)`;
      renderFinderUI(true);
    }
  } catch (err) {
    console.warn('Backend /analogs/match fallback to cached data:', err);
  }
}

async function recomputeFinderFromCSVs() {
  const { finderState } = appState;
  finderSourceStatus.textContent = 'Đang đọc 4 file CSV từ backend/data và tính KNN → TOPSIS...';
  btnFinderCsv.disabled = true;
  try {
    const bundle = await computeBundleFromCSVs();
    finderState.apiBase = null;
    finderState.data = bundle;
    finderSourceStatus.textContent = `Nguồn: Live JS CSV (${bundle.meta.earth_site_count} điểm Earth)`;
    renderFinderUI(true);
  } catch (err) {
    console.warn(err);
    finderSourceStatus.textContent = 'Lỗi đọc CSV (hãy chạy backend hoặc start_local.bat)';
  } finally {
    btnFinderCsv.disabled = false;
  }
}

export async function ensureFinderDataLoaded(forceRefresh = false) {
  const { finderState } = appState;
  if ((finderState.data && !forceRefresh) || finderState.loading) return;
  finderState.loading = true;
  finderSourceStatus.textContent = 'Đang kết nối Backend API để tính độ tương đồng...';
  try {
    const backendRes = await fetchFromBackendBundle();
    if (backendRes) {
      finderState.apiBase = backendRes.base;
      finderState.data = backendRes.json;
      const cnt = backendRes.json.meta && backendRes.json.meta.earth_site_count ? backendRes.json.meta.earth_site_count : '?';
      finderSourceStatus.textContent = `Nguồn: Live Backend API (${cnt} điểm Earth)`;
      renderFinderUI(true);
      return;
    }

    finderSourceStatus.textContent = 'Backend offline · Đang tải analogs_results.json...';
    const json = await fetchPrecomputedAnalogsJson();
    finderState.apiBase = null;
    finderState.data = json;
    const cnt = json.meta && json.meta.earth_site_count ? json.meta.earth_site_count : '?';
    finderSourceStatus.textContent = `Nguồn: precomputed JSON (${cnt} điểm Earth)`;
    renderFinderUI(true);
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
        <span class="finder-bar-label">${escapeHtml(f.label)}${isWeak ? ' ⚠' : ''}</span>
        <div class="finder-bar-track"><div class="finder-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <span class="finder-bar-val">${pct}% (${eVal}${f.unit} / ${tVal}${f.unit})</span>
      </div>
    `;
  }).join('');

  const footprintLabelMap = {
    square_1km: 'Ô 1 km × 1 km (ISRU)',
    circle_5km: 'Vòng tròn r = 5 km (Rover)',
    circle_500m: 'Vòng tròn r = 500 m (Habitat)'
  };
  const fpLabel = footprintLabelMap[missionObj.footprint_mode] || missionObj.footprint_mode;
  const isFallback = Boolean(item.is_fallback_note);
  const geoParts = [];
  if (item.dominant_lithology && String(item.dominant_lithology).toLowerCase() !== 'unknown') {
    geoParts.push(`Thạch học: ${escapeHtml(item.dominant_lithology)}`);
  }
  if (item.surface_mineral_class) {
    geoParts.push(`Khoáng vật: ${escapeHtml(item.surface_mineral_class)}`);
  }
  if (item.elevation_m !== undefined && item.elevation_m !== null) {
    geoParts.push(`Cao độ: ${item.elevation_m} m`);
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
      Tọa độ: ${Number(item.lat).toFixed(3)}°, ${Number(item.lon).toFixed(3)}° · Footprint: <strong style="color:#7dd3fc">${escapeHtml(fpLabel)}</strong>
    </div>
    ${geoLineHtml}
    ${barsHtml}
    <div style="margin-top:8px;font-size:11.5px;color:#cbd5e1;line-height:1.45">
      <strong style="color:#38bdf8">Công nghệ thử nghiệm:</strong> ${escapeHtml(item.technology_to_test)}
    </div>
    <div style="margin-top:5px;font-size:11.5px;color:#cbd5e1;line-height:1.45">
      <strong style="color:#34d399">Lý do phù hợp:</strong> ${escapeHtml(item.why_suitable)}
    </div>
    <div class="finder-warn-box">
      <strong>⚠ Điểm tương đồng bị phá vỡ (Where the Analogy Breaks Down):</strong>
      ${escapeHtml(item.analogy_limitations)}
    </div>
    <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;font-size:11px">
      <a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:none">Tài liệu tham khảo ↗</a>
      <button type="button" class="finder-recalc-btn" id="btn-finder-focus-link">🛰 Vẽ nối 3D &amp; 2D Footprint</button>
    </div>
  `;

  const btnFocus = document.getElementById('btn-finder-focus-link');
  const triggerVisualSync = () => {
    const rankList = finderState.data.results[targetObj.target_id][missionObj.mission_id] || [];
    renderTopAnalogPins(rankList, item.site_id);
    applyAnalogLink({
      earthLat: item.lat,
      earthLon: item.lon,
      targetPlanet: targetObj.planet.toLowerCase(),
      targetLat: targetObj.lat,
      targetLon: targetObj.lon
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
      ${t.planet === 'moon' ? '🌕' : '🔴'} ${escapeHtml(t.target_name)} (${Number(t.lat).toFixed(2)}°, ${Number(t.lon).toFixed(2)}°)
    </option>
  `).join('');

  const targetObj = data.targets.find(t => t.target_id === finderState.selectedTargetId);
  const tFeat = targetObj ? targetObj.features : {};
  finderTargetBadge.textContent = targetObj ? `${targetObj.planet.toUpperCase()} · ${tFeat.slope_deg}° · void=${tFeat.has_subsurface_void}` : '';

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
      if (finderState.apiBase) {
        refreshMatchFromBackend(finderState.selectedTargetId, finderState.selectedMissionId);
      }
    });
  });

  const missionObj = data.missions.find(m => m.mission_id === finderState.selectedMissionId);
  const w = (missionObj && missionObj.weights) || {};
  finderWeightsStrip.textContent = `Trọng số: Slope ${(w.slope_deg * 100 || 0).toFixed(0)}% · Temp ${(w.mean_temp_c * 100 || 0).toFixed(0)}% · Swing ${(w.temp_swing_c * 100 || 0).toFixed(0)}% · Ice/Aridity ${(w.aridity_ice_idx * 100 || 0).toFixed(0)}% · Void ${(w.has_subsurface_void * 100 || 0).toFixed(0)}%`;

  const ranked = (data.results && data.results[targetObj.target_id] && data.results[targetObj.target_id][missionObj.mission_id]) || [];
  finderCountLabel.textContent = `${ranked.length} điểm`;

  finderRankList.innerHTML = ranked.map(item => `
    <div class="finder-rank-item ${item.site_id === finderState.selectedSiteId ? 'active' : ''}" data-site-id="${escapeHtml(item.site_id)}">
      <div class="finder-rank-num">#${item.rank}</div>
      <div>
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
      const item = ranked.find(r => r.site_id === el.dataset.siteId);
      selectAnalogRankItem(item, targetObj, missionObj, true);
    });
  });

  if (ranked.length) {
    const picked = ranked.find(r => r.site_id === finderState.selectedSiteId) || ranked[0];
    renderTopAnalogPins(ranked, picked.site_id);
    selectAnalogRankItem(picked, targetObj, missionObj, autoFocusTop1);
  }
}

export function toggleFinderPopup(forceOpen) {
  if (!finderPopup) return;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : finderPopup.hidden;
  finderPopup.hidden = !nextOpen;
  if (btnFinderMenu) btnFinderMenu.classList.toggle('active', nextOpen);
  if (nextOpen) {
    toggleSettingsMenu(false);
    bringWindowToFront(finderPopup);
    clampWindowToViewport(finderPopup);
    ensureFinderDataLoaded();
  }
}

export function initFinderPanel() {
  btnFinderMenu = document.getElementById('btn-finder-menu');
  finderPopup = document.getElementById('finder-popup');
  finderTargetSelect = document.getElementById('finder-target-select');
  finderTargetBadge = document.getElementById('finder-target-badge');
  finderMissionTabs = document.getElementById('finder-mission-tabs');
  finderWeightsStrip = document.getElementById('finder-weights-strip');
  finderCountLabel = document.getElementById('finder-count-label');
  finderRankList = document.getElementById('finder-rank-list');
  finderDetailCard = document.getElementById('finder-detail-card');
  finderSourceStatus = document.getElementById('finder-source-status');
  btnFinderCsv = document.getElementById('btn-finder-csv');

  makeWindowDraggable(finderPopup, finderPopup.querySelector('.finder-popup-header'));

  finderTargetSelect.addEventListener('change', () => {
    const { finderState } = appState;
    finderState.selectedTargetId = finderTargetSelect.value;
    finderState.selectedSiteId = null;
    renderFinderUI(true);
    if (finderState.apiBase) {
      refreshMatchFromBackend(finderState.selectedTargetId, finderState.selectedMissionId);
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
        finderSourceStatus.textContent = `Nguồn: Live Backend API (${cnt} điểm Earth)`;
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
