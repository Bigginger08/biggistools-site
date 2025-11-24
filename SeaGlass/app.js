// -----------------------------------------------------------------------------
// CGATS Chart Viewer with multi-file averaging + view modes + patch inspector
// -----------------------------------------------------------------------------

const PATCH_SIZE = 30;

// -----------------------------------------------------------------------------
// STATE
// -----------------------------------------------------------------------------

let refPatches = null;
let refLayoutMeta = null;
let refFileNames = [];

let samplePatches = null;
let sampleLayoutMeta = null;
let sampleFileNames = [];

let viewMode = "refColors";      // "deltaE" | "deltaLab" | "refColors" | "sampleColors" | "index"
let selectedIndexField = null;   // e.g. "CMYK_C", "7CLR_1"

// Index-channel metadata (from LGOMCCHANNELxx header lines)
const indexFieldLabMap = {};     // key: channel name (e.g. "7CLR_1") → { L, a, b }
const indexFieldInkNameMap = {}; // key: channel name          → "Cyan", etc.


// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------

const refInput         = document.getElementById("refFile");
const sampleInput      = document.getElementById("sampleFile");
const modeLabel        = document.getElementById("modeLabel");
const summaryEl        = document.getElementById("summary");
const chartContainer   = document.getElementById("chartContainer");
const statsPanel       = document.getElementById("statsPanel");

const debugToggle      = document.getElementById("debugToggle");
const debugPanel       = document.getElementById("debugPanel");
const debugText        = document.getElementById("debugText");

const refFilesListEl    = document.getElementById("refFilesList");
const sampleFilesListEl = document.getElementById("sampleFilesList");

const viewModeControls   = document.getElementById("viewModeControls");
const indexControls      = document.getElementById("indexControls");
const indexChannelSelect = document.getElementById("indexChannelSelect");
const indexControlsHint  = document.getElementById("indexControlsHint");

const patchDetailsPanel  = document.getElementById("patchDetailsPanel");
const headerToggleButton = document.getElementById("headerToggleButton");
const headerControls     = document.getElementById("headerControls");

// -----------------------------------------------------------------------------
// Header collapse / expand
// -----------------------------------------------------------------------------

if (headerToggleButton && headerControls) {
  headerToggleButton.addEventListener("click", () => {
    const isHidden = headerControls.classList.toggle("hidden");
    headerToggleButton.textContent = isHidden ? "Show controls" : "Hide controls";
  });
}


// -----------------------------------------------------------------------------
// DEBUG TOGGLE
// -----------------------------------------------------------------------------

if (debugToggle) {
  debugToggle.addEventListener("change", () => {
    if (debugToggle.checked) {
      debugPanel.classList.remove("hidden");
    } else {
      debugPanel.classList.add("hidden");
    }
    updateView();
  });
}

// -----------------------------------------------------------------------------
// VIEW MODE BUTTONS
// -----------------------------------------------------------------------------

if (viewModeControls) {
  viewModeControls.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-mode-btn");
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (!mode) return;
    setViewMode(mode);
  });
}

if (indexChannelSelect) {
  indexChannelSelect.addEventListener("change", () => {
    selectedIndexField = indexChannelSelect.value || null;
    updateView();
  });
}

function setViewMode(mode) {
  viewMode = mode;

  // Button active styling
  if (viewModeControls) {
    const buttons = viewModeControls.querySelectorAll(".view-mode-btn");
    buttons.forEach((btn) => {
      const m = btn.dataset.mode;
      if (m === mode) {
        btn.classList.add(
          "border-emerald-500",
          "bg-emerald-600/80",
          "text-emerald-50",
          "font-medium",
          "shadow-sm"
        );
        btn.classList.remove("border-slate-600", "bg-slate-800/80");
      } else {
        btn.classList.remove(
          "border-emerald-500",
          "bg-emerald-600/80",
          "text-emerald-50",
          "font-medium",
          "shadow-sm"
        );
        btn.classList.add("border-slate-600", "bg-slate-800/80");
      }
    });
  }

  // Index-mode UI
  if (indexControls) {
    if (mode === "index") {
      refreshIndexControls();
      indexControls.classList.remove("hidden");
    } else {
      indexControls.classList.add("hidden");
    }
  }

  updateView();
}

// Collapse patch inspector when clicking anywhere outside patches or the inspector
document.addEventListener("click", (e) => {
  if (!patchDetailsPanel) return;

  const target = e.target;

  // Click inside a patch?
  const isPatch = target.closest(".patch-square");
  // Click inside the inspector?
  const isInspector = target.closest("#patchDetailsPanel");

  if (isPatch || isInspector) {
    // don't collapse in these cases
    return;
  }

  // Otherwise hide the panel
  patchDetailsPanel.classList.add("hidden");
});





// -----------------------------------------------------------------------------
// FILE INPUT HANDLERS (multi-select, averaged)
// -----------------------------------------------------------------------------

if (refInput) {
  refInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    loadMultipleCgats(files)
      .then(({ patchMap, layoutMeta, fileNames }) => {
        refPatches = patchMap;
        refLayoutMeta = layoutMeta;
        refFileNames = fileNames;
        if (refFilesListEl) {
          refFilesListEl.textContent = fileNames.join(", ");
        }

        if (!viewMode) {
          setViewMode("refColors");
        } else {
          updateView();
        }
      })
      .catch((err) => {
        console.error(err);
        alert("Error parsing reference CGATS: " + err.message);
      });
  });
}

if (sampleInput) {
  sampleInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    loadMultipleCgats(files)
      .then(({ patchMap, layoutMeta, fileNames }) => {
        samplePatches = patchMap;
        sampleLayoutMeta = layoutMeta;
        sampleFileNames = fileNames;
        if (sampleFilesListEl) {
          sampleFilesListEl.textContent = fileNames.join(", ");
        }

        // Default to ΔE view when sample is loaded, unless user already chose something else
        if (!viewMode || viewMode === "refColors") {
          setViewMode("deltaE");
        } else {
          updateView();
        }
      })
      .catch((err) => {
        console.error(err);
        alert("Error parsing sample CGATS: " + err.message);
      });
  });
}

// -----------------------------------------------------------------------------
// MAIN RENDER FUNCTION
// -----------------------------------------------------------------------------

function updateView() {
  chartContainer.innerHTML = "";

  if (!refPatches) {
    modeLabel.textContent = "Waiting for reference chart…";
    summaryEl.textContent = "";
    if (debugText) debugText.textContent = "";
    return;
  }

  const hasSample = !!samplePatches;

  // Compute ΔE map + stats when sample present
  let deltaMap = null;

  const layout = refLayoutMeta || deriveSimpleLayout(refPatches);
  const allIds = Object.keys(refPatches);
  const patchCount = allIds.length;

  if (hasSample) {
    deltaMap = {};
    const deltaValues = [];
    let valid = 0;

    allIds.forEach((id) => {
      const r = refPatches[id];
      const s = samplePatches[id];
      if (!s) return;

      const dE = deltaE2000(r, s);
      deltaMap[id] = dE;
      deltaValues.push(dE);
      valid++;
    });

    if (valid === 0 || deltaValues.length === 0) {
      deltaMap = null;

      if (statsPanel) {
        statsPanel.innerHTML = `
          <div class="font-semibold text-slate-100 mb-1 text-xs">
            ΔE00 statistics
          </div>
          <div class="text-[11px] text-slate-300">
            Sample loaded, but no common patch IDs between reference and sample.
          </div>
        `;
      }

      summaryEl.textContent = "Sample loaded, but no common patch IDs.";
    } else {
      deltaValues.sort((a, b) => a - b);
      const n = deltaValues.length;

      const maxDelta = deltaValues[n - 1];
      const sum = deltaValues.reduce((acc, v) => acc + v, 0);
      const avg = sum / n;

      let median;
      if (n % 2 === 1) {
        median = deltaValues[(n - 1) / 2];
      } else {
        const mid1 = deltaValues[n / 2 - 1];
        const mid2 = deltaValues[n / 2];
        median = (mid1 + mid2) / 2;
      }

      const pIndex = (n - 1) * 0.95;
      const lo = Math.floor(pIndex);
      const hi = Math.ceil(pIndex);
      let p95;
      if (lo === hi) {
        p95 = deltaValues[lo];
      } else {
        const w = pIndex - lo;
        p95 = deltaValues[lo] * (1 - w) + deltaValues[hi] * w;
      }

      layout.maxDelta = maxDelta;

      if (statsPanel) {
        statsPanel.innerHTML = `
          <div class="font-semibold text-slate-100 mb-1 text-xs">
            ΔE00 statistics
          </div>
          <table class="w-full text-[11px] text-slate-100 border-collapse">
            <tbody>
              <tr>
                <td class="pr-2 text-slate-400">Common patches</td>
                <td class="text-right">${valid} / ${patchCount}</td>
              </tr>
              <tr>
                <td class="pr-2 text-slate-400">Average</td>
                <td class="text-right">${avg.toFixed(2)}</td>
              </tr>
              <tr>
                <td class="pr-2 text-slate-400">Median</td>
                <td class="text-right">${median.toFixed(2)}</td>
              </tr>
              <tr>
                <td class="pr-2 text-slate-400">95th percentile</td>
                <td class="text-right">${p95.toFixed(2)}</td>
              </tr>
              <tr>
                <td class="pr-2 text-slate-400">Max</td>
                <td class="text-right">${maxDelta.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        `;
      }
    }
  } else {
    if (statsPanel) {
      statsPanel.innerHTML = `
        <div class="font-semibold text-slate-100 mb-1 text-xs">
          ΔE00 statistics
        </div>
        <div class="text-[11px] text-slate-300">
          Load a sample chart to see comparison statistics.
        </div>
      `;
    }
  }

  const showDelta       = hasSample && deltaMap && viewMode === "deltaE";
  const showDeltaLab    = hasSample && viewMode === "deltaLab";
  const showSampleColor = hasSample && viewMode === "sampleColors";
  const showIndexValues = viewMode === "index";

  const refCount    = refFileNames.length || 1;
  const sampleCount = hasSample ? (sampleFileNames.length || 1) : 0;

  // Mode label + summary
  if (!hasSample) {
    modeLabel.textContent = "Color (reference chart)";
    summaryEl.textContent = `Patches: ${patchCount} · Reference files: ${refCount} · No sample loaded`;
  } else if (showDelta) {
    modeLabel.textContent = "ΔE2000 heatmap (reference vs sample)";
    summaryEl.textContent = `ΔE heatmap · Ref files: ${refCount} · Sample files: ${sampleCount}`;
  } else if (showDeltaLab) {
    modeLabel.textContent = "ΔLab encoded as Lab→RGB (sample − reference)";
    summaryEl.textContent = `ΔLab mode · L' = ΔL + 70; a' = Δa × 20; b' = Δb × 20 · Ref files: ${refCount} · Sample files: ${sampleCount}`;
  } else if (showSampleColor) {
    modeLabel.textContent = "Sample colors";
    summaryEl.textContent = `Showing averaged sample colors (text = sample ID) · Ref files: ${refCount} · Sample files: ${sampleCount}`;
  } else if (showIndexValues) {
    modeLabel.textContent = "Index values";
    const which = selectedIndexField ? `Channel: ${selectedIndexField}` : "No index channel available";
    summaryEl.textContent = `${which} · Ref files: ${refCount} · Sample files: ${sampleCount}`;
  } else {
    modeLabel.textContent = "Color (reference chart)";
    summaryEl.textContent = `Reference colors · Ref files: ${refCount} · Sample files: ${sampleCount}`;
  }

  // ---------------------------------------------------------------------------
  // Build page grid(s)
  // ---------------------------------------------------------------------------

  const numberOfStrips = layout.numberOfStrips || 1;
  const rowsPerPage    = layout.rowsPerPage   || layout.maxRow || 1;
  const maxCol         = layout.maxCol        || 1;

  const pages = Array.from({ length: numberOfStrips }, () => []);

  allIds.forEach((id) => {
    const p = refPatches[id];
    const pageIndex = typeof p.page === "number" ? p.page : 0;
    if (!pages[pageIndex]) pages[pageIndex] = [];
    pages[pageIndex].push({ id, patch: p });
  });

  pages.forEach((pagePatches, pageIndex) => {
    if (!pagePatches.length) return;

    pagePatches.sort((a, b) => {
      const ra = typeof a.patch.row === "number" ? a.patch.row : 0;
      const rb = typeof b.patch.row === "number" ? b.patch.row : 0;
      if (ra !== rb) return ra - rb;
      const ca = typeof a.patch.col === "number" ? a.patch.col : 0;
      const cb = typeof b.patch.col === "number" ? b.patch.col : 0;
      return ca - cb;
    });

    const wrapper = document.createElement("div");
    wrapper.className = "flex flex-col gap-2 mb-8";

    const label = document.createElement("div");
    label.className = "text-xs font-semibold text-slate-300";
    label.textContent = `Page ${pageIndex + 1} of ${numberOfStrips}`;
    wrapper.appendChild(label);

    const frame = document.createElement("div");
    frame.className = "w-full overflow-x-auto";
    wrapper.appendChild(frame);

    const grid = document.createElement("div");
    grid.className = "page-grid inline-grid gap-1 bg-slate-800 p-2 rounded-lg mx-auto";

    grid.style.gridTemplateColumns = `repeat(${maxCol}, ${PATCH_SIZE}px)`;
    grid.style.gridTemplateRows = `repeat(${rowsPerPage}, ${PATCH_SIZE}px)`;
    grid.style.gridAutoColumns = `${PATCH_SIZE}px`;
    grid.style.gridAutoRows = `${PATCH_SIZE}px`;

    frame.appendChild(grid);

    pagePatches.forEach(({ id, patch }) => {
      const rp = patch;
      const sp = samplePatches ? samplePatches[id] : null;

      let bgColor;
      let text = "";
      let extraInfo = "";

      if (showDelta && deltaMap && deltaMap[id] != null) {
        const dE = deltaMap[id];
        bgColor = deltaEToHeatColor(dE, layout.maxDelta);
        text = dE.toFixed(1);
        extraInfo = `ΔE00: ${dE.toFixed(3)}`;
      } else if (showDeltaLab && sp) {
        const dL = sp.L - rp.L;
        const da = sp.a - rp.a;
        const db = sp.b - rp.b;

        let Lp = dL + 70;
        let ap = da * 20;
        let bp = db * 20;

        Lp = Math.max(0, Math.min(100, Lp));
        ap = Math.max(-128, Math.min(128, ap));
        bp = Math.max(-128, Math.min(128, bp));

        const rgb = labToSRGB(Lp, ap, bp);
        bgColor = rgbToCSS(rgb);
        extraInfo = `ΔL=${dL.toFixed(2)}, Δa=${da.toFixed(2)}, Δb=${db.toFixed(2)} → L'=${Lp.toFixed(1)}, a'=${ap.toFixed(1)}, b'=${bp.toFixed(1)}`;
      } else if (showSampleColor && sp) {
        const rgb = labToSRGB(sp.L, sp.a, sp.b);
        bgColor = rgbToCSS(rgb);
        //text = sp.sampleId != null ? String(sp.sampleId) : id;
        extraInfo = `Sample L*a*b*: ${sp.L.toFixed(1)}, ${sp.a.toFixed(1)}, ${sp.b.toFixed(1)}`;
      } else if (showIndexValues && selectedIndexField) {
        const pIndexSource =
          sp && sp.indexValues && sp.indexValues[selectedIndexField] != null
            ? sp
            : rp;

        const idxVal = pIndexSource.indexValues
          ? pIndexSource.indexValues[selectedIndexField]
          : null;

        if (idxVal != null) {
          const v = Math.max(0, Math.min(100, idxVal));
          const v01 = v / 100.0;

          const rgb = indexValueToRGB(selectedIndexField, v01);
          bgColor = rgbToCSS(rgb);

          //text = v.toFixed(0);
          extraInfo = `${selectedIndexField}: ${v.toFixed(2)}%`;
        } else {
          const rgb = labToSRGB(rp.L, rp.a, rp.b);
          bgColor = rgbToCSS(rgb);
          extraInfo = `L*a*b*: ${rp.L.toFixed(1)}, ${rp.a.toFixed(1)}, ${rp.b.toFixed(1)}`;
        }
      } else {
        const rgb = labToSRGB(rp.L, rp.a, rp.b);
        bgColor = rgbToCSS(rgb);
        extraInfo = `L*a*b*: ${rp.L.toFixed(1)}, ${rp.a.toFixed(1)}, ${rp.b.toFixed(1)}`;
      }

      const patchDiv = createPatchDiv({
        id,
        label: id,
        bgColor,
        text,
        extraInfo,
        pageIndex: pageIndex + 1,
        row: patch.row,
        col: patch.col,
      });

      if (patch.row != null) {
        patchDiv.style.gridRowStart = patch.row;
      }
      if (patch.col != null) {
        patchDiv.style.gridColumnStart = patch.col;
      }

      grid.appendChild(patchDiv);
    });

    chartContainer.appendChild(wrapper);
  });

  updateDebugPanel(layout, refPatches, deltaMap);
}

// -----------------------------------------------------------------------------
// PATCH CLICK → DETAILS PANEL
// -----------------------------------------------------------------------------

function handlePatchClick(id) {
  if (!patchDetailsPanel || !refPatches || !refPatches[id]) return;

  // show the panel when a patch is clicked
  patchDetailsPanel.classList.remove("hidden");

  const ref = refPatches[id];
  const sample = samplePatches ? samplePatches[id] : null;

  // Location info
  const page = (ref.page != null ? ref.page : 0) + 1;
  const row = ref.row != null ? ref.row : "–";
  const col = ref.col != null ? ref.col : "–";

  // --- INDEX CHANNELS (all of them) -----------------------------------------
  const refIdxFields = Object.keys(ref.indexValues || {});
  const sampleIdxFields = sample ? Object.keys(sample.indexValues || {}) : [];
  const channelSet = new Set([...refIdxFields, ...sampleIdxFields]);
  const channels = [...channelSet].sort();

  // Ref C, h
  const refC = Math.sqrt(ref.a * ref.a + ref.b * ref.b);
  let refh = rad2deg(Math.atan2(ref.b, ref.a));
  if (refh < 0) refh += 360;

  // Sample C, h & deltas
  let sampleC = null;
  let sampleh = null;
  let dL = null, da = null, db = null, dC = null, dh = null, dE = null;

  if (sample) {
    sampleC = Math.sqrt(sample.a * sample.a + sample.b * sample.b);
    sampleh = rad2deg(Math.atan2(sample.b, sample.a));
    if (sampleh < 0) sampleh += 360;

    dL = sample.L - ref.L;
    da = sample.a - ref.a;
    db = sample.b - ref.b;
    dC = sampleC - refC;

    dh = sampleh - refh;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;

    dE = deltaE2000(ref, sample);
  }

  const refRgb = labToSRGB(ref.L, ref.a, ref.b);
  const refCss = rgbToCSS(refRgb);

  let sampleCss = "transparent";
  if (sample) {
    const sRgb = labToSRGB(sample.L, sample.a, sample.b);
    sampleCss = rgbToCSS(sRgb);
  }

  const fmt = (v, digits = 2) =>
    v == null || Number.isNaN(v) ? "–" : v.toFixed(digits);

  const fmtInt = (v) =>
    v == null || Number.isNaN(v) ? "–" : v.toFixed(0);

  // --- Build index text rows -------------------------------------------------
  let indexRowsHtml = "";

  channels.forEach((ch) => {
    const refVal =
      ref.indexValues && ref.indexValues[ch] != null
        ? ref.indexValues[ch]
        : null;
    const sampleVal =
      sample && sample.indexValues && sample.indexValues[ch] != null
        ? sample.indexValues[ch]
        : null;

    indexRowsHtml += `
      <div class="flex justify-between gap-2">
        <span>${ch}</span>
        <span>
          Ref: ${fmtInt(refVal)}% · Sample: ${fmtInt(sampleVal)}%
        </span>
      </div>
    `;
  });

  if (!indexRowsHtml) {
    indexRowsHtml = `
      <div class="text-slate-500 text-[11px]">
        No index values available for this patch.
      </div>
    `;
  }

  // --- Build index bar chart rows -------------------------------------------
  let indexBarsHtml = "";
  channels.forEach((ch) => {
    const refVal =
      ref.indexValues && ref.indexValues[ch] != null
        ? ref.indexValues[ch]
        : null;
    const sampleVal =
      sample && sample.indexValues && sample.indexValues[ch] != null
        ? sample.indexValues[ch]
        : null;

    // Use sample as primary visual; fall back to ref if sample missing
    const barSource = sampleVal != null ? sampleVal : refVal;
    if (barSource == null) return;

    const v = Math.max(0, Math.min(100, barSource));
    const width = Math.max(3, Math.round(v)); // min width for visibility

    const rgb = indexValueToRGB(ch, v / 100);
    const barColor = rgbToCSS(rgb);

    indexBarsHtml += `
      <div class="flex flex-col gap-0.5">
        <div class="flex justify-between text-[10px]">
          <span>${ch}</span>
          <span>${fmtInt(barSource)}%</span>
        </div>
        <div class="h-2 w-full bg-slate-800 rounded overflow-hidden">
          <div class="h-full" style="width:${width}%;background:${barColor};"></div>
        </div>
      </div>
    `;
  });

  if (!indexBarsHtml) {
    indexBarsHtml = `
      <div class="text-slate-500 text-[10px]">
        No index channels to chart.
      </div>
    `;
  }

  // --- Assemble inspector HTML ----------------------------------------------
  const html = `
    <div class="font-semibold text-slate-100 mb-1 text-xs">
      Selected patch: ${id}
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
      <!-- Textual data -->
      <div class="space-y-1">
        <div class="text-slate-300">
          <span class="text-slate-400">Location:</span>
          Page ${page}, Row ${row}, Col ${col}
        </div>
        <div class="text-slate-300">
          <span class="text-slate-400">Sample ID:</span>
          ${id}
        </div>

        <div class="mt-1 border-t border-slate-700 pt-1">
          <div class="font-semibold text-slate-200 mb-1">Index values</div>
          <div class="space-y-0.5">
            ${indexRowsHtml}
          </div>
        </div>

        <div class="mt-1 border-t border-slate-700 pt-1">
          <div class="font-semibold text-slate-200 mb-1">Reference (LabCh)</div>
          <div class="grid grid-cols-5 gap-x-2">
            <div>L: ${fmt(ref.L, 2)}</div>
            <div>a: ${fmt(ref.a, 2)}</div>
            <div>b: ${fmt(ref.b, 2)}</div>
            <div>C: ${fmt(refC, 2)}</div>
            <div>h: ${fmt(refh, 1)}°</div>
          </div>
        </div>

        <div class="mt-1 border-t border-slate-700 pt-1">
          <div class="font-semibold text-slate-200 mb-1">Sample (LabCh)</div>
          <div class="grid grid-cols-5 gap-x-2">
            <div>L: ${sample ? fmt(sample.L, 2) : "–"}</div>
            <div>a: ${sample ? fmt(sample.a, 2) : "–"}</div>
            <div>b: ${sample ? fmt(sample.b, 2) : "–"}</div>
            <div>C: ${sample ? fmt(sampleC, 2) : "–"}</div>
            <div>h: ${sample ? fmt(sampleh, 1) + "°" : "–"}</div>
          </div>
        </div>

        <div class="mt-1 border-t border-slate-700 pt-1">
          <div class="font-semibold text-slate-200 mb-1">Deltas (Sample − Ref)</div>
          <div class="grid grid-cols-6 gap-x-2">
            <div>ΔL: ${fmt(dL, 2)}</div>
            <div>Δa: ${fmt(da, 2)}</div>
            <div>Δb: ${fmt(db, 2)}</div>
            <div>ΔC: ${fmt(dC, 2)}</div>
            <div>Δh: ${fmt(dh, 1)}°</div>
            <div>ΔE00: ${fmt(dE, 2)}</div>
          </div>
        </div>
      </div>

      <!-- Color chips + index chart -->
      <div class="flex flex-col items-center justify-center gap-3">
        <div class="flex gap-4 items-center">
          <div class="flex flex-col items-center gap-1">
            <div class="w-12 h-12 rounded border border-slate-600" style="background:${refCss};"></div>
            <div class="text-[10px] text-slate-300">Reference</div>
          </div>
          <div class="flex flex-col items-center gap-1">
            <div class="w-12 h-12 rounded border border-slate-600" style="background:${sampleCss};"></div>
            <div class="text-[10px] text-slate-300">Sample</div>
          </div>
        </div>

        <div class="w-full max-w-xs mt-2">
          <div class="text-[10px] text-slate-400 mb-1">
            Index values chart (0–100%)
          </div>
          <div class="space-y-1">
            ${indexBarsHtml}
          </div>
        </div>
      </div>
    </div>
  `;

  patchDetailsPanel.innerHTML = html;
}


// -----------------------------------------------------------------------------
// INDEX CONTROLS (for Index values view mode)
// -----------------------------------------------------------------------------

function refreshIndexControls() {
  if (!indexChannelSelect) return;

  const layout =
    samplePatches &&
    sampleLayoutMeta &&
    sampleLayoutMeta.indexFields &&
    sampleLayoutMeta.indexFields.length
      ? sampleLayoutMeta
      : refLayoutMeta;

  const fields = (layout && layout.indexFields) || [];

  indexChannelSelect.innerHTML = "";

  if (!fields.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No index columns found";
    indexChannelSelect.appendChild(opt);
    indexChannelSelect.disabled = true;
    selectedIndexField = null;
    if (indexControlsHint) {
      indexControlsHint.textContent =
        "No CMYK_*/nCLR_* columns detected in the loaded file(s).";
    }
    return;
  }

  const metaMap = (layout && layout.indexFieldMeta) || {};

  fields.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;

    const meta = metaMap[name];
    if (meta && meta.inkName) {
      opt.textContent = `${name} (${meta.inkName})`;
    } else {
      opt.textContent = name;
    }

    indexChannelSelect.appendChild(opt);
  });


  if (!selectedIndexField || !fields.includes(selectedIndexField)) {
    selectedIndexField = fields[0];
  }
  indexChannelSelect.value = selectedIndexField;

  if (indexControlsHint) {
    indexControlsHint.textContent =
      "Coloring is driven by the selected channel's 0–100% value (0% = light, 100% = dark).";
  }
}

// -----------------------------------------------------------------------------
// DEBUG PANEL HELPER
// -----------------------------------------------------------------------------

function updateDebugPanel(layout, patchMap, deltaMap) {
  if (!debugToggle || !debugToggle.checked || !debugText) {
    if (debugText) debugText.textContent = "";
    return;
  }

  if (!layout || !patchMap) {
    debugText.textContent = "No layout information available yet.";
    return;
  }

  const {
    numberOfStrips,
    totalRows,
    rowsPerPage,
    maxCol,
    maxDelta,
    indexFields,
  } = layout;

  const ids = Object.keys(patchMap);

  const pageStats = new Map();
  ids.forEach((id) => {
    const p = patchMap[id];
    const page = typeof p.page === "number" ? p.page : 0;

    if (!pageStats.has(page)) {
      pageStats.set(page, {
        count: 0,
        minRow: Infinity,
        maxRow: -Infinity,
        minCol: Infinity,
        maxCol: -Infinity,
      });
    }
    const st = pageStats.get(page);
    st.count++;
    if (typeof p.row === "number") {
      st.minRow = Math.min(st.minRow, p.row);
      st.maxRow = Math.max(st.maxRow, p.row);
    }
    if (typeof p.col === "number") {
      st.minCol = Math.min(st.minCol, p.col);
      st.maxCol = Math.max(st.maxCol, p.col);
    }
  });

  let txt = "";
  txt += "=== CGATS Layout Debug ===\n";
  txt += `NumberOfStrips (pages): ${numberOfStrips}\n`;
  txt += `LGOROWLENGTH (total rows): ${totalRows}\n`;
  txt += `rowsPerPage: ${rowsPerPage}\n`;
  txt += `maxCol: ${maxCol}\n`;
  if (typeof maxDelta === "number") {
    txt += `max ΔE00: ${maxDelta.toFixed(3)}\n`;
  }
  if (indexFields && indexFields.length) {
    txt += `Index fields: ${indexFields.join(", ")}\n`;
  }
  txt += `Total patches: ${ids.length}\n\n`;

  txt += "Per-page stats:\n";
  [...pageStats.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([page, st]) => {
      txt += `  Page ${page}: patches=${st.count}, row=[${st.minRow}..${st.maxRow}], col=[${st.minCol}..${st.maxCol}]\n`;
    });

  debugText.textContent = txt;
}

// -----------------------------------------------------------------------------
// LAYOUT FALLBACK (if header missing)
// -----------------------------------------------------------------------------

function deriveSimpleLayout(patchMap) {
  let maxRow = 0;
  let maxCol = 0;

  Object.values(patchMap).forEach((p) => {
    if (typeof p.row === "number" && p.row > maxRow) maxRow = p.row;
    if (typeof p.col === "number" && p.col > maxCol) maxCol = p.col;
  });

  return {
    numberOfStrips: 1,
    rowsPerPage: maxRow || 1,
    totalRows: maxRow || 1,
    maxCol: maxCol || 1,
    indexFields: [],
  };
}

// -----------------------------------------------------------------------------
// CGATS LOADING (single + multi)
// -----------------------------------------------------------------------------

async function loadCgatsFile(file) {
  const text = await file.text();
  return parseCgats(text);
}

// Load multiple CGATS files and return an averaged patchMap + layoutMeta + fileNames
async function loadMultipleCgats(files) {
  if (!files.length) {
    throw new Error("No CGATS files selected.");
  }

  // 1) Parse all files
  const results = await Promise.all(
    Array.from(files).map((f) =>
      loadCgatsFile(f).then((res) => ({
        name: f.name,
        patchMap: res.patchMap,   // or res.patches in your code
        layoutMeta: res.layoutMeta,
      }))
    )
  );

  const fileNames = results.map((r) => r.name);

  // 2) Build the union of all patch IDs across all files
  const allIdSet = new Set();
  results.forEach((r) => {
    Object.keys(r.patchMap).forEach((id) => allIdSet.add(id));
  });
  const allIds = Array.from(allIdSet);

  if (!allIds.length) {
    throw new Error("No patches found in selected CGATS files.");
  }

  // 3) Average Lab and index values per ID over only the files that contain that ID
  const averagedPatchMap = {};

  allIds.forEach((id) => {
    let metaRef = null;
    let sumL = 0;
    let sumA = 0;
    let sumB = 0;
    let countLab = 0;

    const sumIndexValues = {}; // field → { sum, count }

    results.forEach((r) => {
      const p = r.patchMap[id];
      if (!p) return; // this file doesn’t have that patch

      if (!metaRef) metaRef = p;

      if (typeof p.L === "number" && typeof p.a === "number" && typeof p.b === "number") {
        sumL += p.L;
        sumA += p.a;
        sumB += p.b;
        countLab++;
      }

      if (p.indexValues) {
        for (const [field, val] of Object.entries(p.indexValues)) {
          if (val == null || Number.isNaN(val)) continue;
          if (!sumIndexValues[field]) {
            sumIndexValues[field] = { sum: 0, count: 0 };
          }
          sumIndexValues[field].sum += val;
          sumIndexValues[field].count++;
        }
      }
    });

    if (!metaRef || countLab === 0) {
      // nobody had Lab for this ID → skip it
      return;
    }

    const indexValues = {};
    for (const [field, agg] of Object.entries(sumIndexValues)) {
      if (agg.count > 0) {
        indexValues[field] = agg.sum / agg.count;
      }
    }

    averagedPatchMap[id] = {
      ...metaRef, // keeps page / row / col / sampleId from first file that had this patch
      L: sumL / countLab,
      a: sumA / countLab,
      b: sumB / countLab,
      indexValues,
    };
  });

  const averagedIds = Object.keys(averagedPatchMap);
  if (!averagedIds.length) {
    throw new Error("No common patches with valid Lab values across the selected files.");
  }

  // 4) Layout: use the first file as reference, but keep index field intersection
  const baseLayout = results[0].layoutMeta;
  const layoutMeta = { ...baseLayout };

  // intersect index field names across all files
  let idxFields = [...(baseLayout.indexFields || [])];
  for (let i = 1; i < results.length; i++) {
    const lf = results[i].layoutMeta.indexFields || [];
    idxFields = idxFields.filter((name) => lf.includes(name));
  }
  layoutMeta.indexFields = idxFields;

  // Optional: warn if layout differs across files
  for (let i = 1; i < results.length; i++) {
    const lm = results[i].layoutMeta;
    if (
      lm.numberOfStrips !== baseLayout.numberOfStrips ||
      lm.totalRows      !== baseLayout.totalRows ||
      lm.rowsPerPage    !== baseLayout.rowsPerPage ||
      lm.maxCol         !== baseLayout.maxCol
    ) {
      console.warn(
        "Layout meta differs between files; using first file as reference.",
        { baseLayout, differing: lm, file: results[i].name }
      );
    }
  }

  return { patchMap: averagedPatchMap, layoutMeta, fileNames };
}


function parseCgats(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let inFormat = false;
  let inData = false;
  const formatFields = [];
  const dataLines = [];

  let numberOfStrips = null;
  let lgoRowLength   = null;

  // New: mapping channel index → { inkName, fullToneLab: {L,a,b} }
  const channelMeta = {};

  for (const rawLine of lines) {
    const content = rawLine.replace(/^COMMENT[:\s]*/i, "").trim();

    if (!inData && !inFormat) {
      const stripMatch = content.match(/(NUMBER[_ ]*OF[_ ]*STRIPS|NumberOfStrips)\s*=?\s*(\d+)/i);
      if (stripMatch) {
        const n = parseInt(stripMatch[2], 10);
        if (!Number.isNaN(n)) numberOfStrips = n;
      }

      const lgoMatch = content.match(/(LGOROWLENGTH|LgoRowLength)\s*=?\s*(\d+)/i);
      if (lgoMatch) {
        const r = parseInt(lgoMatch[2], 10);
        if (!Number.isNaN(r)) lgoRowLength = r;
      }

            // NEW: LGOMCCHANNELxx with InkName + LabFullToneColor
      const chMatch = content.match(/^LGOMCCHANNEL(\d+)\s+(.+)$/i);
      if (chMatch) {
        const idx = parseInt(chMatch[1], 10);
        let metaStr = chMatch[2].trim();

        // remove optional surrounding quotes
        metaStr = metaStr.replace(/^"+|"+$/g, "");

        let inkName = null;
        let fullToneLab = null;

        const inkMatch = metaStr.match(/InkName\s*=\s*'([^']+)'/i);
        if (inkMatch) {
          inkName = inkMatch[1].trim();
        }

        const labMatch = metaStr.match(/LabFullToneColor\s*=\s*'([^']+)'/i);
        if (labMatch) {
          const nums = labMatch[1].trim().split(/\s+/).map((v) => parseFloat(v));
          if (nums.length >= 3 && nums.every((v) => !Number.isNaN(v))) {
            fullToneLab = { L: nums[0], a: nums[1], b: nums[2] };
          }
        }

        channelMeta[idx] = { inkName, fullToneLab };
      }
    }



    
    if (/^BEGIN_DATA_FORMAT/i.test(rawLine)) {
      inFormat = true;
      continue;
    }
    if (/^END_DATA_FORMAT/i.test(rawLine)) {
      inFormat = false;
      continue;
    }
    if (/^BEGIN_DATA/i.test(rawLine)) {
      inData = true;
      continue;
    }
    if (/^END_DATA/i.test(rawLine)) {
      inData = false;
      continue;
    }

    if (inFormat) {
      const parts = rawLine.split(/\s+/);
      for (const p of parts) {
        if (p) formatFields.push(p);
      }
    } else if (inData) {
      dataLines.push(rawLine);
    }
  }

  if (!formatFields.length || !dataLines.length) {
    throw new Error("Could not find CGATS DATA_FORMAT or DATA section.");
  }

  const upperFields = formatFields.map((f) => f.toUpperCase());

  const idIndex =
    indexOfAny(upperFields, ["SAMPLE_ID", "PATCH", "PATCH_ID"]) ?? -1;

  const LIndex = indexOfAny(upperFields, ["LAB_L", "L*", "L"]) ?? -1;
  const aIndex = indexOfAny(upperFields, ["LAB_A", "A*", "A"]) ?? -1;
  const bIndex = indexOfAny(upperFields, ["LAB_B", "B*", "B"]) ?? -1;

  if (LIndex < 0 || aIndex < 0 || bIndex < 0) {
    throw new Error(
      "Could not find Lab fields (LAB_L/LAB_A/LAB_B or L*/A*/B*)."
    );
  }

  const indexColumns = []; // { name, index, meta? }

  upperFields.forEach((name, idx) => {
    if (idx === idIndex || idx === LIndex || idx === aIndex || idx === bIndex) return;

    const originalName = formatFields[idx]; // preserve original case
    let meta = null;

    // CMYK_*
    if (/^CMYK_[A-Z]+$/i.test(originalName)) {
      const letter = originalName.slice(-1).toUpperCase(); // C/M/Y/K
      const mapIdx = ({ C: 1, M: 2, Y: 3, K: 4 })[letter];
      if (mapIdx && channelMeta[mapIdx]) {
        meta = channelMeta[mapIdx];
      }
      indexColumns.push({ name: originalName, index: idx, meta });
      return;
    }

    // nCLR_k (e.g. 7CLR_1 ... 7CLR_7)
    const clrMatch = originalName.match(/^(\d)CLR_(\d+)$/i);
    if (clrMatch) {
      const channelNo = parseInt(clrMatch[2], 10); // 1..n
      if (channelMeta[channelNo]) {
        meta = channelMeta[channelNo];
      }
      indexColumns.push({ name: originalName, index: idx, meta });
    }
  });

  // Build layout-level index field meta + update global maps
  const indexFieldMeta = {}; // name → { inkName, fullToneLab }

  indexColumns.forEach((col) => {
    if (col.meta && col.meta.fullToneLab) {
      const key = col.name.toUpperCase();
      indexFieldMeta[col.name] = {
        inkName: col.meta.inkName || null,
        fullToneLab: col.meta.fullToneLab,
      };
      indexFieldLabMap[key] = col.meta.fullToneLab;
      if (col.meta.inkName) {
        indexFieldInkNameMap[key] = col.meta.inkName;
      }
    }
  });


  const rows = [];
  let rowCounter = 0;

  for (const line of dataLines) {
    const parts = line.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;

    const L = parseFloat(parts[LIndex]);
    const a = parseFloat(parts[aIndex]);
    const b = parseFloat(parts[bIndex]);
    if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b)) continue;

    let id;
    if (idIndex >= 0 && parts[idIndex] !== undefined) {
      id = parts[idIndex];
    } else {
      id = String(rowCounter + 1);
    }

    const indexValues = {};
    indexColumns.forEach((col) => {
      const rawVal = parts[col.index];
      if (rawVal !== undefined) {
        const v = parseFloat(rawVal);
        if (!Number.isNaN(v)) indexValues[col.name] = v;
      }
    });

    rows.push({ id, L, a, b, indexValues });
    rowCounter++;
  }

  if (!rows.length) {
    throw new Error("No valid Lab rows parsed from CGATS.");
  }

  const totalPatches = rows.length;

  let totalRows = lgoRowLength;
  if (totalRows == null || totalRows <= 0) {
    totalRows = totalPatches;
  }

  if (numberOfStrips == null || numberOfStrips <= 0) {
    numberOfStrips = 1;
  }

  const rowsPerPage = Math.max(
    1,
    Math.round(totalRows / numberOfStrips)
  );

  const maxCol = totalPatches && totalRows
    ? Math.max(1, Math.floor(totalPatches / totalRows))
    : 1;

  const patchMap = {};

  rows.forEach((r, index0) => {
    let numericId = parseInt(r.id, 10);
    if (Number.isNaN(numericId)) {
      numericId = index0 + 1;
    }

    const k = numericId - 1;

    const colIndex = Math.floor(k / totalRows) + 1;
    const globalRow = (k % totalRows) + 1;

    const pageIndex    = Math.floor((globalRow - 1) / rowsPerPage);
    const rowWithinPage = ((globalRow - 1) % rowsPerPage) + 1;

    patchMap[r.id] = {
      L: r.L,
      a: r.a,
      b: r.b,
      page: pageIndex,
      row: rowWithinPage,
      col: colIndex,
      globalRow: globalRow,
      sampleId: numericId,
      indexValues: r.indexValues,
    };
  });

  const layoutMeta = {
    numberOfStrips,
    totalRows,
    rowsPerPage,
    maxCol,
    indexFields: indexColumns.map((c) => c.name),
    indexFieldMeta, // NEW
  };

  console.log("CGATS layout meta:", layoutMeta);
  console.log("First few patches:", Object.entries(patchMap).slice(0, 5));

  return { patchMap, layoutMeta };
}

// -----------------------------------------------------------------------------
// HELPERS
// -----------------------------------------------------------------------------

function indexOfAny(arr, candidates) {
  for (const c of candidates) {
    const idx = arr.indexOf(c.toUpperCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

// -----------------------------------------------------------------------------
// PATCH DOM FACTORY
// -----------------------------------------------------------------------------

function createPatchDiv({ id, label, bgColor, text, extraInfo, pageIndex, row, col }) {
  const div = document.createElement("div");
  div.className =
    "patch-square relative flex items-end justify-center rounded-md " +
    "text-[12px] font-medium overflow-hidden " +
    "border border-slate-700 hover:border-slate-100 hover:shadow-md transition cursor-pointer";

  div.style.backgroundColor = bgColor || "transparent";

  const badge = document.createElement("div");
  badge.className =
    "absolute top-0 left-0 px-1 py-0 bg-slate-900/40 text-[8px] text-slate-300";
  badge.textContent = label;
  div.appendChild(badge);

  if (text) {
    const t = document.createElement("div");
    t.className = "px-1 text-slate-50 drop-shadow";
    t.textContent = text;
    div.appendChild(t);
  }

  if (extraInfo) {
    div.title = `${extraInfo} (Page ${pageIndex}, Row ${row}, Col ${col})`;
  }

  div.addEventListener("click", () => {
    handlePatchClick(id);
  });

  return div;
}

// -----------------------------------------------------------------------------
// COLOR MATH: Lab → sRGB
// -----------------------------------------------------------------------------

function labToSRGB(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const delta = 6 / 29;
  const finv = (t) =>
    t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29);

  const Xn = 95.047;
  const Yn = 100.0;
  const Zn = 108.883;

  const X = (Xn * finv(fx)) / 100;
  const Y = (Yn * finv(fy)) / 100;
  const Z = (Zn * finv(fz)) / 100;

  let rLin =  3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let gLin = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let bLin =  0.0557 * X - 0.2040 * Y + 1.0570 * Z;

  const gamma = (c) =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  const r = gamma(Math.max(0, Math.min(1, rLin))) * 255;
  const g = gamma(Math.max(0, Math.min(1, gLin))) * 255;
  const b2 = gamma(Math.max(0, Math.min(1, bLin))) * 255;

  return {
    r: Math.round(r),
    g: Math.round(g),
    b: Math.round(b2),
  };
}

function rgbToCSS({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

// -----------------------------------------------------------------------------
// ΔE2000 IMPLEMENTATION
// -----------------------------------------------------------------------------

function deltaE2000(c1, c2) {
  const L1 = c1.L, a1 = c1.a, b1 = c1.b;
  const L2 = c2.L, a2 = c2.a, b2 = c2.b;

  const avgLp = (L1 + L2) / 2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (C1 + C2) / 2;

  const G =
    0.5 *
    (1 -
      Math.sqrt(
        Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))
      ));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const avgCp = (C1p + C2p) / 2;

  const h1p = hpFunc(b1, a1p);
  const h2p = hpFunc(b2, a2p);

  const avgHp = avgHpFunc(h1p, h2p);

  const T =
    1 -
    0.17 * Math.cos(deg2rad(avgHp - 30)) +
    0.24 * Math.cos(deg2rad(2 * avgHp)) +
    0.32 * Math.cos(deg2rad(3 * avgHp + 6)) -
    0.20 * Math.cos(deg2rad(4 * avgHp - 63));

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  const dhp = dhpFunc(h1p, h2p, C1p, C2p);
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp) / 2);

  const SL =
    1 +
    (0.015 * Math.pow(avgLp - 50, 2)) /
      Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;

  const deltaTheta =
    30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const Rc =
    2 *
    Math.sqrt(
      Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7))
    );
  const Rt = -Rc * Math.sin(deg2rad(2 * deltaTheta));

  return Math.sqrt(
    Math.pow(dLp / SL, 2) +
      Math.pow(dCp / SC, 2) +
      Math.pow(dHp / SH, 2) +
      Rt * (dCp / SC) * (dHp / SH)
  );
}

function hpFunc(b, ap) {
  if (ap === 0 && b === 0) return 0;
  const hRad = Math.atan2(b, ap);
  let hDeg = rad2deg(hRad);
  if (hDeg < 0) hDeg += 360;
  return hDeg;
}

function avgHpFunc(h1p, h2p) {
  if (Math.abs(h1p - h2p) > 180) {
    return (h1p + h2p + 360) / 2;
  }
  return (h1p + h2p) / 2;
}

function dhpFunc(h1p, h2p, C1p, C2p) {
  if (C1p * C2p === 0) return 0;
  if (Math.abs(h2p - h1p) <= 180) {
    return h2p - h1p;
  }
  if (h2p <= h1p) {
    return h2p - h1p + 360;
  }
  return h2p - h1p - 360;
}

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}
function rad2deg(rad) {
  return (rad * 180) / Math.PI;
}

// -----------------------------------------------------------------------------
// Index channel → RGB ramp
// -----------------------------------------------------------------------------

function indexValueToRGB(channelName, value01) {
  // Clamp 0–1
  const t = Math.max(0, Math.min(1, value01));
  const upper = (channelName || "").toUpperCase();

  // If we have a Lab full-tone color from LGOMCCHANNEL, use that
  const labMeta = indexFieldLabMap[upper];
  if (labMeta && typeof labMeta.L === "number") {
    // Simple ramp: 0% = paper white (L=100, a=0, b=0), 100% = full-tone Lab
    const L = 100 * (1 - t) + labMeta.L * t;
    const a = labMeta.a * t;
    const b = labMeta.b * t;

    const rgb = labToSRGB(L, a, b);
    return rgb;
  }

  // Fallback: hard-coded CMYK ramps (for older files without LGOMCCHANNEL info)
  const cmap = {
    CMYK_C: { r: 0,   g: 255, b: 255 }, // cyan
    CMYK_M: { r: 255, g: 0,   b: 255 }, // magenta
    CMYK_Y: { r: 255, g: 255, b: 0   }, // yellow
    CMYK_K: { r: 0,   g: 0,   b: 0   }, // black
  };

  const base = cmap[upper];
  if (base) {
    // 0% = light / nearly white, 100% = full base color
    const r = Math.round(255 * (1 - t) + base.r * t);
    const g = Math.round(255 * (1 - t) + base.g * t);
    const b = Math.round(255 * (1 - t) + base.b * t);
    return { r, g, b };
  }

  // Last-resort grayscale
  const gray = Math.round(255 * (1 - t));
  return { r: gray, g: gray, b: gray };
}


// -----------------------------------------------------------------------------
// ΔE → COLOR + OPACITY
// -----------------------------------------------------------------------------

function deltaEToHeatColor(dE, maxDelta) {
  const colorCapped = Math.min(dE, 5);
  const hueT = colorCapped / 5;

  let r, g, b;

  if (hueT < 0.5) {
    const k = hueT / 0.5;
    r = Math.round(255 * k);
    g = 255;
    b = 0;
  } else {
    const k = (hueT - 0.5) / 0.5;
    r = 255;
    g = Math.round(255 * (1 - k));
    b = 0;
  }

  const effectiveMax = Math.min(maxDelta || 10, 10) || 1;
  const alpha = Math.min(dE, effectiveMax) / effectiveMax;

  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

// -----------------------------------------------------------------------------
// INITIALIZE DEFAULT VIEW MODE
// -----------------------------------------------------------------------------

setViewMode("refColors");
