const coils = [
  { width: 125, enabled: true },
  { width: 100, enabled: true },
  { width: 50, enabled: true },
  { width: 42, enabled: false },
  { width: 33.3, enabled: true },
  { width: 25, enabled: true }
];

const MAX_TABLE_LENGTH = 8;
const MAX_SCRAP_LENGTH_M = 1;
const COMMON_SCRAP_MAX_LENGTH_M = 0.4;
const COMMON_SCRAP_MAX_WIDTH_CM = 40;
const MAX_SCRAP_SUGGESTIONS = 3;
const SCRAP_PREF_KEY = 'scrapDecisionPreference';
const WIDTH_SCALE = 10; // 0.1 cm precision
const EPS = 1e-9;
const BEAM_WIDTH = 3;
const BEAM_DEPTH = 2;
const ADAPTIVE_BEAM_MIN = 2;
const ADAPTIVE_BEAM_MAX = 6;
const MAX_CANDIDATES_PER_STEP = 6;
const POST_PASS_ROUNDS = 2;

const STATE_REMAINING_WEIGHT = 0.35;
const REMNANT_POTENTIAL_WEIGHT = 0.18;
const LOCAL_REMNANT_BONUS_WEIGHT = 0.35;
const SIDE_WASTE_PENALTY_WEIGHT = 0.15;

const OPTIMIZATION_PROFILES = {
  min_waste: {
    tableCountPenalty: 0.03,
    lengthPenaltyWeight: 0.03,
    remnantFragmentPenaltyWeight: 0.02,
    compactRemnantBonusWeight: 0.05
  },
  balanced: {
    tableCountPenalty: 0.055,
    lengthPenaltyWeight: 0.08,
    remnantFragmentPenaltyWeight: 0.06,
    compactRemnantBonusWeight: 0.1
  },
  practical: {
    tableCountPenalty: 0.095,
    lengthPenaltyWeight: 0.18,
    remnantFragmentPenaltyWeight: 0.14,
    compactRemnantBonusWeight: 0.18
  }
};

const resultDiv = document.getElementById('result');
const calcBtn = document.getElementById('calcBtn');
const coilList = document.getElementById('coilList');
const partsContainer = document.getElementById('partsContainer');
const addPartBtn = document.getElementById('addPartBtn');
const optimizationModeSelect = document.getElementById('optimizationMode');

function toWidthUnits(cm) {
  return Math.round(cm * WIDTH_SCALE);
}

function fromWidthUnits(units) {
  return units / WIDTH_SCALE;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function renderCoils() {
  coilList.innerHTML = '';
  coils.forEach((coil) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = coil.enabled;
    checkbox.addEventListener('change', () => {
      coil.enabled = checkbox.checked;
    });

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${coil.width} cm`));
    coilList.appendChild(label);
  });
}

function createPartRow(width = 25, length = 3, qty = 1) {
  const row = document.createElement('div');
  row.className = 'partRow';

  const wLabel = document.createElement('label');
  wLabel.textContent = 'Sirina dijela (cm)';
  const wInput = document.createElement('input');
  wInput.type = 'number';
  wInput.className = 'partWidth';
  wInput.value = width;
  wInput.min = 0.1;
  wInput.step = 0.1;
  wLabel.appendChild(wInput);

  const lLabel = document.createElement('label');
  lLabel.textContent = 'Duzina dijela (m)';
  const lInput = document.createElement('input');
  lInput.type = 'number';
  lInput.className = 'partLength';
  lInput.value = length;
  lInput.min = 0.01;
  lInput.step = 0.01;
  lLabel.appendChild(lInput);

  const qLabel = document.createElement('label');
  qLabel.textContent = 'Kolicina';
  const qInput = document.createElement('input');
  qInput.type = 'number';
  qInput.className = 'quantity';
  qInput.value = qty;
  qInput.min = 1;
  qInput.step = 1;
  qLabel.appendChild(qInput);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'removePart';
  removeBtn.textContent = 'Ukloni';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(wLabel);
  row.appendChild(lLabel);
  row.appendChild(qLabel);
  row.appendChild(removeBtn);

  return row;
}

function bindExistingRemoveButtons() {
  const buttons = Array.from(document.querySelectorAll('.removePart'));
  buttons.forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const row = btn.closest('.partRow');
      if (row) row.remove();
    });
  });
}


function normalizePartOrientation(part) {
  const widthM = part.width / 100;
  if (widthM <= part.length + EPS) return part;

  return {
    ...part,
    width: part.length * 100,
    length: round3(widthM)
  };
}

function getPartsFromUI() {
  const rows = Array.from(document.querySelectorAll('.partRow'));
  if (rows.length === 0) {
    return { error: 'Dodajte barem jedan dio.' };
  }

  const parts = rows.map((row) => normalizePartOrientation({
    width: Number(row.querySelector('.partWidth').value),
    length: Number(row.querySelector('.partLength').value),
    qty: Number(row.querySelector('.quantity').value)
  }));

  for (const p of parts) {
    if (!Number.isFinite(p.width) || !Number.isFinite(p.length) || !Number.isFinite(p.qty)) {
      return { error: 'Unesite validne numericke vrijednosti.' };
    }
    if (!(p.width > 0) || !(p.length > 0) || !(p.qty > 0) || !Number.isInteger(p.qty)) {
      return { error: 'Svi dijelovi moraju imati pozitivne vrijednosti i cijelu kolicinu.' };
    }
    if (p.length > MAX_TABLE_LENGTH + EPS) {
      return { error: `Dio duzine ${p.length} m prelazi maksimalnu duzinu table od ${MAX_TABLE_LENGTH} m.` };
    }
  }

  return { parts };
}

function getEnabledCoils() {
  return coils
    .filter((c) => c.enabled)
    .map((c) => ({ coilWidth: c.width }))
    .sort((a, b) => a.coilWidth - b.coilWidth);
}

function buildLengthCandidates(partsRemaining) {
  const set = new Set();
  const active = partsRemaining.filter((p) => p.qty > 0);

  active.forEach((p) => {
    const maxK = Math.max(1, Math.floor((MAX_TABLE_LENGTH + EPS) / p.length));
    for (let k = 1; k <= maxK; k++) {
      const len = round3(p.length * k);
      if (len <= MAX_TABLE_LENGTH + EPS) {
        set.add(len.toFixed(3));
      }
    }
  });

  set.add(MAX_TABLE_LENGTH.toFixed(3));

  return Array.from(set)
    .map((x) => Number(x))
    .filter((x) => x > 0)
    .sort((a, b) => a - b);
}

function clonePattern(pattern) {
  if (!pattern) return null;
  return {
    ...pattern,
    strips: pattern.strips.map((s) => ({ ...s }))
  };
}

function cloneCandidateEntry(entry) {
  return {
    pattern: clonePattern(entry.pattern),
    metrics: { ...entry.metrics }
  };
}

function buildPartsSignature(partsRemaining) {
  return partsRemaining.map((p) => p.qty).join(',');
}

function computeRemainingAreaCm(partsRemaining) {
  return partsRemaining.reduce((sum, p) => sum + (p.qty * p.width * p.length), 0);
}

function getRemainingAfterPattern(partsRemaining, pattern) {
  const remaining = partsRemaining.map((p) => ({ ...p }));
  pattern.strips.forEach((s) => {
    remaining[s.partIndex].qty = Math.max(0, remaining[s.partIndex].qty - s.produced);
  });
  return remaining;
}

function buildPatternRemnantRectangles(pattern) {
  const rectangles = [];

  pattern.strips.forEach((s) => {
    const fullStrips = Math.floor(s.produced / s.pps);
    let remainder = s.produced % s.pps;

    for (let i = 0; i < s.strips; i++) {
      let piecesInStrip = 0;
      if (i < fullStrips) {
        piecesInStrip = s.pps;
      } else if (i === fullStrips && remainder > 0) {
        piecesInStrip = remainder;
        remainder = 0;
      }

      const usedLength = piecesInStrip * s.partLength;
      const remLength = pattern.maxLength - usedLength;
      if (remLength > EPS) {
        rectangles.push({ width: s.width, length: remLength });
      }
    }
  });

  if (pattern.remainingWidth > EPS) {
    rectangles.push({ width: pattern.remainingWidth, length: pattern.maxLength });
  }

  return rectangles;
}

function estimateReusableAreaFromRectangles(rectangles, partsRemaining) {
  if (rectangles.length === 0) return 0;
  const tempDemand = partsRemaining.map((p) => ({ ...p }));
  let reusableArea = 0;

  const sortedRects = rectangles
    .filter((r) => r.width > EPS && r.length > EPS)
    .slice()
    .sort((a, b) => (b.width * b.length) - (a.width * a.length));

  sortedRects.forEach((rect) => {
    let bestIdx = -1;
    let bestTake = 0;
    let bestArea = 0;

    for (let i = 0; i < tempDemand.length; i++) {
      const p = tempDemand[i];
      if (p.qty <= 0) continue;
      if (p.width > rect.width + EPS || p.length > rect.length + EPS) continue;

      const maxByLength = Math.floor((rect.length + EPS) / p.length);
      if (maxByLength <= 0) continue;
      const take = Math.min(p.qty, maxByLength);
      if (take <= 0) continue;

      const area = take * p.width * p.length;
      if (area > bestArea + EPS) {
        bestIdx = i;
        bestTake = take;
        bestArea = area;
      }
    }

    if (bestIdx !== -1) {
      tempDemand[bestIdx].qty -= bestTake;
      reusableArea += bestArea;
    }
  });

  return reusableArea;
}

function estimateReusableAreaFromRemnantStrips(remnantStrips, partsRemaining) {
  const rectangles = remnantStrips
    .map((r) => ({ width: r.strip.width, length: r.strip.remainingLength }))
    .filter((r) => r.width > EPS && r.length > EPS);
  return estimateReusableAreaFromRectangles(rectangles, partsRemaining);
}

function cloneRemnantStrips(remnantStrips) {
  return remnantStrips.map((r) => ({
    order: r.order,
    strip: {
      width: r.strip.width,
      remainingLength: r.strip.remainingLength,
      cuts: r.strip.cuts.map((c) => ({ ...c }))
    }
  }));
}

function cloneSolverState(state) {
  return {
    partsRemaining: state.partsRemaining.map((p) => ({ ...p })),
    remnantStrips: cloneRemnantStrips(state.remnantStrips),
    remnantOrder: state.remnantOrder,
    openedAreaCm: state.openedAreaCm,
    tableCount: state.tableCount
  };
}

function buildBestPatternForCoilAndLength(partsRemaining, coilWidth, tableLength, dpCache) {
  const coilUnits = toWidthUnits(coilWidth);
  const cacheKey = `${coilUnits}|${tableLength.toFixed(3)}|${buildPartsSignature(partsRemaining)}`;
  if (dpCache && dpCache.has(cacheKey)) {
    return clonePattern(dpCache.get(cacheKey));
  }

  const stripItems = [];

  for (let idx = 0; idx < partsRemaining.length; idx++) {
    const p = partsRemaining[idx];
    if (p.qty <= 0) continue;
    if (p.length > tableLength + EPS) continue;

    const widthUnits = toWidthUnits(p.width);
    if (widthUnits <= 0 || widthUnits > coilUnits) continue;

    const pps = Math.floor((tableLength + EPS) / p.length);
    if (pps <= 0) continue;

    const maxByDemand = Math.ceil(p.qty / pps);
    const maxByWidth = Math.floor(coilUnits / widthUnits);
    const maxStrips = Math.min(maxByDemand, maxByWidth);
    if (maxStrips <= 0) continue;

    let producedSoFar = 0;
    for (let s = 1; s <= maxStrips; s++) {
      const producedAfter = Math.min(s * pps, p.qty);
      const deltaPieces = producedAfter - producedSoFar;
      producedSoFar = producedAfter;
      if (deltaPieces <= 0) break;

      stripItems.push({
        partIdx: idx,
        weight: widthUnits,
        value: deltaPieces * p.width * p.length
      });
    }
  }

  if (stripItems.length === 0) {
    if (dpCache) dpCache.set(cacheKey, null);
    return null;
  }

  const dp = new Array(coilUnits + 1).fill(-Infinity);
  const prevWidth = new Array(coilUnits + 1).fill(-1);
  const prevItem = new Array(coilUnits + 1).fill(-1);
  dp[0] = 0;

  for (let i = 0; i < stripItems.length; i++) {
    const item = stripItems[i];
    for (let w = coilUnits; w >= item.weight; w--) {
      const base = dp[w - item.weight];
      if (base === -Infinity) continue;

      const cand = base + item.value;
      if (cand > dp[w] + EPS) {
        dp[w] = cand;
        prevWidth[w] = w - item.weight;
        prevItem[w] = i;
      }
    }
  }

  let bestWidth = -1;
  let bestValue = -Infinity;
  for (let w = 0; w <= coilUnits; w++) {
    if (dp[w] > bestValue + EPS) {
      bestValue = dp[w];
      bestWidth = w;
    } else if (Math.abs(dp[w] - bestValue) < EPS && w > bestWidth) {
      bestWidth = w;
    }
  }

  if (bestWidth < 0 || bestValue <= EPS) {
    if (dpCache) dpCache.set(cacheKey, null);
    return null;
  }

  const stripCountByPart = new Map();
  let widthCursor = bestWidth;
  while (widthCursor > 0 && prevItem[widthCursor] !== -1) {
    const itemIdx = prevItem[widthCursor];
    const item = stripItems[itemIdx];
    stripCountByPart.set(item.partIdx, (stripCountByPart.get(item.partIdx) || 0) + 1);
    widthCursor = prevWidth[widthCursor];
  }

  if (stripCountByPart.size === 0) {
    if (dpCache) dpCache.set(cacheKey, null);
    return null;
  }

  const strips = [];
  let producedArea = 0;
  let usedWidthUnits = 0;
  let producedPieces = 0;

  stripCountByPart.forEach((stripCount, partIdx) => {
    const part = partsRemaining[partIdx];
    const pps = Math.floor((tableLength + EPS) / part.length);
    const produced = Math.min(stripCount * pps, part.qty);
    if (produced <= 0) return;

    strips.push({
      partIndex: partIdx,
      width: part.width,
      partLength: part.length,
      strips: stripCount,
      pps,
      produced
    });

    usedWidthUnits += stripCount * toWidthUnits(part.width);
    producedArea += produced * part.width * part.length;
    producedPieces += produced;
  });

  if (strips.length === 0) {
    if (dpCache) dpCache.set(cacheKey, null);
    return null;
  }

  const remainingWidth = fromWidthUnits(Math.max(0, coilUnits - usedWidthUnits));
  const totalArea = coilWidth * tableLength;
  const wasteArea = totalArea - producedArea;
  const producedByPart = new Map(strips.map((s) => [s.partIndex, s.produced]));
  const finishesAll = partsRemaining.every((p, idx) => {
    if (p.qty <= 0) return true;
    return (producedByPart.get(idx) || 0) >= p.qty;
  });
  const wastePerProduced = wasteArea / Math.max(producedArea, EPS);

  const pattern = {
    coilWidth,
    maxLength: tableLength,
    remainingWidth,
    strips,
    producedArea,
    wasteArea,
    producedPieces,
    finishesAll,
    wastePerProduced
  };

  if (dpCache) dpCache.set(cacheKey, pattern);
  return clonePattern(pattern);
}

function getOptimizationProfile(mode) {
  return OPTIMIZATION_PROFILES[mode] || OPTIMIZATION_PROFILES.balanced;
}

function computePatternShapeMetrics(pattern) {
  const remnantRects = buildPatternRemnantRectangles(pattern)
    .filter((r) => r.width > EPS && r.length > EPS);

  const remnantAreas = remnantRects.map((r) => r.width * r.length);
  const totalRemnantArea = remnantAreas.reduce((sum, area) => sum + area, 0);
  const largestRemnantArea = remnantAreas.length > 0 ? Math.max(...remnantAreas) : 0;
  const normalizedFragmentation = remnantRects.length <= 1
    ? 0
    : (remnantRects.length - 1) / Math.max(1, pattern.strips.length + 1);
  const compactnessRatio = totalRemnantArea <= EPS ? 1 : (largestRemnantArea / totalRemnantArea);

  return {
    remnantRectCount: remnantRects.length,
    normalizedFragmentation,
    compactnessRatio,
    largestRemnantArea
  };
}

function buildTableCandidates(partsRemaining, enabledCoils, dpCache, profile, limit = MAX_CANDIDATES_PER_STEP, candidatesCache = null) {
  const partsSignature = buildPartsSignature(partsRemaining);
  if (candidatesCache && candidatesCache.has(partsSignature)) {
    return candidatesCache.get(partsSignature)
      .slice(0, limit)
      .map((entry) => cloneCandidateEntry(entry));
  }

  const lengthCandidates = buildLengthCandidates(partsRemaining);
  const candidateEntries = [];

  enabledCoils.forEach((coil) => {
    lengthCandidates.forEach((tableLength) => {
      const pattern = buildBestPatternForCoilAndLength(partsRemaining, coil.coilWidth, tableLength, dpCache);
      if (!pattern) return;

      const remainingAfterPattern = getRemainingAfterPattern(partsRemaining, pattern);
      const remnantRects = buildPatternRemnantRectangles(pattern);
      const usefulRemnantArea = estimateReusableAreaFromRectangles(remnantRects, remainingAfterPattern);
      const sideWasteArea = pattern.remainingWidth * pattern.maxLength;
      const shapeMetrics = computePatternShapeMetrics(pattern);
      const lengthPenalty = profile.lengthPenaltyWeight * (pattern.maxLength / MAX_TABLE_LENGTH);
      const fragmentationPenalty = profile.remnantFragmentPenaltyWeight * shapeMetrics.normalizedFragmentation;
      const compactRemnantBonus = profile.compactRemnantBonusWeight * shapeMetrics.compactnessRatio;
      const adjustedWastePerProduced =
        ((pattern.wasteArea + (SIDE_WASTE_PENALTY_WEIGHT * sideWasteArea) - (LOCAL_REMNANT_BONUS_WEIGHT * usefulRemnantArea)) /
        Math.max(pattern.producedArea, EPS)) +
        lengthPenalty +
        fragmentationPenalty -
        compactRemnantBonus;

      candidateEntries.push({
        pattern,
        metrics: {
          usefulRemnantArea,
          sideWasteArea,
          adjustedWastePerProduced,
          shapeMetrics
        }
      });
    });
  });

  candidateEntries.sort((a, b) => {
    const pa = a.pattern;
    const pb = b.pattern;

    if (pa.finishesAll !== pb.finishesAll) return pa.finishesAll ? -1 : 1;
    if (Math.abs(a.metrics.adjustedWastePerProduced - b.metrics.adjustedWastePerProduced) > EPS) {
      return a.metrics.adjustedWastePerProduced - b.metrics.adjustedWastePerProduced;
    }
    if (Math.abs(a.metrics.usefulRemnantArea - b.metrics.usefulRemnantArea) > EPS) {
      return b.metrics.usefulRemnantArea - a.metrics.usefulRemnantArea;
    }
    if (Math.abs(pa.producedArea - pb.producedArea) > EPS) return pb.producedArea - pa.producedArea;
    if (Math.abs(pa.wasteArea - pb.wasteArea) > EPS) return pa.wasteArea - pb.wasteArea;
    return pa.remainingWidth - pb.remainingWidth;
  });

  const trimmed = candidateEntries.slice(0, Math.max(limit, MAX_CANDIDATES_PER_STEP));
  if (candidatesCache) {
    candidatesCache.set(partsSignature, trimmed.map((entry) => cloneCandidateEntry(entry)));
  }

  return trimmed.slice(0, limit).map((entry) => cloneCandidateEntry(entry));
}

function buildBestTable(partsRemaining, enabledCoils, dpCache, profile, candidatesCache) {
  const candidates = buildTableCandidates(partsRemaining, enabledCoils, dpCache, profile, 1, candidatesCache);
  return candidates.length > 0 ? candidates[0].pattern : null;
}

function scoreSolverState(state, totalRequiredAreaCm, profile) {
  const remainingArea = computeRemainingAreaCm(state.partsRemaining);
  const producedArea = Math.max(0, totalRequiredAreaCm - remainingArea);
  const wasteSoFar = Math.max(0, state.openedAreaCm - producedArea);
  const remnantPotential = estimateReusableAreaFromRemnantStrips(state.remnantStrips, state.partsRemaining);

  const norm = Math.max(totalRequiredAreaCm, EPS);
  const normalizedWaste = wasteSoFar / norm;
  const normalizedRemaining = remainingArea / norm;
  const normalizedPotential = remnantPotential / norm;

  return normalizedWaste +
    (STATE_REMAINING_WEIGHT * normalizedRemaining) +
    (profile.tableCountPenalty * state.tableCount) -
    (REMNANT_POTENTIAL_WEIGHT * normalizedPotential);
}

function computeAdaptiveBeamWidth(partsRemaining, remnantStrips) {
  const activePartKinds = partsRemaining.reduce((sum, p) => sum + (p.qty > 0 ? 1 : 0), 0);
  const remnantPressure = Math.min(3, Math.floor(remnantStrips.length / 4));
  const dynamicWidth = BEAM_WIDTH + Math.floor(activePartKinds / 2) + remnantPressure;
  return Math.max(ADAPTIVE_BEAM_MIN, Math.min(ADAPTIVE_BEAM_MAX, dynamicWidth));
}


function chooseNextTableByBeam(baseState, enabledCoils, dpCache, totalRequiredAreaCm, profile, candidatesCache) {
  const beamWidth = computeAdaptiveBeamWidth(baseState.partsRemaining, baseState.remnantStrips);
  let frontier = [{ state: cloneSolverState(baseState), firstPattern: null, score: Infinity }];

  for (let depth = 0; depth < BEAM_DEPTH; depth++) {
    const expanded = [];

    frontier.forEach((node) => {
      placePartsIntoRemnants(node.state.partsRemaining, node.state.remnantStrips);
      if (!node.state.partsRemaining.some((p) => p.qty > 0)) {
        expanded.push({
          state: node.state,
          firstPattern: node.firstPattern,
          score: scoreSolverState(node.state, totalRequiredAreaCm, profile)
        });
        return;
      }

      const candidates = buildTableCandidates(
        node.state.partsRemaining,
        enabledCoils,
        dpCache,
        profile,
        MAX_CANDIDATES_PER_STEP,
        candidatesCache
      );
      candidates.forEach((entry) => {
        const childState = cloneSolverState(node.state);
        applyTable(childState.partsRemaining, entry.pattern);
        childState.openedAreaCm += entry.pattern.coilWidth * entry.pattern.maxLength;
        childState.tableCount += 1;

        const materialized = materializeTableFromPattern(entry.pattern);
        registerRemnantsForState(materialized, childState);

        expanded.push({
          state: childState,
          firstPattern: node.firstPattern || entry.pattern,
          score: scoreSolverState(childState, totalRequiredAreaCm, profile) + entry.metrics.adjustedWastePerProduced
        });
      });
    });

    if (expanded.length === 0) break;
    expanded.sort((a, b) => a.score - b.score);
    frontier = expanded.slice(0, beamWidth);
  }

  if (frontier.length === 0) return null;
  frontier.sort((a, b) => a.score - b.score);
  return frontier[0].firstPattern || null;
}

function applyTable(partsRemaining, table) {
  table.strips.forEach((s) => {
    partsRemaining[s.partIndex].qty -= s.produced;
  });
}

function materializeTableFromPattern(tablePattern) {
  const stripInstances = [];

  tablePattern.strips.forEach((s) => {
    const fullStrips = Math.floor(s.produced / s.pps);
    let remainder = s.produced % s.pps;

    for (let i = 0; i < s.strips; i++) {
      let piecesInStrip = 0;
      if (i < fullStrips) {
        piecesInStrip = s.pps;
      } else if (i === fullStrips && remainder > 0) {
        piecesInStrip = remainder;
        remainder = 0;
      }

      const cuts = [];
      for (let p = 0; p < piecesInStrip; p++) {
        cuts.push({
          partIndex: s.partIndex,
          width: s.width,
          length: s.partLength
        });
      }

      const usedLength = piecesInStrip * s.partLength;
      stripInstances.push({
        width: s.width,
        cuts,
        remainingLength: Math.max(0, tablePattern.maxLength - usedLength)
      });
    }
  });

  const usedMainWidth = stripInstances.reduce((sum, s) => sum + s.width, 0);
  const sideWidth = Math.max(0, tablePattern.coilWidth - usedMainWidth);
  const sideStripInstance = sideWidth > EPS
    ? {
      width: sideWidth,
      cuts: [],
      remainingLength: tablePattern.maxLength
    }
    : null;

  return {
    coilWidth: tablePattern.coilWidth,
    maxLength: tablePattern.maxLength,
    stripInstances,
    sideStripInstance
  };
}

function registerRemnantsFromTable(table, remnantStrips, nextOrderRef) {
  const pool = table.sideStripInstance
    ? table.stripInstances.concat([table.sideStripInstance])
    : table.stripInstances;

  pool.forEach((strip) => {
    if (strip.remainingLength > EPS) {
      remnantStrips.push({
        strip,
        order: nextOrderRef.value++
      });
    }
  });
}

function registerRemnantsForState(table, state) {
  const nextOrderRef = { value: state.remnantOrder };
  registerRemnantsFromTable(table, state.remnantStrips, nextOrderRef);
  state.remnantOrder = nextOrderRef.value;
}

function findBestRemnantIndex(remnantStrips, part) {
  let bestIdx = -1;
  let bestWidthDiff = Infinity;
  let bestRemainingLen = Infinity;
  let bestOrder = Infinity;

  for (let i = 0; i < remnantStrips.length; i++) {
    const rem = remnantStrips[i];
    if (rem.strip.width + EPS < part.width) continue;
    if (rem.strip.remainingLength + EPS < part.length) continue;

    const widthDiff = rem.strip.width - part.width;
    const remainingLenAfter = rem.strip.remainingLength - part.length;

    if (
      widthDiff < bestWidthDiff - EPS ||
      (Math.abs(widthDiff - bestWidthDiff) < EPS && remainingLenAfter < bestRemainingLen - EPS) ||
      (Math.abs(widthDiff - bestWidthDiff) < EPS &&
        Math.abs(remainingLenAfter - bestRemainingLen) < EPS &&
        rem.order < bestOrder)
    ) {
      bestIdx = i;
      bestWidthDiff = widthDiff;
      bestRemainingLen = remainingLenAfter;
      bestOrder = rem.order;
    }
  }

  return bestIdx;
}

function placePartsIntoRemnants(partsRemaining, remnantStrips) {
  let placedAny = false;

  while (true) {
    const candidates = partsRemaining
      .map((p, idx) => ({
        idx,
        width: p.width,
        length: p.length,
        qty: p.qty
      }))
      .filter((p) => p.qty > 0)
      .sort((a, b) => b.width - a.width || b.length - a.length);

    let placedOne = false;

    for (const c of candidates) {
      const remIdx = findBestRemnantIndex(remnantStrips, c);
      if (remIdx === -1) continue;

      const rem = remnantStrips[remIdx];
      rem.strip.cuts.push({
        partIndex: c.idx,
        width: c.width,
        length: c.length
      });
      rem.strip.remainingLength = Math.max(0, rem.strip.remainingLength - c.length);
      partsRemaining[c.idx].qty -= 1;

      if (rem.strip.remainingLength <= EPS) {
        remnantStrips.splice(remIdx, 1);
      }

      placedOne = true;
      placedAny = true;
      break;
    }

    if (!placedOne) break;
  }

  return placedAny;
}

function formatStripInstance(strip) {
  if (strip.cuts.length === 0) {
    return `${strip.width}cm`;
  }

  const cuts = strip.cuts.map((c) => {
    if (Math.abs(c.width - strip.width) < EPS) {
      return `${c.length.toFixed(2)}m`;
    }
    return `${c.width}cmx${c.length.toFixed(2)}m`;
  }).join('+');

  return `${strip.width}cm (${cuts})`;
}

function getTableStats(table, coilWidth) {
  const usedWidth = table.stripInstances.reduce((sum, s) => sum + s.width, 0);
  const remainingWidth = Math.max(0, coilWidth - usedWidth);

  let piecesCount = 0;
  let producedAreaCm2 = 0;
  const allStrips = table.sideStripInstance
    ? table.stripInstances.concat([table.sideStripInstance])
    : table.stripInstances;

  allStrips.forEach((strip) => {
    piecesCount += strip.cuts.length;
    strip.cuts.forEach((cut) => {
      producedAreaCm2 += cut.width * cut.length;
    });
  });

  return {
    usedWidth,
    remainingWidth,
    piecesCount,
    producedAreaCm2
  };
}

function renderResult(coilsResult, originalParts) {
  let html = '<b>Algoritam:</b> Beam + DP cache + iskoristenje ostataka traka (max 8m)<br><br>';

  let totalWasteM2 = 0;
  let totalTableAreaM2 = 0;
  let totalProducedAreaM2 = 0;

  coilsResult
    .sort((a, b) => a.coilWidth - b.coilWidth)
    .forEach((group) => {
      if (group.tables.length === 0) return;

      html += `<b>Lim:</b> ${group.coilWidth} cm<br>`;

      group.tables.forEach((t, idx) => {
        const displayStrips = t.sideStripInstance && t.sideStripInstance.cuts.length > 0
          ? t.stripInstances.concat([t.sideStripInstance])
          : t.stripInstances;
        const stripLines = displayStrips.map((s) => formatStripInstance(s));

        const widthsHtml = stripLines
          .map((line) => {
            const m = line.match(/^([^\(]+)\s*\(([^)]+)\)/);
            if (!m) return `<div class="width-line">${line}</div>`;
            return `<div class="width-line">${m[1].trim()}<span class="cuts">(${m[2]})</span></div>`;
          })
          .join('');

        const stats = getTableStats(t, group.coilWidth);
        const tableAreaM2 = (group.coilWidth / 100) * t.maxLength;
        const producedAreaM2 = stats.producedAreaCm2 / 100;
        const wasteAreaM2 = Math.max(0, tableAreaM2 - producedAreaM2);

        totalTableAreaM2 += tableAreaM2;
        totalProducedAreaM2 += producedAreaM2;
        totalWasteM2 += wasteAreaM2;

        html += `Tabela ${idx + 1}:<br>`;
        html += `<div class="table-visual"><div class="widths">${widthsHtml}</div><div class="bracket"><div class="bar" aria-hidden="true"></div><div class="table-length">${t.maxLength.toFixed(2)}m</div></div></div>`;
        html += `Komada: ${stats.piecesCount}, neiskoristena sirina: ${stats.remainingWidth.toFixed(1)} cm, otpad: ${wasteAreaM2.toFixed(3)} m2<br>`;
      });

      html += '<br>';
    });

  const requiredAreaM2 = originalParts.reduce((sum, p) => sum + (p.width / 100) * p.length * p.qty, 0);

  html += `<b>Potrebna povrsina dijelova:</b> ${requiredAreaM2.toFixed(3)} m2<br>`;
  html += `<b>Ukupna povrsina otvorenih tabli:</b> ${totalTableAreaM2.toFixed(3)} m2<br>`;
  html += `<b>Procijenjeno iskoristeno:</b> ${totalProducedAreaM2.toFixed(3)} m2<br>`;
  html += `<b>Ukupni otpad:</b> ${totalWasteM2.toFixed(3)} m2`;

  return html;
}

function getTableWasteAreaCm(table, coilWidth) {
  const stats = getTableStats(table, coilWidth);
  return Math.max(0, (coilWidth * table.maxLength) - stats.producedAreaCm2);
}

function collectTableRefs(coilsResult) {
  const refs = [];
  coilsResult.forEach((group) => {
    group.tables.forEach((table, tableIdx) => {
      refs.push({
        group,
        table,
        tableIdx,
        wasteAreaCm: getTableWasteAreaCm(table, group.coilWidth),
        producedAreaCm: getTableStats(table, group.coilWidth).producedAreaCm2
      });
    });
  });
  return refs;
}

function buildRemnantsFromExistingTablesExcept(coilsResult, skippedTable) {
  const remnantStrips = [];
  const nextOrderRef = { value: 0 };

  coilsResult.forEach((group) => {
    group.tables.forEach((table) => {
      if (table === skippedTable) return;
      registerRemnantsFromTable(table, remnantStrips, nextOrderRef);
    });
  });

  return remnantStrips;
}

function extractCutsFromTable(table) {
  const cuts = [];
  table.stripInstances.forEach((strip) => {
    strip.cuts.forEach((cut) => {
      cuts.push({ ...cut });
    });
  });
  if (table.sideStripInstance) {
    table.sideStripInstance.cuts.forEach((cut) => {
      cuts.push({ ...cut });
    });
  }
  return cuts;
}

function tryPlaceCutsIntoRemnants(cuts, remnantStrips) {
  const orderedCuts = cuts.slice().sort((a, b) => b.width - a.width || b.length - a.length);

  for (const cut of orderedCuts) {
    const remIdx = findBestRemnantIndex(remnantStrips, cut);
    if (remIdx === -1) return false;

    const rem = remnantStrips[remIdx];
    rem.strip.cuts.push({ ...cut });
    rem.strip.remainingLength = Math.max(0, rem.strip.remainingLength - cut.length);

    if (rem.strip.remainingLength <= EPS) {
      remnantStrips.splice(remIdx, 1);
    }
  }

  return true;
}

function runPostOptimization(coilsResult) {
  for (let round = 0; round < POST_PASS_ROUNDS; round++) {
    let removed = false;

    const tableRefs = collectTableRefs(coilsResult).sort((a, b) => {
      if (Math.abs(a.wasteAreaCm - b.wasteAreaCm) > EPS) return b.wasteAreaCm - a.wasteAreaCm;
      return a.producedAreaCm - b.producedAreaCm;
    });

    for (const ref of tableRefs) {
      const cuts = extractCutsFromTable(ref.table);
      if (cuts.length === 0) {
        ref.group.tables.splice(ref.tableIdx, 1);
        removed = true;
        break;
      }

      const actualRemnants = buildRemnantsFromExistingTablesExcept(coilsResult, ref.table);
      const simulatedRemnants = cloneRemnantStrips(actualRemnants);
      if (!tryPlaceCutsIntoRemnants(cuts, simulatedRemnants)) continue;

      tryPlaceCutsIntoRemnants(cuts, actualRemnants);
      ref.group.tables.splice(ref.tableIdx, 1);
      removed = true;
      break;
    }

    if (!removed) break;
  }
}

function findUnplaceablePart(partsRemaining, enabledCoils) {
  const maxCoilWidth = Math.max(...enabledCoils.map((c) => c.coilWidth));
  return partsRemaining.find((p) => p.qty > 0 && (p.width > maxCoilWidth + EPS || p.length > MAX_TABLE_LENGTH + EPS));
}

function solveCutPlan(partsInput, enabledCoils, originalPartsReference = null) {
  const originalParts = originalPartsReference
    ? originalPartsReference.map((p) => ({ ...p }))
    : partsInput.map((p) => ({ ...p }));
  const coilsResult = enabledCoils.map((c) => ({ coilWidth: c.coilWidth, tables: [] }));
  const totalRequiredAreaCm = computeRemainingAreaCm(partsInput);
  const dpCache = new Map();
  const candidatesCache = new Map();

  const solverState = {
    partsRemaining: partsInput.map((p) => ({ ...p })),
    remnantStrips: [],
    remnantOrder: 0,
    openedAreaCm: 0,
    tableCount: 0
  };

  let guard = 0;
  while (solverState.partsRemaining.some((p) => p.qty > 0)) {
    guard += 1;
    if (guard > 5000) {
      return {
        error: 'Greska: Prekinuto zbog previse iteracija (provjerite ulazne podatke).'
      };
    }

    placePartsIntoRemnants(solverState.partsRemaining, solverState.remnantStrips);
    if (!solverState.partsRemaining.some((p) => p.qty > 0)) break;

    const bestTable = chooseNextTableByBeam(
      solverState,
      enabledCoils,
      dpCache,
      totalRequiredAreaCm,
      profile,
      candidatesCache
    ) || buildBestTable(solverState.partsRemaining, enabledCoils, dpCache, profile, candidatesCache);

    if (!bestTable) {
      const bad = findUnplaceablePart(solverState.partsRemaining, enabledCoils);
      if (bad) {
        return {
          error: `Greska: Dio ${bad.width}cm x ${bad.length}m ne moze stati u dostupne limove.`
        };
      }
      return {
        error: 'Greska: Nije pronadjeno validno rjesenje za preostale dijelove.'
      };
    }

    applyTable(solverState.partsRemaining, bestTable);
    solverState.openedAreaCm += bestTable.coilWidth * bestTable.maxLength;
    solverState.tableCount += 1;

    const table = materializeTableFromPattern(bestTable);
    registerRemnantsForState(table, solverState);

    const group = coilsResult.find((c) => Math.abs(c.coilWidth - table.coilWidth) < EPS);
    group.tables.push(table);
  }

  runPostOptimization(coilsResult);
  const totalWasteM2 = collectTableRefs(coilsResult).reduce((sum, ref) => sum + (ref.wasteAreaCm / 100), 0);

  return {
    coilsResult,
    originalParts,
    totalWasteM2
  };
}

function isScrapCandidatePart(part) {
  return part.qty > 0 && part.length <= MAX_SCRAP_LENGTH_M + EPS;
}

function getScrapAvailabilityScore(part) {
  if (part.length <= COMMON_SCRAP_MAX_LENGTH_M + EPS && part.width <= COMMON_SCRAP_MAX_WIDTH_CM + EPS) {
    return 2;
  }
  if (part.length <= MAX_SCRAP_LENGTH_M + EPS) {
    return 1;
  }
  return 0;
}

function findScrapSuggestions(originalParts, enabledCoils, baseWasteM2) {
  const suggestions = [];

  originalParts.forEach((part, idx) => {
    if (!isScrapCandidatePart(part)) return;

    const reducedParts = originalParts.map((p, pIdx) => ({
      ...p,
      qty: pIdx === idx ? Math.max(0, p.qty - 1) : p.qty
    }));

    if (reducedParts[idx].qty === part.qty) return;

    const variantResult = solveCutPlan(reducedParts, enabledCoils, originalParts);
    if (variantResult.error) return;

    const savedWaste = baseWasteM2 - variantResult.totalWasteM2;
    if (savedWaste <= EPS) return;

    suggestions.push({
      part,
      partIndex: idx,
      reducedParts,
      savedWasteM2: savedWaste,
      availabilityScore: getScrapAvailabilityScore(part),
      plan: variantResult
    });
  });

  suggestions.sort((a, b) => {
    if (a.availabilityScore !== b.availabilityScore) {
      return b.availabilityScore - a.availabilityScore;
    }
    if (Math.abs(a.savedWasteM2 - b.savedWasteM2) > EPS) {
      return b.savedWasteM2 - a.savedWasteM2;
    }
    return a.part.width - b.part.width;
  });

  return suggestions.slice(0, MAX_SCRAP_SUGGESTIONS);
}

function renderScrapSuggestionsSummary(suggestions) {
  if (!suggestions.length) return '';

  const labelByScore = {
    2: 'vrlo cest otpad (do 40cm i do 0.4m)',
    1: 'moguc otpad (do 1m)',
    0: 'rijedji otpad'
  };

  const itemsHtml = suggestions.map((s, idx) => (
    `<li>#${idx + 1} ${s.part.width}cm x ${s.part.length}m, usteda otpada ~${s.savedWasteM2.toFixed(3)} m2 (${labelByScore[s.availabilityScore]})</li>`
  )).join('');

  return `<br><b>Predlozeni komadi sa otpada:</b><ul>${itemsHtml}</ul>`;
}

function getScrapDecisionPreference() {
  try {
    const value = window.localStorage.getItem(SCRAP_PREF_KEY);
    return value === 'use' || value === 'skip' ? value : null;
  } catch {
    return null;
  }
}

function setScrapDecisionPreference(value) {
  try {
    if (value === 'use' || value === 'skip') {
      window.localStorage.setItem(SCRAP_PREF_KEY, value);
    }
  } catch {
    // ignore storage issues (private mode, blocked storage)
  }
}

function renderScrapDecisionPanel(suggestion) {
  return `
    <div class="scrap-panel">
      <b>Prijedlog otpada:</b> Mozete li pronaci 1 komad ${suggestion.part.width} cm x ${suggestion.part.length} m?<br>
      Procijenjeno smanjenje otpada: <b>${suggestion.savedWasteM2.toFixed(3)} m2</b>.
      <div class="scrap-panel-actions">
        <button type="button" id="acceptScrapBtn" class="scrap-accept">Imam taj komad</button>
        <button type="button" id="declineScrapBtn" class="scrap-decline">Nemam, ostavi osnovni plan</button>
      </div>
      <label class="scrap-remember">
        <input type="checkbox" id="rememberScrapDecision"> Zapamti izbor za sljedece proracune
      </label>
      <div class="scrap-hint">Najcesce dostupni otpadi su trake do ~40cm i do 0.4m.</div>
    </div>
  `;
}

function renderPlanOutput(plan, suggestions, extraNote = '', includeDecisionPanel = false) {
  const noteHtml = extraNote ? `<b>Napomena:</b> ${extraNote}<br><br>` : '';
  const panelHtml = includeDecisionPanel && suggestions[0] ? renderScrapDecisionPanel(suggestions[0]) : '';
  resultDiv.innerHTML = noteHtml + renderResult(plan.coilsResult, plan.originalParts) + panelHtml + renderScrapSuggestionsSummary(suggestions);
}

function bindScrapDecisionHandlers(basePlan, selectedSuggestion, allSuggestions) {
  const acceptBtn = document.getElementById('acceptScrapBtn');
  const declineBtn = document.getElementById('declineScrapBtn');
  const rememberCheckbox = document.getElementById('rememberScrapDecision');
  if (!acceptBtn || !declineBtn) return;

  acceptBtn.addEventListener('click', () => {
    if (rememberCheckbox?.checked) {
      setScrapDecisionPreference('use');
    }
    renderPlanOutput(
      selectedSuggestion.plan,
      allSuggestions,
      'Koristen je scenarij sa 1 komadom preuzetim sa otpada.',
      false
    );
  });

  declineBtn.addEventListener('click', () => {
    if (rememberCheckbox?.checked) {
      setScrapDecisionPreference('skip');
    }
    renderPlanOutput(basePlan, allSuggestions, 'Ostao je osnovni proracun bez komada sa otpada.', false);
  });
}

function calculate() {
  const partsData = getPartsFromUI();
  if (partsData.error) {
    resultDiv.innerHTML = `Greska: ${partsData.error}`;
    return;
  }

  const enabledCoils = getEnabledCoils();
  if (enabledCoils.length === 0) {
    resultDiv.innerHTML = 'Greska: Niste odabrali nijedan lim.';
    return;
  }

  const basePlan = solveCutPlan(partsData.parts, enabledCoils);
  if (basePlan.error) {
    resultDiv.innerHTML = basePlan.error;
    return;
  }

  const scrapSuggestions = findScrapSuggestions(basePlan.originalParts, enabledCoils, basePlan.totalWasteM2);
  const scrapSuggestion = scrapSuggestions[0] || null;
  const pref = getScrapDecisionPreference();

  if (scrapSuggestion && pref === 'use') {
    renderPlanOutput(
      scrapSuggestion.plan,
      scrapSuggestions,
      'Automatski je primijenjena zapamcena opcija: koristi komad sa otpada.',
      false
    );
    return;
  }

  if (scrapSuggestion && pref !== 'skip') {
    renderPlanOutput(basePlan, scrapSuggestions, '', true);
    bindScrapDecisionHandlers(basePlan, scrapSuggestion, scrapSuggestions);
    return;
  }

  const baseNote = scrapSuggestion && pref === 'skip'
    ? 'Automatski je primijenjena zapamcena opcija: bez komada sa otpada.'
    : '';
  renderPlanOutput(basePlan, scrapSuggestions, baseNote, false);
}

document.addEventListener('DOMContentLoaded', () => {
  renderCoils();
  bindExistingRemoveButtons();

  addPartBtn.addEventListener('click', () => {
    partsContainer.appendChild(createPartRow(25, 1, 1));
  });

  calcBtn.addEventListener('click', calculate);
});
