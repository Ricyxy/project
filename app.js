// ===== GLOBALNE VARIJABLE =====
const coils = [
  { width: 125, enabled: true },
  { width: 100, enabled: true },
  { width: 50, enabled: true },
  { width: 42, enabled: false },
  { width: 33.3, enabled: true },
  { width: 25, enabled: true }
];

const resultDiv = document.getElementById("result");
const calcBtn = document.getElementById("calcBtn");
const coilList = document.getElementById("coilList");
const partsContainer = document.getElementById('partsContainer');
const addPartBtn = document.getElementById('addPartBtn');

const EPS = 1e-9;

// ===== POMOĆNE FUNKCIJE ZA UI =====
function renderCoils() {
  coilList.innerHTML = "";
  coils.forEach((coil, index) => {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = coil.enabled;
    checkbox.setAttribute('aria-label', `${coil.width} cm coil`);
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
  wLabel.textContent = 'Širina dijela (cm)';
  const wInput = document.createElement('input');
  wInput.type = 'number';
  wInput.className = 'partWidth';
  wInput.value = width;
  wInput.min = 0.1;
  wInput.step = 0.1;
  wLabel.appendChild(wInput);

  const lLabel = document.createElement('label');
  lLabel.textContent = 'Dužina dijela (m)';
  const lInput = document.createElement('input');
  lInput.type = 'number';
  lInput.className = 'partLength';
  lInput.value = length;
  lInput.min = 0.01;
  lInput.step = 0.01;
  lLabel.appendChild(lInput);

  const qLabel = document.createElement('label');
  qLabel.textContent = 'Količina';
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

// ===== GENERIRANJE SVIH PODSKUPOVA COILOVA =====
function getAllSubsets(coilsArray) {
  const subsets = [];
  const n = coilsArray.length;
  for (let i = 1; i < (1 << n); i++) {
    const subset = [];
    for (let j = 0; j < n; j++) {
      if (i & (1 << j)) {
        subset.push(coilsArray[j]);
      }
    }
    subsets.push(subset);
  }
  return subsets;
}

// ===== ALGORITAM 1: Greedy (originalni) =====
function greedyAlgorithm(parts, coilsEnabled) {
  const types = parts.map((p, idx) => ({ width: p.width, length: p.length, remaining: p.qty, index: idx }));
  const coilsResult = coilsEnabled.map(c => ({ coilWidth: c.coilWidth, tables: [] }));

  while (true) {
    const candidates = types.filter(t => t.remaining > 0);
    if (candidates.length === 0) break;
    const tableLength = Math.max(...candidates.map(t => t.length));
    const withPPS = candidates.map(t => {
      const pps = Math.floor((tableLength + EPS) / t.length);
      return { type: t, pps };
    }).filter(x => x.pps > 0);
    if (withPPS.length === 0) break;

    let bestSim = null;
    coilsEnabled.forEach((c, cIdx) => {
      let remainingWidthSim = c.coilWidth;
      const needs = withPPS.map(x => ({ type: x.type, pps: x.pps, stripsNeeded: Math.ceil(x.type.remaining / x.pps) }));
      needs.sort((a, b) => b.type.width - a.type.width);
      const stripsSim = [];
      for (const n of needs) {
        const maxStripsFit = Math.floor((remainingWidthSim + EPS) / n.type.width);
        if (maxStripsFit <= 0) continue;
        const allocate = Math.min(n.stripsNeeded, maxStripsFit);
        if (allocate > 0) {
          stripsSim.push({ type: n.type, strips: allocate, pps: n.pps });
          remainingWidthSim -= allocate * n.type.width;
        }
      }
      if (stripsSim.length === 0) return;
      if (!bestSim || remainingWidthSim < bestSim.remainingWidth ||
          (Math.abs(remainingWidthSim - bestSim.remainingWidth) < EPS && c.coilWidth < bestSim.coilWidth)) {
        bestSim = { cIdx, coilWidth: c.coilWidth, remainingWidth: remainingWidthSim, strips: stripsSim };
      }
    });
    if (!bestSim) break;

    const coilRes = coilsResult[bestSim.cIdx];
    const table = { maxLength: tableLength, remainingWidth: bestSim.remainingWidth, strips: [] };
    bestSim.strips.forEach(sa => {
      const produced = Math.min(sa.strips * sa.pps, sa.type.remaining);
      sa.type.remaining -= produced;
      table.strips.push({ width: sa.type.width, strips: sa.strips, produced, pps: sa.pps, partIndex: sa.type.index, partLength: sa.type.length });
    });
    coilRes.tables.push(table);
  }
  return coilsResult;
}

// ===== ALGORITAM 2: Best Fit Decreasing =====
function bestFitDecreasingAlgorithm(parts, coilsEnabled) {
  const types = parts.map((p, idx) => ({ width: p.width, length: p.length, remaining: p.qty, index: idx }));
  const coilsResult = coilsEnabled.map(c => ({ coilWidth: c.coilWidth, tables: [] }));

  // Expand all parts into individual items
  const items = [];
  types.forEach(t => {
    for (let i = 0; i < t.remaining; i++) {
      items.push({ width: t.width, length: t.length, index: t.index });
    }
  });
  items.sort((a, b) => b.width - a.width); // Decreasing width

  for (const item of items) {
    let bestCoilIdx = -1;
    let bestTableIdx = -1;
    let bestWaste = Infinity;

    for (let cIdx = 0; cIdx < coilsEnabled.length; cIdx++) {
      const coil = coilsEnabled[cIdx];
      // Try existing tables first
      for (let tIdx = 0; tIdx < coilsResult[cIdx].tables.length; tIdx++) {
        const table = coilsResult[cIdx].tables[tIdx];
        if (Math.abs(table.maxLength - item.length) < EPS && table.remainingWidth >= item.width - EPS) {
          const waste = table.remainingWidth - item.width;
          if (waste < bestWaste) {
            bestWaste = waste;
            bestCoilIdx = cIdx;
            bestTableIdx = tIdx;
          }
        }
      }
      // If no existing table, consider creating a new one
      if (coil.coilWidth >= item.width - EPS) {
        const waste = coil.coilWidth - item.width;
        if (waste < bestWaste) {
          bestWaste = waste;
          bestCoilIdx = cIdx;
          bestTableIdx = -1; // signal for new table
        }
      }
    }

    if (bestCoilIdx === -1) {
      // Item cannot be placed – skip (should not happen if coils are sufficient)
      continue;
    }

    let table;
    if (bestTableIdx === -1) {
      // Create new table
      table = { maxLength: item.length, remainingWidth: coilsEnabled[bestCoilIdx].coilWidth, strips: [] };
      coilsResult[bestCoilIdx].tables.push(table);
    } else {
      table = coilsResult[bestCoilIdx].tables[bestTableIdx];
    }

    table.strips.push({ width: item.width, strips: 1, produced: 1, pps: 1, partIndex: item.index, partLength: item.length });
    table.remainingWidth -= item.width;
  }

  return coilsResult;
}

// ===== IZRAČUN OTPADA ZA RJEŠENJE =====
function computeWaste(coilsResult) {
  let totalWaste = 0;
  coilsResult.forEach(cRes => {
    cRes.tables.forEach(t => {
      const partialWastes = [];
      t.strips.forEach(s => {
        const combinedLength = s.partLength * s.produced;
        if (combinedLength < t.maxLength - EPS) {
          partialWastes.push({ width: s.width, length: t.maxLength - combinedLength });
        }
      });
      const wasteMeters = (t.remainingWidth / 100) * t.maxLength +
        partialWastes.reduce((sum, w) => sum + (w.width / 100) * w.length, 0);
      totalWaste += wasteMeters;
    });
  });
  return totalWaste;
}

// ===== PRIKAZ REZULTATA (HTML) =====
function renderResult(coilsResult, algorithmName, parts) {
  let html = `<b>Odabrani algoritam:</b> ${algorithmName}<br>`;
  let totalUsedMeters = 0;
  let totalWasteMeters = 0;

  coilsResult.forEach((cRes, idx) => {
    if (cRes.tables.length === 0) return;
    html += `<b>Lim:</b> ${cRes.coilWidth} cm<br>`;
    cRes.tables.forEach((t, ti) => {
      const usedWidth = t.strips.map(s => s.width * s.strips).reduce((a, b) => a + b, 0);
      const producedPieces = t.strips.map(s => s.produced).reduce((a, b) => a + b, 0);
      const usedMeters = t.strips.map(s => s.produced * s.partLength).reduce((a, b) => a + b, 0);
      const partialWastes = [];
      t.strips.forEach(s => {
        const combinedLength = s.partLength * s.produced;
        if (combinedLength < t.maxLength - EPS) {
          partialWastes.push({ width: s.width, length: t.maxLength - combinedLength });
        }
      });
      const wasteMeters = (t.remainingWidth / 100) * t.maxLength +
        partialWastes.reduce((sum, w) => sum + (w.width / 100) * w.length, 0);
      totalUsedMeters += usedMeters;
      totalWasteMeters += wasteMeters;

      // Build visual representation
      const stripLines = [];
      t.strips.forEach(s => {
        const totalPieces = s.produced;
        const pps = s.pps || 1;
        const stripsCount = s.strips;
        const fullStrips = Math.floor(totalPieces / pps);
        let remainder = totalPieces % pps;
        for (let i = 0; i < stripsCount; i++) {
          let piecesInThisStrip = 0;
          if (i < fullStrips) piecesInThisStrip = pps;
          else if (i === fullStrips && remainder > 0) {
            piecesInThisStrip = remainder;
            remainder = 0;
          }
          if (piecesInThisStrip > 0) {
            const lengths = Array(piecesInThisStrip).fill(s.partLength.toFixed(2) + 'm').join('+');
            stripLines.push(`${s.width}cm (${lengths})`);
          } else {
            stripLines.push(`${s.width}cm`);
          }
        }
      });

      html += `Tabela ${ti + 1}:<br>`;
      const widthsHtml = stripLines.map(line => {
        const m = line.match(/^([^\(]+)\s*\(([^)]+)\)/);
        if (m) {
          return `<div class="width-line">${m[1].trim()}<span class="cuts">(${m[2]})</span></div>`;
        }
        return `<div class="width-line">${line}</div>`;
      }).join('');
      html += `<div class="table-visual"><div class="widths">${widthsHtml}</div><div class="bracket"><div class="bar" aria-hidden="true"></div><div class="table-length">${t.maxLength.toFixed(2)}m</div></div></div>`;

      let wasteDisplay = '';
      if (partialWastes.length > 0) {
        wasteDisplay += 'Otpad: ';
        partialWastes.forEach(w => {
          wasteDisplay += `${w.length.toFixed(2)}m × ${w.width.toFixed(1)}cm, `;
        });
        wasteDisplay = wasteDisplay.slice(0, -2);
      }
      if (t.remainingWidth > 0.1) {
        wasteDisplay += (wasteDisplay ? ' + ' : 'Otpad: ');
        wasteDisplay += `${t.maxLength.toFixed(2)}m × ${t.remainingWidth.toFixed(1)}cm`;
      }
      if (!wasteDisplay) wasteDisplay = 'Nema otpada';
      html += `iskorištena širina ${usedWidth.toFixed(2)} cm — dužina ${t.maxLength.toFixed(2)} m — proizvedeno komada ${producedPieces} — ${wasteDisplay}<br>`;
    });
    html += '<br>';
  });

  const originalUsedMeters = parts.reduce((s, p) => s + p.qty * p.length, 0);
  html += `<b>Ukupno potrebno (zbir dužina):</b> ${originalUsedMeters.toFixed(3)} m<br>`;
  html += `<b>Procijenjeno iskorišteno (približno):</b> ${totalUsedMeters.toFixed(3)} m<br>`;
  html += `<b>Ukupni otpad (približno):</b> ${totalWasteMeters.toFixed(3)} m`;
  return html;
}

// ===== GLAVNA FUNKCIJA KOJA SE POZIVA NA KLIK =====
function calculate() {
  // 1. Sakupi dijelove
  const rows = Array.from(document.querySelectorAll('.partRow'));
  if (rows.length === 0) {
    resultDiv.innerHTML = '❌ Dodajte barem jedan dio.';
    return;
  }

  const parts = rows.map(row => ({
    width: Number(row.querySelector('.partWidth').value),
    length: Number(row.querySelector('.partLength').value),
    qty: Number(row.querySelector('.quantity').value)
  }));

  for (const p of parts) {
    if (!(p.width > 0) || !(p.length > 0) || !(p.qty > 0) || !Number.isInteger(p.qty)) {
      resultDiv.innerHTML = '❌ Svi dijelovi moraju imati pozitivne brojeve i cijele količine.';
      return;
    }
  }

  // 2. Dohvati sve coilove koji su trenutno uključeni (originalno stanje)
  const allCoils = coils
    .map((c, i) => ({ coilWidth: c.width, enabled: c.enabled, index: i }))
    .filter(c => c.enabled)
    .sort((a, b) => a.coilWidth - b.coilWidth);

  if (allCoils.length === 0) {
    resultDiv.innerHTML = '❌ Niste odabrali nijedan lim.';
    return;
  }

  // 3. Generiraj sve moguće podskupove coilova
  const subsets = getAllSubsets(allCoils);

  let bestOverallResult = null;
  let bestOverallWaste = Infinity;
  let bestOverallDescription = '';

  // 4. Za svaki podskup isprobaj oba algoritma
  subsets.forEach(subset => {
    // Privremeno isključi sve coilove
    const originalEnabled = coils.map(c => c.enabled);
    coils.forEach(c => { c.enabled = false; });

    // Uključi samo one iz podskupa
    subset.forEach(sc => {
      const found = coils.find(c => Math.abs(c.width - sc.coilWidth) < EPS);
      if (found) found.enabled = true;
    });

    // Dohvati trenutno uključene coilove (za prosljeđivanje algoritmima)
    const currentEnabled = coils
      .filter(c => c.enabled)
      .map((c, i) => ({ coilWidth: c.width, enabled: c.enabled, index: i }))
      .sort((a, b) => a.coilWidth - b.coilWidth);

    if (currentEnabled.length === 0) {
      // ne bi se trebalo dogoditi jer subset nije prazan, ali za svaki slučaj
      coils.forEach((c, i) => { c.enabled = originalEnabled[i]; });
      return;
    }

    // Pokreni algoritme
    const greedyRes = greedyAlgorithm(parts, currentEnabled);
    const bfdRes = bestFitDecreasingAlgorithm(parts, currentEnabled);

    const greedyWaste = computeWaste(greedyRes);
    const bfdWaste = computeWaste(bfdRes);

    let subsetBestRes, subsetAlgo;
    if (greedyWaste <= bfdWaste) {
      subsetBestRes = greedyRes;
      subsetAlgo = 'Greedy';
    } else {
      subsetBestRes = bfdRes;
      subsetAlgo = 'BFD';
    }
    const subsetWaste = Math.min(greedyWaste, bfdWaste);

    if (subsetWaste < bestOverallWaste - EPS) {
      bestOverallWaste = subsetWaste;
      bestOverallResult = subsetBestRes;
      bestOverallDescription = `${subsetAlgo} (coils: ${subset.map(c => c.coilWidth).join(', ')})`;
    }

    // Vrati originalno stanje coilova
    coils.forEach((c, i) => { c.enabled = originalEnabled[i]; });
  });

  // 5. Prikaži najbolje rješenje
  if (bestOverallResult) {
    resultDiv.innerHTML = renderResult(bestOverallResult, bestOverallDescription, parts);
  } else {
    resultDiv.innerHTML = '❌ Nije pronađeno rješenje ni za jednu kombinaciju limova.';
  }
}

// ===== INICIJALIZACIJA =====
document.addEventListener('DOMContentLoaded', function() {
  renderCoils();
  // Dodaj početni red dijelova
  partsContainer.appendChild(createPartRow(25, 3, 1));
  addPartBtn.addEventListener('click', () => partsContainer.appendChild(createPartRow(25, 1, 1)));

  // Postavi događaj na originalni gumb
  calcBtn.addEventListener('click', calculate);

  // Postavi događaj na originalni gumb
  calcBtn.addEventListener('click', calculate);
});

