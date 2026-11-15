import { FINDER_FEATURES } from '../config/constants.js';

const KNOWN_VOLCANIC_TUBE_SITES = new Set([
  'kilauea',
  'mount_etna',
  'galapagos_sierra_negra'
]);

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function coalesceNum(row, keys, fallback = 0) {
  for (const k of keys) {
    const raw = row?.[k];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
    }
  }
  return fallback;
}

export function formatSiteNameJS(siteId) {
  const s = String(siteId || '').trim();
  if (!s) return 'Unknown Site';
  if (!s.includes('_') && s.includes(' ')) return s;
  return s
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

export function canonicalizeLithologyJS(rawVal) {
  const s = String(rawVal || '').trim().toLowerCase();
  if (!s || s === 'nan' || s === 'none' || s === 'unknown') return 'unknown';
  const m = s.match(/major\s*:+\s*\{([^}]+)\}/i);
  const clause = m ? m[1].trim().toLowerCase() : s;
  for (const text of [clause, s]) {
    if (text.includes('anorthosit')) return 'anorthosite';
    if (text.includes('andesit')) return 'andesite';
    if (text.includes('basalt') || text.includes('mafic')) return 'basalt';
    if (text.includes('rhyolit')) return 'rhyolite';
    if (text.includes('granit')) return 'granite';
    if (text.includes('impact')) return 'impact_breccia';
    if (text.includes('volcaniclastic') || text.includes('pyroclastic') || text.includes('ash') || text.includes('tuff')) return 'volcanic_ash';
    if (text.includes('dune') || text.includes('aeolian')) return 'aeolian_dune';
    if (text.includes('evaporit') || text.includes('halite') || text.includes('gypsum')) return 'evaporite';
    if (text.includes('limestone') || text.includes('dolostone') || text.includes('carbonate') || text.includes('chalk')) return 'limestone';
    if (text.includes('conglomerate')) return 'conglomerate';
    if (text.includes('sandstone') || text.includes('quartzarenite') || text.includes('arkose') || text.includes('graywacke')) return 'sandstone';
    if (text.includes('shale') || text.includes('mudstone') || text.includes('siltstone') || text.includes('bentonite') || text.includes('clastic')) return 'shale';
    if (text.includes('siliciclastic')) return 'siliciclastic';
    if (text.includes('gneiss') || text.includes('metamorphic')) return 'gneiss';
    if (text.includes('breccia')) return 'impact_breccia';
    if (text.includes('sedimentary')) return 'sandstone';
  }
  return clause.replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}

export function canonicalizeMineralJS(rawVal) {
  const s = String(rawVal || '').trim().toLowerCase();
  if (!s || s === 'nan' || s === 'none' || s === 'unknown') return 'unknown';
  if (s.includes('volcanic') || s.includes('ash') || s.includes('pyroclastic')) return 'volcanic_ash';
  if (s.includes('phyllosilicate') || s.includes('clay')) return 'phyllosilicate';
  if (s.includes('carbonate')) return 'carbonate';
  if (s.includes('evaporite') || s.includes('halite') || s.includes('salt')) return 'evaporite';
  if (s.includes('sulfate') || s.includes('gypsum')) return 'sulfate';
  if (s.includes('oxide')) return 'oxide';
  if (s.includes('silicate')) return 'silicate';
  return s.replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'unknown';
}

export function inferSubsurfaceVoidJS(row) {
  const explicit = row?.has_subsurface_void;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const n = Number(explicit);
    if (!Number.isNaN(n)) return n >= 0.5 ? 1 : 0;
  }
  const sid = String(row?.site_id || '').trim().toLowerCase();
  if (/cave|lava_tube|cenote/.test(sid) || KNOWN_VOLCANIC_TUBE_SITES.has(sid)) {
    return 1;
  }
  return 0;
}

export function deriveAridityIceIdxJS(row) {
  const explicit = row?.aridity_ice_idx;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const n = Number(explicit);
    if (!Number.isNaN(n)) return +clamp(n, 0, 1).toFixed(4);
  }
  const iceFrac = clamp(coalesceNum(row, ['surface_ice_fraction_pct'], 0) / 100, 0, 1);
  const waterIce = coalesceNum(row, ['water_ice_presence'], 0) >= 0.5 ? 1 : 0;
  const permafrost = coalesceNum(row, ['permafrost_presence'], 0) >= 0.5 ? 1 : 0;
  const precip = Math.max(0, coalesceNum(row, ['mean_annual_precipitation_mm'], 500));
  const veg = clamp(coalesceNum(row, ['vegetation_cover_pct'], 0) / 100, 0, 1);

  const aridityComp = clamp(1 - Math.min(precip, 2000) / 2000, 0, 1) * (1 - 0.5 * veg);
  const cryoComp = Math.max(iceFrac, 0.75 * waterIce, 0.80 * permafrost);
  const combined = 0.85 * Math.max(aridityComp, cryoComp) + 0.15 * (1 - veg);
  return +clamp(combined, 0, 1).toFixed(4);
}

export function inferParentBiomeJS(row) {
  const explicit = String(row?.parent_biome || '').trim();
  if (explicit && explicit.toLowerCase() !== 'nan') return explicit;

  const sid = String(row?.site_id || '').trim().toLowerCase();
  const lith = canonicalizeLithologyJS(row?.dominant_lithology);
  const mineral = canonicalizeMineralJS(row?.surface_mineral_class);
  const voidFlag = inferSubsurfaceVoidJS(row);
  const permafrost = coalesceNum(row, ['permafrost_presence'], 0);
  const meanTemp = coalesceNum(row, ['mean_surface_temp_c', 'mean_temp_c'], 15);
  const precip = coalesceNum(row, ['mean_annual_precipitation_mm'], 500);
  const elev = coalesceNum(row, ['elevation_m'], 0);

  if (voidFlag === 1 && /cave|lava_tube|cenote/.test(sid)) {
    return ['basalt', 'andesite', 'volcanic_ash'].includes(lith)
      ? 'Volcanic Lava Tube System'
      : 'Karst Subsurface System';
  }
  if (permafrost >= 0.5 || meanTemp < -2.0) return 'Cryospheric Permafrost';
  if (precip < 180.0) {
    return (mineral === 'evaporite' || lith === 'evaporite')
      ? 'Hyper-Arid Evaporite Basin'
      : 'Hyper-Arid Desert';
  }
  if (['basalt', 'andesite', 'volcanic_ash'].includes(lith)) return 'Volcanic Basaltic Terrain';
  if (elev >= 3000.0) return 'High-Altitude Alpine';
  if (precip < 600.0) return 'Semi-Arid Sedimentary';
  if (lith === 'limestone') return 'Temperate Karst & Carbonate';
  return 'Terrestrial Geologic Analog';
}

export function preprocessEarthSiteRowJS(r) {
  const siteId = String(r.site_id || 'unknown_site').trim();
  const lat = coalesceNum(r, ['latitude_deg', 'lat'], 0);
  const lon = coalesceNum(r, ['longitude_deg', 'lon'], 0);
  const slopeDeg = coalesceNum(r, ['mean_slope_deg', 'slope_deg'], 0);
  const meanTempC = coalesceNum(r, ['mean_surface_temp_c', 'mean_temp_c'], 15);
  const thermalInertia = coalesceNum(r, ['surface_thermal_inertia', 'temp_swing_c'], 10);
  const tempSwingC = coalesceNum(r, ['temp_swing_c'], thermalInertia);
  const hasVoid = inferSubsurfaceVoidJS(r);
  const aridityIceIdx = deriveAridityIceIdxJS(r);

  const rawName = String(r.micro_site_name || r.site_name || '').trim();
  const microSiteName = (rawName && rawName.toLowerCase() !== 'nan') ? rawName : formatSiteNameJS(siteId);
  const parentBiome = inferParentBiomeJS(r);

  const lithRaw = String(r.dominant_lithology || 'unknown').trim();
  const minRaw = String(r.surface_mineral_class || 'Silicate').trim();

  return {
    site_id: siteId,
    parent_biome: parentBiome,
    micro_site_name: microSiteName,
    lat,
    lon,
    slope_deg: slopeDeg,
    mean_temp_c: meanTempC,
    temp_swing_c: Math.max(0, +tempSwingC.toFixed(4)),
    aridity_ice_idx: aridityIceIdx,
    has_subsurface_void: hasVoid,
    elevation_m: +coalesceNum(r, ['elevation_m'], 0).toFixed(1),
    terrain_roughness_m: +coalesceNum(r, ['terrain_roughness_m'], 0).toFixed(2),
    dominant_lithology: lithRaw.toLowerCase() === 'nan' ? 'unknown' : lithRaw,
    basalt_fraction_pct: +coalesceNum(r, ['basalt_fraction_pct'], 0).toFixed(1),
    surface_mineral_class: minRaw.toLowerCase() === 'nan' ? 'Silicate' : minRaw,
    surface_albedo: +coalesceNum(r, ['surface_albedo'], 0.2).toFixed(3),
    water_ice_presence: coalesceNum(r, ['water_ice_presence'], 0) >= 0.5 ? 1 : 0,
    permafrost_presence: coalesceNum(r, ['permafrost_presence'], 0) >= 0.5 ? 1 : 0
  };
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseCsvText(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(c => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some(c => c.trim() !== '')) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] ?? '').trim();
    });
    return obj;
  });
}

export function computeWeightsJS(missionRow) {
  const raw = {};
  let total = 0;
  FINDER_FEATURES.forEach(f => {
    const val = Math.max(0, parseFloat(missionRow[f.weightCol]) || 0);
    raw[f.col] = val;
    total += val;
  });
  const weights = {};
  const fallbackW = 1 / FINDER_FEATURES.length;
  FINDER_FEATURES.forEach(f => {
    weights[f.col] = total > 0 ? +(raw[f.col] / total).toFixed(6) : fallbackW;
  });
  return weights;
}

export function resolveSiteTestFallbackJS(earthItem, targetObj, missionObj, testExactMap, testSiteMap) {
  const exact = testExactMap[`${earthItem.site_id}|${missionObj.mission_id}`];
  if (exact) {
    return {
      is_fallback_note: false,
      technology_to_test: exact.technology_to_test,
      why_suitable: exact.why_suitable,
      analogy_limitations: exact.analogy_limitations,
      source_url: exact.source_url
    };
  }

  const siteOnly = testSiteMap[earthItem.site_id];
  if (siteOnly) {
    return {
      is_fallback_note: true,
      technology_to_test: missionObj.technology_to_test,
      why_suitable: `Ghi chú nền (${earthItem.micro_site_name}): ${siteOnly.why_suitable}`,
      analogy_limitations: siteOnly.analogy_limitations,
      source_url: siteOnly.source_url
    };
  }

  const si = earthItem.similarity_Si;
  const topDesc = earthItem.strongest_factors
    .map(col => {
      const meta = FINDER_FEATURES.find(f => f.col === col);
      return `${meta ? meta.label : col} (${si[col]}%)`;
    })
    .join(' và ');
  const whyParts = [
    `Thuộc vùng ${earthItem.parent_biome} (${earthItem.micro_site_name}), tương đồng nổi bật với ${targetObj.target_name} ở ${topDesc}.`
  ];
  const lith = String(earthItem.dominant_lithology || '').trim();
  const mineral = String(earthItem.surface_mineral_class || '').trim();
  if (lith && lith.toLowerCase() !== 'unknown') {
    const mineralTxt = mineral ? `nhóm khoáng ${mineral}` : 'địa chất đặc trưng';
    const basaltTxt = earthItem.basalt_fraction_pct !== undefined ? `, tỷ lệ bazan ${earthItem.basalt_fraction_pct}%` : '';
    whyParts.push(`Thành phần thạch học: ${lith} (${mineralTxt}${basaltTxt}).`);
  }
  if ((earthItem.permafrost_presence || 0) === 1) {
    whyParts.push('Có tầng đất đóng băng vĩnh cửu (permafrost) phục vụ thử nghiệm vùng cực/băng ngầm.');
  }
  if ((earthItem.features.has_subsurface_void || 0) === 1) {
    whyParts.push('Có cấu trúc hang/ống ngầm hỗ trợ thử nghiệm khảo sát và che chắn bức xạ.');
  }

  const weakMeta = FINDER_FEATURES.find(f => f.col === earthItem.weakest_factor) || FINDER_FEATURES[0];
  const planetLimits = targetObj.planet === 'moon'
    ? 'Trọng lực Trái Đất (1g) cao gấp ~6 lần Mặt Trăng (0.165g); có khí quyển 1 atm và từ trường chắn bức xạ thay vì chân không và bụi regolith sắc nhọn.'
    : 'Trọng lực Trái Đất (1g) cao gấp ~2.6 lần Sao Hỏa (0.38g); áp suất 1 atm giàu O₂/N₂ khác hẳn khí quyển 95% CO₂ loãng và bức xạ bề mặt Sao Hỏa.';

  const limitParts = [
    `Yếu tố lệch nhiều nhất: ${weakMeta.label} (chỉ đạt ${si[earthItem.weakest_factor]}% tương đồng).`,
    planetLimits
  ];
  if (earthItem.out_of_earth_bounds && earthItem.out_of_earth_bounds.length) {
    const oobStr = earthItem.out_of_earth_bounds
      .map(o => `${o.label} (${o.target_value}${o.unit})`)
      .join(', ');
    limitParts.push(`Cảnh báo ngoài ngưỡng Trái Đất tại ${targetObj.target_name}: ${oobStr}.`);
  }

  let tech = missionObj.technology_to_test;
  if ((earthItem.features.has_subsurface_void || 0) === 0 && missionObj.mission_id === 'lava_tube_habitat') {
    tech += ' (Lưu ý: điểm này không có hang ngầm tự nhiên, chỉ thử phần địa hình bề mặt/thông tin vô tuyến).';
  }

  return {
    is_fallback_note: true,
    technology_to_test: tech,
    why_suitable: whyParts.join(' '),
    analogy_limitations: limitParts.join(' '),
    source_url: targetObj.planet === 'moon'
      ? 'https://pds-geosciences.wustl.edu/missions/lro/'
      : 'https://pds.nasa.gov/'
  };
}

export function runKnnTopsisJS(targetObj, missionObj, earthSites, testExactMap, testSiteMap) {
  const weights = computeWeightsJS(missionObj);
  const spans = {};
  FINDER_FEATURES.forEach(f => { spans[f.col] = f.bounds[1] - f.bounds[0]; });

  // Stage 1: Weighted Euclidean KNN on clipped [0,1] features (top 25)
  const targetClipped = {};
  const targetUnclipped = {};
  const outOfBoundsFlags = [];
  FINDER_FEATURES.forEach(f => {
    const tVal = targetObj.features[f.col];
    const [lo, hi] = f.bounds;
    targetUnclipped[f.col] = (tVal - lo) / spans[f.col];
    targetClipped[f.col] = clamp(tVal, lo, hi) - lo;
    targetClipped[f.col] /= spans[f.col];
    if (tVal < lo || tVal > hi) {
      outOfBoundsFlags.push({
        feature: f.col,
        label: f.label,
        target_value: +tVal.toFixed(2),
        earth_range: [lo, hi],
        unit: f.unit
      });
    }
  });

  const withKnn = earthSites.map(site => {
    const earthClipped = {};
    let distSq = 0;
    FINDER_FEATURES.forEach(f => {
      const [lo, hi] = f.bounds;
      const eNorm = (clamp(site[f.col], lo, hi) - lo) / spans[f.col];
      earthClipped[f.col] = eNorm;
      const d = (eNorm - targetClipped[f.col]) * Math.sqrt(weights[f.col]);
      distSq += d * d;
    });
    return { site, earthClipped, knnDist: Math.sqrt(distSq) };
  });

  withKnn.sort((a, b) => a.knnDist - b.knnDist || a.site.site_id.localeCompare(b.site.site_id));
  const candidates = withKnn.slice(0, Math.min(25, withKnn.length));
  if (!candidates.length) return [];

  // Stage 2: Vector-normalized Analog TOPSIS on candidate deviations from unclipped target
  const diffRows = candidates.map(c => {
    const row = {};
    FINDER_FEATURES.forEach(f => {
      row[f.col] = Math.abs(c.earthClipped[f.col] - targetUnclipped[f.col]);
    });
    return row;
  });

  const colNorms = {};
  const idealWorst = {};
  FINDER_FEATURES.forEach(f => {
    let sumSq = 0;
    diffRows.forEach(r => { sumSq += r[f.col] * r[f.col]; });
    const norm = Math.sqrt(sumSq);
    colNorms[f.col] = norm < 1e-9 ? 1.0 : norm;
    idealWorst[f.col] = 0;
  });

  const weightedMatrix = diffRows.map(r => {
    const wRow = {};
    FINDER_FEATURES.forEach(f => {
      const val = (r[f.col] / colNorms[f.col]) * weights[f.col];
      wRow[f.col] = val;
      if (val > idealWorst[f.col]) idealWorst[f.col] = val;
    });
    return wRow;
  });

  const scored = candidates.map((c, idx) => {
    const wRow = weightedMatrix[idx];
    let distBestSq = 0;
    let distWorstSq = 0;
    const siMap = {};
    const earthFeatures = {};

    FINDER_FEATURES.forEach(f => {
      const v = wRow[f.col];
      distBestSq += v * v;
      distWorstSq += (v - idealWorst[f.col]) * (v - idealWorst[f.col]);
      const si = clamp(1.0 - Math.abs(targetUnclipped[f.col] - c.earthClipped[f.col]), 0, 1);
      siMap[f.col] = +(si * 100).toFixed(1);
      earthFeatures[f.col] = +Number(c.site[f.col]).toFixed(3);
    });

    const distBest = Math.sqrt(distBestSq);
    const distWorst = Math.sqrt(distWorstSq);
    const denom = distBest + distWorst;
    const closeness = denom < 1e-9 ? 1.0 : distWorst / denom;

    let weakestCol = FINDER_FEATURES[0].col;
    FINDER_FEATURES.forEach(f => {
      if (siMap[f.col] < siMap[weakestCol]) weakestCol = f.col;
    });
    const strongestCols = [...FINDER_FEATURES]
      .sort((a, b) => siMap[b.col] - siMap[a.col])
      .slice(0, 2)
      .map(f => f.col);

    const item = {
      site_id: c.site.site_id,
      parent_biome: c.site.parent_biome,
      micro_site_name: c.site.micro_site_name,
      lat: +Number(c.site.lat).toFixed(4),
      lon: +Number(c.site.lon).toFixed(4),
      topsis_score: +(closeness * 100).toFixed(1),
      features: earthFeatures,
      similarity_Si: siMap,
      weakest_factor: weakestCol,
      strongest_factors: strongestCols,
      out_of_earth_bounds: outOfBoundsFlags,
      footprint_mode: missionObj.footprint_mode,
      elevation_m: c.site.elevation_m,
      terrain_roughness_m: c.site.terrain_roughness_m,
      dominant_lithology: c.site.dominant_lithology,
      basalt_fraction_pct: c.site.basalt_fraction_pct,
      surface_mineral_class: c.site.surface_mineral_class,
      surface_albedo: c.site.surface_albedo,
      water_ice_presence: c.site.water_ice_presence,
      permafrost_presence: c.site.permafrost_presence
    };
    Object.assign(item, resolveSiteTestFallbackJS(item, targetObj, missionObj, testExactMap, testSiteMap));
    return item;
  });

  scored.sort((a, b) => b.topsis_score - a.topsis_score || a.site_id.localeCompare(b.site_id));
  return scored.slice(0, 10).map((item, idx) => ({ rank: idx + 1, ...item }));
}
