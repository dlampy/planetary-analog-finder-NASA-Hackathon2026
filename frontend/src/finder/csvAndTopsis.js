import { FINDER_FEATURES } from '../config/constants.js';

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
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
      footprint_mode: missionObj.footprint_mode
    };
    Object.assign(item, resolveSiteTestFallbackJS(item, targetObj, missionObj, testExactMap, testSiteMap));
    return item;
  });

  scored.sort((a, b) => b.topsis_score - a.topsis_score || a.site_id.localeCompare(b.site_id));
  return scored.slice(0, 10).map((item, idx) => ({ rank: idx + 1, ...item }));
}
