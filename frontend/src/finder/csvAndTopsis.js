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

export function inferFootprintModeJS(missionRow) {
  const explicit = String(missionRow?.footprint_mode || '').trim();
  if (explicit) return explicit;
  const id = String(missionRow?.mission_id || '').toLowerCase();
  if (id.includes('subsurface') || id.includes('lava_tube')) return 'circle_500m';
  if (id.includes('rover') || id.includes('eva')) return 'circle_5km';
  return 'square_1km';
}

function numWeightJS(row, key) {
  return Math.max(0, parseFloat(row?.[key]) || 0);
}

export function computeWeightsJS(missionRow) {
  if (missionRow?.weights && typeof missionRow.weights === 'object' && FINDER_FEATURES.every(f => typeof missionRow.weights[f.col] === 'number')) {
    return missionRow.weights;
  }

  const hasLegacy5 = numWeightJS(missionRow, 'w_temp') > 0 || numWeightJS(missionRow, 'w_aridity_ice') > 0;
  let raw = {};
  if (hasLegacy5) {
    FINDER_FEATURES.forEach(f => {
      raw[f.col] = numWeightJS(missionRow, f.weightCol);
    });
  } else {
    raw = {
      slope_deg: numWeightJS(missionRow, 'w_slope') + 0.5 * numWeightJS(missionRow, 'w_roughness') + 0.2 * numWeightJS(missionRow, 'w_dust'),
      mean_temp_c: numWeightJS(missionRow, 'w_temp_mean') + 0.5 * numWeightJS(missionRow, 'w_temp_min') + 0.5 * numWeightJS(missionRow, 'w_temp_max'),
      temp_swing_c: numWeightJS(missionRow, 'w_temp_swing') + 0.5 * numWeightJS(missionRow, 'w_thermal_inertia') + 0.3 * numWeightJS(missionRow, 'w_solar'),
      aridity_ice_idx: numWeightJS(missionRow, 'w_water_ice') + numWeightJS(missionRow, 'w_ice_aridity'),
      has_subsurface_void: numWeightJS(missionRow, 'w_void')
    };
  }

  let total = 0;
  FINDER_FEATURES.forEach(f => { total += raw[f.col] || 0; });
  const weights = {};
  const fallbackW = 1 / FINDER_FEATURES.length;
  FINDER_FEATURES.forEach(f => {
    weights[f.col] = total > 0 ? +((raw[f.col] || 0) / total).toFixed(6) : fallbackW;
  });
  return weights;
}

export function resolveSiteTestFallbackJS(earthItem, targetObj, missionObj, testExactMap, testSiteMap) {
  const missionAliases = [missionObj.mission_id];
  if (missionObj.mission_id === 'isru_extraction') missionAliases.push('ground_isru');
  if (missionObj.mission_id === 'ground_isru') missionAliases.push('isru_extraction');
  if (missionObj.mission_id === 'subsurface_habitat') missionAliases.push('lava_tube_habitat');
  if (missionObj.mission_id === 'lava_tube_habitat') missionAliases.push('subsurface_habitat');

  const exactKey = missionAliases.map(mid => `${earthItem.site_id}|${mid}`).find(k => testExactMap[k]);
  const exact = exactKey ? testExactMap[exactKey] : null;
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
      why_suitable: `Base note (${earthItem.micro_site_name}): ${siteOnly.why_suitable}`,
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
    .join(' and ');
  const whyParts = [
    `Located in ${earthItem.parent_biome} (${earthItem.micro_site_name}), showing strong similarity to ${targetObj.target_name} in ${topDesc}.`
  ];
  const lith = String(earthItem.dominant_lithology || '').trim();
  const mineral = String(earthItem.surface_mineral_class || '').trim();
  if (lith && lith.toLowerCase() !== 'unknown') {
    const mineralTxt = mineral ? `${mineral} mineral class` : 'characteristic geology';
    const basaltTxt = earthItem.basalt_fraction_pct !== undefined ? `, ${earthItem.basalt_fraction_pct}% basalt` : '';
    whyParts.push(`Lithology: ${lith} (${mineralTxt}${basaltTxt}).`);
  }
  if ((earthItem.permafrost_presence || 0) === 1) {
    whyParts.push('Contains permafrost layers suitable for polar and subsurface-ice testing.');
  }
  if ((earthItem.features.has_subsurface_void || 0) === 1) {
    whyParts.push('Includes subsurface void/cave structures supporting subterranean survey and radiation-shielding trials.');
  }

  const weakMeta = FINDER_FEATURES.find(f => f.col === earthItem.weakest_factor) || FINDER_FEATURES[0];
  const planetLimits = targetObj.planet === 'moon'
    ? 'Earth gravity (1g) is ~6x stronger than the Moon (0.165g), with a 1 atm atmosphere and magnetic shielding instead of vacuum and sharp regolith dust.'
    : "Earth gravity (1g) is ~2.6x stronger than Mars (0.38g), with a 1 atm O₂/N₂ atmosphere rather than Mars' tenuous 95% CO₂ air and high surface radiation.";

  const limitParts = [
    `Weakest matching factor: ${weakMeta.label} (${si[earthItem.weakest_factor]}% similarity).`,
    planetLimits
  ];
  if (earthItem.out_of_earth_bounds && earthItem.out_of_earth_bounds.length) {
    const oobStr = earthItem.out_of_earth_bounds
      .map(o => `${o.label} (${o.target_value}${o.unit})`)
      .join(', ');
    limitParts.push(`Out-of-Earth-bounds warning at ${targetObj.target_name}: ${oobStr}.`);
  }

  let tech = missionObj.technology_to_test || missionObj.description || missionObj.mission_type || '';
  if ((earthItem.features.has_subsurface_void || 0) === 0 && (missionObj.mission_id === 'lava_tube_habitat' || missionObj.mission_id === 'subsurface_habitat')) {
    tech += ' (Note: this site has no natural subsurface void; testing is limited to surface terrain and RF propagation).';
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

const LUNAR_PITS_JS = [
  [14.08, -56.77],
  [8.33, 33.22],
  [-35.95, 166.06]
];

const MARTIAN_CAVES_JS = [
  [-9.0, -121.0],
  [0.8, -113.0]
];

export function resolvePlanetaryPointJS(body, lat, lon) {
  const cleanBody = String(body || 'moon').trim().toLowerCase() === 'mars' ? 'mars' : 'moon';
  const absLat = Math.abs(lat);
  const cosLat = Math.max(0, Math.cos((lat * Math.PI) / 180));

  if (cleanBody === 'moon') {
    const isPolarPsr = absLat >= 82.0;
    const isNearsideMare = (-20.0 <= lat && lat <= 55.0) && (-65.0 <= lon && lon <= 60.0);
    let elevationM = 1200.0;
    let slopeDeg = 5.8;
    let terrainType = 'crater_rim';
    let lithology = 'anorthosite';
    let basaltPct = 10.0;
    let meanT = 0.0;
    let minT = 0.0;
    let maxT = 0.0;
    let waterIce = 0;
    let icePct = 0.0;

    if (isPolarPsr) {
      elevationM = 1800.0;
      slopeDeg = 7.2;
      terrainType = 'crater_rim';
      lithology = 'anorthosite';
      basaltPct = 5.0;
      meanT = -205.0;
      minT = -240.0;
      maxT = -150.0;
      waterIce = 1;
      icePct = 12.0;
    } else if (isNearsideMare) {
      elevationM = -1800.0;
      slopeDeg = 2.4;
      terrainType = 'volcanic_plain';
      lithology = 'basalt';
      basaltPct = 86.0;
      maxT = -140.0 + 261.0 * Math.pow(cosLat, 0.25);
      minT = -195.0 + 22.0 * cosLat;
      meanT = 0.45 * maxT + 0.55 * minT;
    } else {
      maxT = -140.0 + 261.0 * Math.pow(cosLat, 0.25);
      minT = -195.0 + 22.0 * cosLat;
      meanT = 0.45 * maxT + 0.55 * minT;
    }

    const hasVoid = LUNAR_PITS_JS.some(([plat, plon]) => Math.hypot(lat - plat, lon - plon) <= 2.0) ? 1 : 0;
    const tempSwing = +(Math.max(0, maxT - minT)).toFixed(2);
    return {
      planet: 'moon',
      lat,
      lon,
      features: {
        slope_deg: slopeDeg,
        mean_temp_c: +meanT.toFixed(2),
        temp_swing_c: tempSwing,
        aridity_ice_idx: waterIce ? 0.99 : 0.95,
        has_subsurface_void: hasVoid
      },
      resolved_profile: {
        terrain_type: terrainType,
        dominant_lithology: lithology,
        basalt_fraction_pct: basaltPct,
        elevation_m: elevationM,
        water_ice_presence: waterIce,
        surface_ice_fraction_pct: icePct
      }
    };
  }

  const isPolarCap = absLat >= 75.0;
  const isTharsis = (-20.0 <= lat && lat <= 30.0) && (-145.0 <= lon && lon <= -90.0);
  const isLowlands = (lat > 25.0) && !isTharsis;

  let elevationM = 2000.0;
  let slopeDeg = 4.8;
  let terrainType = 'crater_rim';
  let lithology = 'impact_breccia';
  let basaltPct = 58.0;

  if (isPolarCap) {
    elevationM = lat > 0 ? -3200.0 : 2800.0;
    slopeDeg = 2.8;
    terrainType = 'polar_ice_cap';
    lithology = 'evaporite';
    basaltPct = 25.0;
  } else if (isTharsis) {
    elevationM = 8500.0;
    slopeDeg = 7.5;
    terrainType = 'volcanic_plain';
    lithology = 'basalt';
    basaltPct = 90.0;
  } else if (isLowlands) {
    elevationM = -3800.0;
    slopeDeg = 1.9;
    terrainType = 'aeolian_desert';
    lithology = 'aeolian_dune';
    basaltPct = 62.0;
  }

  const meanT = -115.0 + 62.0 * cosLat;
  const swingHalf = 36.0 * cosLat + 10.0;
  const tempSwing = +(2 * swingHalf).toFixed(2);
  const waterIce = absLat >= 45.0 ? 1 : 0;
  const icePct = waterIce ? +Math.min(95.0, (absLat - 40.0) * 2.0).toFixed(1) : 0.0;
  const hasVoid = MARTIAN_CAVES_JS.some(([plat, plon]) => Math.hypot(lat - plat, lon - plon) <= 2.5) ? 1 : 0;

  return {
    planet: 'mars',
    lat,
    lon,
    features: {
      slope_deg: slopeDeg,
      mean_temp_c: +meanT.toFixed(2),
      temp_swing_c: tempSwing,
      aridity_ice_idx: waterIce ? 0.99 : 0.95,
      has_subsurface_void: hasVoid
    },
    resolved_profile: {
      terrain_type: terrainType,
      dominant_lithology: lithology,
      basalt_fraction_pct: basaltPct,
      elevation_m: elevationM,
      water_ice_presence: waterIce,
      surface_ice_fraction_pct: icePct
    }
  };
}

export function runKnnTopsisJS(targetObj, missionObj, earthSites, testExactMap, testSiteMap, options = {}) {
  const knnK = options.evaluateAll ? earthSites.length : Math.max(1, options.knnK || 25);
  const topN = options.evaluateAll ? earthSites.length : Math.max(1, options.topN || 10);
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
  const candidates = withKnn.slice(0, Math.min(knnK, withKnn.length));
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
  return scored.slice(0, Math.min(topN, scored.length)).map((item, idx) => ({ rank: idx + 1, ...item }));
}
