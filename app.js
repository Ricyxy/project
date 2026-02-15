const coils = [
  { width: 125, enabled: true },
  { width: 100, enabled: true },
  { width: 50, enabled: true },
  { width: 42, enabled: false },
  { width: 33.3, enabled: true },
  { width: 25, enabled: true }
];

const partWidthInput = document.getElementById("partWidth");
const partLengthInput = document.getElementById("partLength");
const quantityInput = document.getElementById("quantity");
const resultDiv = document.getElementById("result");
const calcBtn = document.getElementById("calcBtn");
const coilList = document.getElementById("coilList");
const partsContainer = document.getElementById('partsContainer');
const addPartBtn = document.getElementById('addPartBtn');

const EPS = 1e-9;

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
  wLabel.textContent = 'Part width (cm)';
  const wInput = document.createElement('input');
  wInput.type = 'number';
  wInput.className = 'partWidth';
  wInput.value = width;
  wInput.min = 0.1;
  wInput.step = 0.1;
  wLabel.appendChild(wInput);

  const lLabel = document.createElement('label');
  lLabel.textContent = 'Part length (m)';
  const lInput = document.createElement('input');
  lInput.type = 'number';
  lInput.className = 'partLength';
  lInput.value = length;
  lInput.min = 0.01;
  lInput.step = 0.01;
  lLabel.appendChild(lInput);

  const qLabel = document.createElement('label');
  qLabel.textContent = 'Quantity';
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
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(wLabel);
  row.appendChild(lLabel);
  row.appendChild(qLabel);
  row.appendChild(removeBtn);

  return row;
}

function findBestCoil(partWidth) {
  let best = null;

  coils.forEach(coil => {
    if (!coil.enabled) return;

    const strips = Math.floor((coil.width + EPS) / partWidth);
    if (strips === 0) return;

    const waste = coil.width - strips * partWidth;

    if (
      !best ||
      waste < best.waste ||
      (waste === best.waste && coil.width < best.coilWidth)
    ) {
      best = {
        coilWidth: coil.width,
        strips,
        waste
      };
    }
  });

  return best;
}

function calculate() {
  // Gather parts from DOM and expand into individual items
  const rows = Array.from(document.querySelectorAll('.partRow'));
  if (rows.length === 0) {
    resultDiv.innerHTML = '❌ Add at least one part.';
    return;
  }

  const parts = rows.map(row => ({
    width: Number(row.querySelector('.partWidth').value),
    length: Number(row.querySelector('.partLength').value),
    qty: Number(row.querySelector('.quantity').value)
  }));

  // Validate
  for (const p of parts) {
    if (!(p.width > 0) || !(p.length > 0) || !(p.qty > 0) || !Number.isInteger(p.qty)) {
      resultDiv.innerHTML = '❌ All parts must have positive numbers and integer quantities.';
      return;
    }
  }

  // Expand into individual items to allow mixing different widths/lengths in same table
  // Aggregate part types by (width,length)
  const types = parts.map((p, idx) => ({ width: p.width, length: p.length, remaining: p.qty, index: idx }));

  const coilsEnabled = coils
    .map((c, i) => ({ coilWidth: c.width, enabled: c.enabled, index: i }))
    .filter(c => c.enabled)
    .sort((a, b) => a.coilWidth - b.coilWidth); // try smaller coils first

  const coilsResult = coilsEnabled.map(c => ({ coilWidth: c.coilWidth, tables: [] }));

  const unplaceableTypes = [];

    // Global greedy loop: for the current set of types pick the best coil (min leftover width)
    while (true) {
      const candidates = types.filter(t => t.remaining > 0);
      if (candidates.length === 0) break;

      const tableLength = Math.max(...candidates.map(t => t.length));

      // compute pieces per strip for each candidate at this table length
      const withPPS = candidates.map(t => {
        const pps = Math.floor((tableLength + EPS) / t.length);
        return { type: t, pps };
      }).filter(x => x.pps > 0);

      if (withPPS.length === 0) break;

      // For each enabled coil simulate greedy packing and pick the coil with minimal leftover width
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

        if (!bestSim || remainingWidthSim < bestSim.remainingWidth || (Math.abs(remainingWidthSim - bestSim.remainingWidth) < EPS && c.coilWidth < bestSim.coilWidth)) {
          bestSim = { cIdx, coilWidth: c.coilWidth, remainingWidth: remainingWidthSim, strips: stripsSim };
        }
      });

      if (!bestSim) break; // no coil could produce anything

      // Apply allocations to the chosen coil
      const coilRes = coilsResult[bestSim.cIdx];
      const table = { maxLength: tableLength, remainingWidth: bestSim.remainingWidth, strips: [] };
      bestSim.strips.forEach(sa => {
        const produced = Math.min(sa.strips * sa.pps, sa.type.remaining);
        sa.type.remaining -= produced;
        table.strips.push({ width: sa.type.width, strips: sa.strips, produced, pps: sa.pps, partIndex: sa.type.index, partLength: sa.type.length });
      });
      coilRes.tables.push(table);
    }

  // any types remaining that cannot fit into any coil
  types.forEach(t => {
    const fitsAny = coils.some(c => t.width <= c.width + EPS && c.enabled);
    if (!fitsAny && t.remaining > 0) unplaceableTypes.push(t);
  });

  // Render results
  let html = '<h3>Result (mixed packing)</h3>';
  let totalUsedMeters = 0;
  let totalWasteMeters = 0;

  coilsResult.forEach((cRes, idx) => {
    if (cRes.tables.length === 0) return;
    html += `<b>Coil:</b> ${cRes.coilWidth} cm<br>`;
    cRes.tables.forEach((t, ti) => {
      const usedWidth = t.strips.map(s => s.width * s.strips).reduce((a, b) => a + b, 0);
      const producedPieces = t.strips.map(s => s.produced).reduce((a, b) => a + b, 0);
      // used meters: sum of produced pieces * their original part length
      const usedMeters = t.strips.map(s => s.produced * s.partLength).reduce((a, b) => a + b, 0);
      
      // Calculate partial waste: for each width, sum all its pieces' lengths
      // if total length < table length, there's a remnant
      const partialWastes = [];
      t.strips.forEach(s => {
        const combinedLength = s.partLength * s.produced;
        if (combinedLength < t.maxLength - EPS) {
          const wasteLen = t.maxLength - combinedLength;
          partialWastes.push({ width: s.width, length: wasteLen });
        }
      });
      
      // Only count remaining coil width as waste (not partial lengths—those are intentional shorter pieces)
      const remainingWasteWidth = t.remainingWidth;
      const wasteMeters = (t.remainingWidth / 100) * t.maxLength +
                          partialWastes.reduce((sum, w) => sum + (w.width / 100) * w.length, 0);

      totalUsedMeters += usedMeters;
      totalWasteMeters += wasteMeters;

      // Build per-strip breakdown and render a visual: widths column + vertical bracket + table length
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
          } else piecesInThisStrip = 0;

          if (piecesInThisStrip > 0) {
            const lengths = Array(piecesInThisStrip).fill(s.partLength.toFixed(2) + 'm').join('+');
            stripLines.push(`${s.width}cm (${lengths})`);
          } else {
            stripLines.push(`${s.width}cm`);
          }
        }
      });

      html += `Table ${ti + 1}:<br>`;

      // create HTML for the visual representation
      const widthsHtml = stripLines.map(line => {
        const m = line.match(/^([^\(]+)\s*\(([^)]+)\)/);
        if (m) {
          return `<div class="width-line">${m[1].trim()}<span class="cuts">(${m[2]})</span></div>`;
        }
        return `<div class="width-line">${line}</div>`;
      }).join('');

      html += `<div class="table-visual"><div class="widths">${widthsHtml}</div><div class="bracket"><div class="bar" aria-hidden="true"></div><div class="table-length">${t.maxLength.toFixed(2)}m</div></div></div>`;
      
      // Display all waste strips
      let wasteDisplay = '';
      if (partialWastes.length > 0) {
        wasteDisplay += 'Waste: ';
        partialWastes.forEach(w => {
          wasteDisplay += `${w.length.toFixed(2)}m × ${w.width.toFixed(1)}cm, `;
        });
        wasteDisplay = wasteDisplay.slice(0, -2); // remove trailing comma
      }
      if (remainingWasteWidth > 0.1) {
        wasteDisplay += (wasteDisplay ? ' + ' : 'Waste: ');
        wasteDisplay += `${t.maxLength.toFixed(2)}m × ${remainingWasteWidth.toFixed(1)}cm`;
      }
      if (!wasteDisplay) wasteDisplay = 'No waste';
      
      html += `used width ${usedWidth.toFixed(2)} cm — length ${t.maxLength.toFixed(2)} m — produced pieces ${producedPieces} — ${wasteDisplay}<br>`;
    });
    html += '<br>';
  });

  if (unplaceableTypes.length > 0) {
    html += `<b>Unplaceable types:</b> ${unplaceableTypes.map(t => `${t.width}cm×${t.length}m`).join(', ')}<br>`;
  }

  // any remaining produced count difference compute remaining used meters more accurately by original parts
  // compute total original used meters
  const originalUsedMeters = parts.reduce((s, p) => s + p.qty * p.length, 0);
  html += `<b>Total required (sum of lengths):</b> ${originalUsedMeters.toFixed(3)} m<br>`;
  html += `<b>Estimated used (approx.):</b> ${totalUsedMeters.toFixed(3)} m<br>`;
  html += `<b>Total waste (approx.):</b> ${totalWasteMeters.toFixed(3)} m`;

  resultDiv.innerHTML = html;
}

calcBtn.addEventListener("click", calculate);
renderCoils();
// initialize parts UI
partsContainer.appendChild(createPartRow(25,3,1));
addPartBtn.addEventListener('click', () => partsContainer.appendChild(createPartRow(25,1,1)));
