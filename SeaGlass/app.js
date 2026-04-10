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

let primaryView = "chart";       // "chart" | "graph"
let highlightedGraphPatchId = null;
let viewMode = "refColors";      // "deltaE" | "deltaLab" | "refColors" | "sampleColors" | "index"
let selectedIndexField = null;   // e.g. "CMYK_C", "7CLR_1"
let selectedPatchElement = null;

// Index-channel metadata (from LGOMCCHANNELxx header lines)
const indexFieldLabMap = {};     // key: channel name (e.g. "7CLR_1") → { L, a, b }
const indexFieldInkNameMap = {}; // key: channel name          → "Cyan", etc.

const MODE_CAPTIONS = {
  refColors: "Reference colors",
  sampleColors: "Sample colors",
  deltaE: "ΔE heatmap",
  deltaLab: "ΔLab encoded difference",
  index: "Index channel values",
  refRepeat: "Reference repeatability",
  sampleRepeat: "Sample repeatability",
};


// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------

const refInput         = document.getElementById("refFile");
const sampleInput      = document.getElementById("sampleFile");
const modeLabel        = document.getElementById("modeLabel");
const summaryEl        = document.getElementById("summary");
const chartContainer   = document.getElementById("chartContainer");
const statsPanel       = document.getElementById("statsPanel");

const refFilesListEl    = document.getElementById("refFilesList");
const sampleFilesListEl = document.getElementById("sampleFilesList");

const viewModeControls   = document.getElementById("viewModeControls");
const indexControls      = document.getElementById("indexControls");
const indexChannelSelect = document.getElementById("indexChannelSelect");
const indexControlsHint  = document.getElementById("indexControlsHint");

const patchDetailsPanel  = document.getElementById("patchDetailsPanel");
const deltaRanking       = document.getElementById("deltaRanking");
const chartContainer2    = document.getElementById("chartContainer"); // alias used below
const graphContainer     = document.getElementById("graphContainer");
const toggleChartView    = document.getElementById("toggleChartView");
const toggleGraphView    = document.getElementById("toggleGraphView");
const headerToggleButton = document.getElementById("headerToggleButton");
const headerControls     = document.getElementById("headerControls");
const clearRefButton     = document.getElementById("clearRefButton");
const clearSampleButton  = document.getElementById("clearSampleButton");
const modeLegend = document.getElementById("modeLegend");
const heatmapLegend      = document.getElementById("heatmapLegend");
const heatmapLegendLabel = document.getElementById("heatmapLegendLabel");
const viewModeCaption  = document.getElementById("viewModeCaption");

// -----------------------------------------------------------------------------
// Header collapse / expand
// -----------------------------------------------------------------------------

const primaryViewToggle  = document.getElementById("primaryViewToggle");
const modeControlsEl     = document.getElementById("modeControls");

if (headerToggleButton && headerControls) {
  headerToggleButton.addEventListener("click", () => {
    const isHidden = headerControls.classList.toggle("hidden");
    headerToggleButton.textContent = isHidden ? "Show controls" : "Hide controls";

    // Also hide/show the view toggle strip and mode controls
    if (primaryViewToggle) primaryViewToggle.classList.toggle("hidden", isHidden);
    if (modeControlsEl)    modeControlsEl.classList.toggle("hidden", isHidden);
    // For heatmap legend: hide when collapsing; on expand let updateView re-evaluate
    if (isHidden && heatmapLegend) heatmapLegend.classList.add("hidden");
    if (!isHidden) updateView();
  });
}

// -----------------------------------------------------------------------------
// PRIMARY VIEW TOGGLE (Chart ↔ Graph)
// -----------------------------------------------------------------------------

function setPrimaryView(mode) {
  primaryView = mode;

  const isChart = mode === "chart";

  // Toggle button styling
  if (toggleChartView) {
    toggleChartView.classList.toggle("bg-emerald-700", isChart);
    toggleChartView.classList.toggle("text-white", isChart);
    toggleChartView.classList.toggle("text-slate-400", !isChart);
    toggleChartView.classList.toggle("hover:bg-slate-700/60", !isChart);
  }
  if (toggleGraphView) {
    toggleGraphView.classList.toggle("bg-emerald-700", !isChart);
    toggleGraphView.classList.toggle("text-white", !isChart);
    toggleGraphView.classList.toggle("text-slate-400", isChart);
    toggleGraphView.classList.toggle("hover:bg-slate-700/60", isChart);
  }

  // Show/hide chart-specific UI
  if (modeControlsEl) modeControlsEl.classList.toggle("hidden", !isChart);
  if (chartContainer) chartContainer.classList.toggle("hidden", !isChart);
  if (heatmapLegend)  heatmapLegend.classList.toggle("hidden", !isChart);

  // Reset any expanded graph when switching away from Graph View
  if (isChart && expandedGraphId) {
    const cells = document.querySelectorAll(".graph-cell");
    cells.forEach((cell) => {
      cell.classList.remove("graph-expanded");
      cell.style.display = "";
      const btn = cell.querySelector(".graph-expand-btn");
      if (btn) { btn.title = "Expand"; btn.innerHTML = ICON_EXPAND; }
    });
    expandedGraphId = null;
  }

  // Show/hide graph UI
  if (graphContainer) {
    graphContainer.classList.toggle("hidden", isChart);
    graphContainer.classList.toggle("flex", !isChart);
    if (!isChart) initGraphExpandButtons();
  }

  // Re-run updateView so ranking sidebar visibility is recalculated
  updateView();
}

if (toggleChartView) toggleChartView.addEventListener("click", () => setPrimaryView("chart"));
if (toggleGraphView) toggleGraphView.addEventListener("click", () => setPrimaryView("graph"));

// -----------------------------------------------------------------------------
// Clear buttons for reference and sample
// -----------------------------------------------------------------------------

if (clearRefButton) {
  clearRefButton.addEventListener("click", () => {
    // Reset reference state
    refPatches = null;
    refLayoutMeta = null;
    refFileNames = [];

    // Clear file input element
    if (refInput) refInput.value = "";
    if (refFilesListEl) refFilesListEl.textContent = "";

    // Clear chart + stats + labels
    chartContainer.innerHTML = "";
    modeLabel.textContent = "Waiting for reference chart…";
    summaryEl.textContent = "";

    if (statsPanel) {
      statsPanel.innerHTML = `
        <div class="font-semibold text-slate-100 mb-1 text-xs">
          ΔE00 statistics
        </div>
        <div class="text-[11px] text-slate-300">
          Load a reference and sample chart to see statistics.
        </div>
      `;
    }

    // Hide patch inspector (optional but sensible)
    if (patchDetailsPanel) {
      patchDetailsPanel.classList.add("hidden");
      patchDetailsPanel.innerHTML = `
        <div class="font-semibold text-slate-100 mb-1 text-xs">
          Selected patch
        </div>
        <div class="text-[11px] text-slate-300">
          Click a patch in the chart to see detailed values.
        </div>
      `;
    }
  });
}

if (clearSampleButton) {
  clearSampleButton.addEventListener("click", () => {
    // Reset sample state
    samplePatches = null;
    sampleLayoutMeta = null;
    sampleFileNames = [];

    if (sampleInput) sampleInput.value = "";
    if (sampleFilesListEl) sampleFilesListEl.textContent = "";

    // When sample is cleared but reference remains, we just fall back to ref-only view
    // (no ΔE stats, no sample colors).
    // Easiest: force view mode to reference colors and re-render.
    viewMode = "refColors";
    setViewMode("refColors"); // will call updateView() and reset stats message
  });
}



// -----------------------------------------------------------------------------
// VIEW MODE BUTTONS
// -----------------------------------------------------------------------------

if (viewModeControls) {
  viewModeControls.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-mode-btn");
    if (!btn) return;

    // Don't allow clicking disabled buttons
    if (btn.disabled || btn.classList.contains("opacity-30")) return;

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
          "shadow-sm",
          "scale-110",
          "border-2"
        );
        btn.classList.remove(
          "border-slate-600",
          "bg-slate-800/80"
        );
      } else {
        btn.classList.remove(
          "border-emerald-500",
          "bg-emerald-600/80",
          "text-emerald-50",
          "font-medium",
          "shadow-sm",
          "scale-110",
          "border-2"
        );
        btn.classList.add(
          "border-slate-600",
          "bg-slate-800/80"
        );
      }
    });
  }

  // Update small caption under icons
  if (viewModeCaption) {
    viewModeCaption.textContent = MODE_CAPTIONS[mode] || "";
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

// Update button states based on whether sample is loaded
function updateModeButtonStates(hasSample) {
  if (!viewModeControls) return;

  const buttons = viewModeControls.querySelectorAll(".view-mode-btn");
  const sampleRequiredModes = ["sampleColors", "deltaE", "deltaLab", "sampleRepeat"];

  buttons.forEach((btn) => {
    const mode = btn.dataset.mode;

    if (sampleRequiredModes.includes(mode)) {
      if (!hasSample) {
        // Disable and grey out
        btn.disabled = true;
        btn.classList.add("opacity-30", "cursor-not-allowed", "pointer-events-none");
        btn.classList.remove("hover:bg-slate-700/80");
      } else {
        // Enable
        btn.disabled = false;
        btn.classList.remove("opacity-30", "cursor-not-allowed", "pointer-events-none");
        btn.classList.add("hover:bg-slate-700/80");
      }
    }
  });
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
          if (fileNames.length === 1) {
              refFilesListEl.textContent = `1 file loaded: ${fileNames[0]}`;
            } else {
              refFilesListEl.textContent =
                `${fileNames.length} files loaded (averaged): ${fileNames.join(", ")}`;
            }         
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
          if (fileNames.length === 1) {
            sampleFilesListEl.textContent = `1 file loaded: ${fileNames[0]}`;
          } else {
            sampleFilesListEl.textContent =
              `${fileNames.length} files loaded (averaged): ${fileNames.join(", ")}`;
          }
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
    return;
  }

  const hasSample = !!samplePatches;

  // Update mode button states based on sample availability
  updateModeButtonStates(hasSample);

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

  // Repeatability maps for heatmaps
  let refRepeatMap = null;
  let refRepeatMax = 0;
  let sampleRepeatMap = null;
  let sampleRepeatMax = 0;

  if (viewMode === "refRepeat" && refPatches) {
    refRepeatMap = {};
    const vals = [];

    allIds.forEach((id) => {
      const p = refPatches[id];
      if (!p || !p.repeatStats || p.repeatStats.count <= 1 || p.repeatStats.maxDE == null) return;
      refRepeatMap[id] = p.repeatStats.maxDE;
      vals.push(p.repeatStats.maxDE);
    });

    if (vals.length) {
      refRepeatMax = Math.max(...vals);

      // show statsPanel for ref repeatability
      const sorted = vals.slice().sort((a, b) => a - b);
      const n = sorted.length;
      const max = sorted[n - 1];
      const sum = sorted.reduce((a, b) => a + b, 0);
      const avg = sum / n;
      const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      const pIndex = (n - 1) * 0.95;
      const lo = Math.floor(pIndex);
      const hi = Math.ceil(pIndex);
      const p95 = lo === hi ? sorted[lo] : sorted[lo] * (1 - (pIndex - lo)) + sorted[hi] * (pIndex - lo);

      if (statsPanel) {
        statsPanel.innerHTML = `
          <div class="font-semibold text-slate-100 mb-1 text-xs">
            Ref repeatability (ΔE00 vs mean)
          </div>
          <table class="w-full text-[11px] text-slate-100 border-collapse">
            <tbody>
              <tr>
                <td class="pr-2 text-slate-400">Patches with N&gt;1</td>
                <td class="text-right">${n}</td>
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
                <td class="text-right">${max.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        `;
      }
    } else {
      refRepeatMap = null;
      if (statsPanel) {
        statsPanel.innerHTML = `
          <div class="font-semibold text-slate-100 mb-1 text-xs">
            Ref repeatability (ΔE00 vs mean)
          </div>
          <div class="text-[11px] text-slate-300">
            No repeatability data: only 1 reference file or no multi-file patches.
          </div>
        `;
      }
    }
  }

  if (viewMode === "sampleRepeat" && samplePatches) {
    sampleRepeatMap = {};
    const vals = [];

    allIds.forEach((id) => {
      const p = samplePatches[id];
      if (!p || !p.repeatStats || p.repeatStats.count <= 1 || p.repeatStats.maxDE == null) return;
      sampleRepeatMap[id] = p.repeatStats.maxDE;
      vals.push(p.repeatStats.maxDE);
    });

    if (vals.length) {
      sampleRepeatMax = Math.max(...vals);

      const sorted = vals.slice().sort((a, b) => a - b);
      const n = sorted.length;
      const max = sorted[n - 1];
      const sum = sorted.reduce((a, b) => a + b, 0);
      const avg = sum / n;
      const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      const pIndex = (n - 1) * 0.95;
      const lo = Math.floor(pIndex);
      const hi = Math.ceil(pIndex);
      const p95 = lo === hi ? sorted[lo] : sorted[lo] * (1 - (pIndex - lo)) + sorted[hi] * (pIndex - lo);

      if (statsPanel) {
        statsPanel.innerHTML = `
          <div class="font-semibold text-slate-100 mb-1 text-xs">
            Sample repeatability (ΔE00 vs mean)
          </div>
          <table class="w-full text-[11px] text-slate-100 border-collapse">
            <tbody>
              <tr>
                <td class="pr-2 text-slate-400">Patches with N&gt;1</td>
                <td class="text-right">${n}</td>
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
                <td class="text-right">${max.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        `;
      }
    } else {
      sampleRepeatMap = null;
      if (statsPanel) {
        statsPanel.innerHTML = `
          <div class="font-semibold text-slate-100 mb-1 text-xs">
            Sample repeatability (ΔE00 vs mean)
          </div>
          <div class="text-[11px] text-slate-300">
            No repeatability data: only 1 sample file or no multi-file patches.
          </div>
        `;
      }
    }
  }

  const showDelta       = hasSample && deltaMap && viewMode === "deltaE";
  const showDeltaLab    = hasSample && viewMode === "deltaLab";
  const showSampleColor = hasSample && viewMode === "sampleColors";
  const showIndexValues = viewMode === "index";
  const showRefRepeat    = viewMode === "refRepeat";
  const showSampleRepeat = viewMode === "sampleRepeat";
  const refCount    = refFileNames ? refFileNames.length : (refPatches ? 1 : 0);
  const sampleCount = sampleFileNames ? sampleFileNames.length : (samplePatches ? 1 : 0);
  const isIndexMode = viewMode === "index";
  const isTACMode   = isIndexMode && selectedIndexField === "TAC";

  // 🔹 TAC heatmap data (for index mode with TAC selected)
  let tacMap = null;
  let tacMax = 0;
  let tacMaxPatchId = null;

  if (isTACMode && layout && layout.indexFields && layout.indexFields.length) {
    tacMap = {};
    let maxVal = 0;
    let maxPatchId = null;

    allIds.forEach((id) => {
      const p = refPatches[id];
      if (!p || !p.indexValues) return;

      let sum = 0;
      layout.indexFields.forEach((field) => {
        const v = p.indexValues[field];
        if (typeof v === "number" && !Number.isNaN(v)) {
          sum += v;
        }
      });

      tacMap[id] = sum;
      if (sum > maxVal) {
        maxVal = sum;
        maxPatchId = id;
      }
    });

    tacMax = maxVal;
    tacMaxPatchId = maxPatchId;

    // Display TAC statistics in the panel
    if (tacMaxPatchId && refPatches[tacMaxPatchId] && statsPanel) {
      const maxPatch = refPatches[tacMaxPatchId];
      const page = (maxPatch.page != null ? maxPatch.page : 0) + 1;
      const row = maxPatch.row != null ? maxPatch.row : "–";
      const col = maxPatch.col != null ? maxPatch.col : "–";

      statsPanel.innerHTML = `
        <div class="font-semibold text-slate-100 mb-1 text-xs">
          TAC Statistics
        </div>
        <table class="w-full text-[11px] text-slate-100 border-collapse">
          <tbody>
            <tr>
              <td class="pr-2 text-slate-400">Max TAC</td>
              <td class="text-right">${tacMax.toFixed(0)}%</td>
            </tr>
            <tr>
              <td class="pr-2 text-slate-400">Patch ID</td>
              <td class="text-right">${tacMaxPatchId}</td>
            </tr>
            <tr>
              <td class="pr-2 text-slate-400">Location</td>
              <td class="text-right">Page ${page}, Row ${row}, Col ${col}</td>
            </tr>
            <tr>
              <td class="pr-2 text-slate-400">Channels</td>
              <td class="text-right">${layout.indexFields.length}</td>
            </tr>
          </tbody>
        </table>
      `;
    }
  }


  // Mode label + summary
  if (!hasSample) {
    modeLabel.textContent = "Color (reference chart)";
    summaryEl.textContent = `Patches: ${patchCount} · Reference files: ${refCount} · No sample loaded`;
      if (modeLegend) {
      modeLegend.textContent =
        "Each patch shows the reference L*a*b* color. Load a sample chart to enable comparison modes.";
      }
  } else if (showDelta) {
    modeLabel.textContent = "ΔE2000 heatmap (reference vs sample)";
    summaryEl.textContent = `ΔE heatmap · Ref files: ${refCount} · Sample files: ${sampleCount}`;
      if (modeLegend) {
      modeLegend.textContent =
        "Patch color and number show ΔE00 between reference and sample (0 ≈ perfect match, 1–2 ≈ slight, 3+ clearly visible).";
      }
  } else if (showDeltaLab) {
    modeLabel.textContent = "ΔLab encoded as Lab→RGB (sample − reference)";
    summaryEl.textContent = `ΔLab mode · L' = ΔL + 70; a' = Δa × 20; b' = Δb × 20 · Ref files: ${refCount} · Sample files: ${sampleCount}`;
      if (modeLegend) {
        modeLegend.textContent =
          "Colors encode ΔL, Δa, Δb as a pseudo-Lab; use this to see direction of the color shift, not just the magnitude.";
      }
  } else if (showSampleColor) {
    modeLabel.textContent = "Sample colors";
    summaryEl.textContent = `Showing averaged sample colors (text = sample ID) · Ref files: ${refCount} · Sample files: ${sampleCount}`;
        if (modeLegend) {
          modeLegend.textContent =
            "Each patch shows the sample L*a*b* color. Use ΔE or ΔLab view to see differences vs reference.";
        }
  } else if (showIndexValues) {
    modeLabel.textContent = "Index values";
    const which = selectedIndexField ? `Channel: ${selectedIndexField}` : "No index channel available";
    summaryEl.textContent = `${which} · Ref files: ${refCount} · Sample files: ${sampleCount}`;
      if (modeLegend) {
        modeLegend.textContent =
          "Colors show the ink/channel value (0–100%) for the selected index; select the channel above to change the view.";
      }
  } else if (showRefRepeat) {
    modeLabel.textContent = "Repeatability heatmap (reference)";
    summaryEl.textContent = `ΔE00 vs mean per patch · Reference files: ${refCount}`;
      if (modeLegend) {
        modeLegend.textContent =
          "Patch color shows repeatability of the reference set (ΔE00 vs mean) – high values indicate unstable patches.";
      }
  } else if (showSampleRepeat) {
    modeLabel.textContent = "Repeatability heatmap (sample)";
    summaryEl.textContent = `ΔE00 vs mean per patch · Sample files: ${sampleCount}`;
        if (modeLegend) {
          modeLegend.textContent =
            "Patch color shows repeatability of the sample set (ΔE00 vs mean) – high values indicate unstable patches.";
        }
  } else {
    modeLabel.textContent = "Color (reference chart)";
    summaryEl.textContent = `Reference colors · Ref files: ${refCount} · Sample files: ${sampleCount}`;
        if (modeLegend) {
          modeLegend.textContent =
            "Showing reference L*a*b* colors. Use the buttons above to switch between comparison and analysis modes.";
        }
  }

  // Heatmap legend — always hidden in Graph View; in Chart View follows mode
  if (heatmapLegend) {
    heatmapLegend.classList.add("hidden");
    if (primaryView === "chart") {
      if (showDelta) {
        heatmapLegend.classList.remove("hidden");
        if (heatmapLegendLabel) heatmapLegendLabel.textContent = "ΔE00 (ref vs sample)";
      } else if (showRefRepeat) {
        heatmapLegend.classList.remove("hidden");
        if (heatmapLegendLabel) heatmapLegendLabel.textContent = "Repeatability ΔE00 (reference set)";
      } else if (showSampleRepeat) {
        heatmapLegend.classList.remove("hidden");
        if (heatmapLegendLabel) heatmapLegendLabel.textContent = "Repeatability ΔE00 (sample set)";
      }
    }
  }
  // for other modes (ref color, sample color, index, ΔLab) the legend stays hidden


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

    // Use layout's maxCol and rowsPerPage for grid sizing
    const pageMaxCol = maxCol;
    const pageRowsPerPage = rowsPerPage;

    const wrapper = document.createElement("div");
    wrapper.className = "flex flex-col gap-2 mb-8 w-full";

    const label = document.createElement("div");
    label.className = "text-xs font-semibold text-slate-300 text-center";
    label.textContent = `Page ${pageIndex + 1} of ${numberOfStrips}`;
    wrapper.appendChild(label);

    const frame = document.createElement("div");
    frame.className = "w-full overflow-x-auto";
    wrapper.appendChild(frame);

    const centeringDiv = document.createElement("div");
    centeringDiv.style.textAlign = "center";
    centeringDiv.style.minWidth = "100%";
    frame.appendChild(centeringDiv);

    const grid = document.createElement("div");
    grid.className = "page-grid inline-grid gap-1 bg-slate-800 p-2 rounded-lg";
    grid.style.textAlign = "left";
    grid.style.width = "fit-content";

    grid.style.gridTemplateColumns = `repeat(${pageMaxCol}, ${PATCH_SIZE}px)`;
    grid.style.gridTemplateRows = `repeat(${pageRowsPerPage}, ${PATCH_SIZE}px)`;
    grid.style.gridAutoColumns = `${PATCH_SIZE}px`;
    grid.style.gridAutoRows = `${PATCH_SIZE}px`;

    centeringDiv.appendChild(grid);





    pagePatches.forEach(({ id, patch }) => {
      const rp = patch;
      const sp = samplePatches ? samplePatches[id] : null;

      let bgColor;
      let text = "";
      let extraInfo = "";


      if (showRefRepeat && refRepeatMap && refRepeatMap[id] != null) {
        const rDE = refRepeatMap[id];
        bgColor = deltaEToHeatColor(rDE, refRepeatMax || 5);
        text = rDE.toFixed(2);
        extraInfo = `Ref repeatability ΔE00 vs mean: ${rDE.toFixed(3)}`;
      } else if (showSampleRepeat && sampleRepeatMap && sampleRepeatMap[id] != null) {
        const sDE = sampleRepeatMap[id];
        bgColor = deltaEToHeatColor(sDE, sampleRepeatMax || 5);
        text = sDE.toFixed(2);
        extraInfo = `Sample repeatability ΔE00 vs mean: ${sDE.toFixed(3)}`;
      } else if (showDelta && deltaMap && deltaMap[id] != null) {
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
      } else if (showIndexValues && isTACMode && tacMap && tacMap[id] != null) {
  // 🔹 TAC heatmap per patch
  const tacVal = tacMap[id]; // e.g. 260 => 260%
  const maxVal = tacMax || (layout.indexFields.length * 100) || 100;

  bgColor = tacValueToColor(tacVal, maxVal); // white to emerald-700 gradient
  text = tacVal.toFixed(0);                  // show TAC as integer %
  extraInfo = `TAC: ${tacVal.toFixed(0)}% (sum of ${layout.indexFields.length} channels)`;
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

  // Render ΔE ranking sidebar
  renderDeltaRanking(deltaMap);

  // Render graph view charts
  renderGraph1(deltaMap, highlightedGraphPatchId);
  renderBullseyePlot("graph-2", "da", "db", "← ∆a →", "← ∆b →", "∆a vs ∆b", highlightedGraphPatchId);
  renderBullseyePlot("graph-3", "da", "dL", "← ∆a →", "← ∆L →", "∆a vs ∆L", highlightedGraphPatchId);
  renderBullseyePlot("graph-4", "db", "dL", "← ∆b →", "← ∆L →", "∆b vs ∆L", highlightedGraphPatchId);
}

// -----------------------------------------------------------------------------
// ΔE RANKING SIDEBAR
// -----------------------------------------------------------------------------

function shortChannelName(fieldName, indexFieldMeta) {
  // Try ink name from metadata
  const meta = indexFieldMeta && indexFieldMeta[fieldName];
  if (meta && meta.inkName) {
    const ink = meta.inkName.trim();
    // Single-word well-known names → single char
    const known = { Cyan: "C", Magenta: "M", Yellow: "Y", Black: "K",
                    Orange: "O", Green: "G", Violet: "V", Blue: "B",
                    Red: "R", White: "W", "Light Cyan": "Lc",
                    "Light Magenta": "Lm" };
    if (known[ink]) return known[ink];
    // Fallback: first 2 chars
    return ink.slice(0, 2);
  }
  // CMYK_X → X
  const cmykMatch = fieldName.match(/^CMYK_([A-Z]+)$/i);
  if (cmykMatch) return cmykMatch[1].toUpperCase();
  // nCLR_k → k
  const clrMatch = fieldName.match(/^\d+CLR_(\d+)$/i);
  if (clrMatch) return clrMatch[1];
  return fieldName.slice(0, 3);
}

function renderDeltaRanking(deltaMap) {
  if (!deltaRanking) return;

  if (!deltaMap || !refPatches || !samplePatches) {
    deltaRanking.classList.add("hidden");
    return;
  }

  deltaRanking.classList.remove("hidden");
  deltaRanking.innerHTML = "";

  // Title
  const title = document.createElement("div");
  title.className = "text-[10px] font-semibold text-slate-300 mb-0.5 text-center tracking-wide";
  title.textContent = "Patches by ΔE";
  deltaRanking.appendChild(title);

  // Scrollable list
  const scroll = document.createElement("div");
  scroll.className = "flex flex-col gap-0.5 overflow-y-auto";
  scroll.style.maxHeight = "calc(120vh - 20px)";
  deltaRanking.appendChild(scroll);

  const layout = refLayoutMeta || deriveSimpleLayout(refPatches);
  const indexFields = (layout && layout.indexFields) || [];
  const indexFieldMeta = (layout && layout.indexFieldMeta) || {};

  // Sort descending by ΔE
  const sorted = Object.entries(deltaMap).sort((a, b) => b[1] - a[1]);

  sorted.forEach(([id, dE]) => {
    const ref = refPatches[id];
    const sample = samplePatches ? samplePatches[id] : null;
    if (!ref || !sample) return;

    const refCss = rgbToCSS(labToSRGB(ref.L, ref.a, ref.b));
    const sCss   = rgbToCSS(labToSRGB(sample.L, sample.a, sample.b));

    // Compact ink label: C50 M0 Y0 K5 …
    let inkLabel = "";
    if (indexFields.length > 0) {
      const parts = indexFields.map((field) => {
        const v = ref.indexValues && ref.indexValues[field] != null
          ? ref.indexValues[field] : null;
        if (v == null) return null;
        const abbr = shortChannelName(field, indexFieldMeta);
        return `${abbr}${Math.round(v)}`;
      }).filter(Boolean);
      inkLabel = parts.join(" ");
    }

    const entry = document.createElement("div");
    entry.className =
      "flex flex-col items-center gap-0.5 cursor-pointer rounded px-0.5 py-0.5 " +
      "hover:bg-slate-700/50 transition-colors";
    entry.title = `${id}: ΔE00 = ${dE.toFixed(3)}`;
    entry.addEventListener("click", () => {
      // Clear previous ranking highlight
      document.querySelectorAll(".patch-ranking-highlight").forEach((el) =>
        el.classList.remove("patch-ranking-highlight")
      );
      // Clear grid selection highlight
      if (selectedPatchElement) {
        selectedPatchElement.classList.remove("patch-selected");
        selectedPatchElement = null;
      }
      // Find patch in grid, highlight red, scroll into view
      const patchEl = document.querySelector(`.patch-square[data-patch-id="${id}"]`);
      if (patchEl) {
        patchEl.classList.add("patch-ranking-highlight");
        // Scroll so the patch lands in the center of the visible area below the sticky header
        const header = document.querySelector("header");
        const headerH = header ? header.getBoundingClientRect().bottom : 0;
        const rect = patchEl.getBoundingClientRect();
        const patchMidY = rect.top + rect.height / 2;
        const visibleMidY = headerH + (window.innerHeight - headerH) / 2;
        window.scrollBy({ top: patchMidY - visibleMidY, behavior: "smooth" });
      }
      // Highlight in graph views
      highlightGraphPatch(id);
      // Open inspector
      handlePatchClick(id);
    });

    // Two color squares side by side
    const squares = document.createElement("div");
    squares.className = "flex gap-1";

    const refSq = document.createElement("div");
    refSq.style.cssText =
      `width:30px;height:30px;background:${refCss};` +
      `border:1px solid rgba(255,255,255,0.18);border-radius:3px;flex-shrink:0;`;

    const sampleSq = document.createElement("div");
    sampleSq.style.cssText =
      `width:30px;height:30px;background:${sCss};` +
      `border:1px solid rgba(255,255,255,0.18);border-radius:3px;flex-shrink:0;`;

    squares.appendChild(refSq);
    squares.appendChild(sampleSq);
    entry.appendChild(squares);

    // Patch name + ΔE
    const nameEl = document.createElement("div");
    nameEl.className = "text-[9px] text-slate-200 text-center leading-tight font-medium";
    nameEl.textContent = `${id}  ΔE ${dE.toFixed(2)}`;
    entry.appendChild(nameEl);

    // Ink values
    if (inkLabel) {
      const inkEl = document.createElement("div");
      inkEl.className = "text-[8px] text-slate-400 text-center leading-tight";
      inkEl.textContent = inkLabel;
      entry.appendChild(inkEl);
    }

    scroll.appendChild(entry);
  });
}

// -----------------------------------------------------------------------------
// PATCH CLICK → DETAILS PANEL
// -----------------------------------------------------------------------------

function handlePatchClick(id) {
  if (!patchDetailsPanel || !refPatches || !refPatches[id]) return;

  patchDetailsPanel.classList.remove("hidden");

  const ref = refPatches[id];
  const sample = samplePatches ? samplePatches[id] : null;

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

  // --- TAC Calculation -------------------------------------------------------
  let refTAC = null;
  let sampleTAC = null;

  if (ref.indexValues && channels.length > 0) {
    let sum = 0;
    channels.forEach((field) => {
      const v = ref.indexValues[field];
      if (typeof v === "number" && !Number.isNaN(v)) {
        sum += v;
      }
    });
    refTAC = sum;
  }

  if (sample && sample.indexValues && channels.length > 0) {
    let sum = 0;
    channels.forEach((field) => {
      const v = sample.indexValues[field];
      if (typeof v === "number" && !Number.isNaN(v)) {
        sum += v;
      }
    });
    sampleTAC = sum;
  }

  // --- Repeatability (new) ---------------------------------------------------
  const refRep = ref.repeatStats || null;
  const sampleRep = sample ? sample.repeatStats || null : null;

  let refRepHtml = `
    <div class="text-slate-500 text-[11px]">
      No repeatability data (1 file) for reference.
    </div>
  `;
  if (refRep && refRep.count > 1) {
    refRepHtml = `
      <div class="text-slate-300 text-[11px]">
        N = ${refRep.count} ref files ·
        σL = ${fmt(refRep.stdL, 2)},
        σa = ${fmt(refRep.stdA, 2)},
        σb = ${fmt(refRep.stdB, 2)}<br/>
        mean ΔE00 (vs mean) = ${fmt(refRep.meanDE, 2)},
        max ΔE00 = ${fmt(refRep.maxDE, 2)}
      </div>
    `;
  }

  let sampleRepHtml = `
    <div class="text-slate-500 text-[11px]">
      No repeatability data (1 file) for sample.
    </div>
  `;
  if (sampleRep && sampleRep.count > 1) {
    sampleRepHtml = `
      <div class="text-slate-300 text-[11px]">
        N = ${sampleRep.count} sample files ·
        σL = ${fmt(sampleRep.stdL, 2)},
        σa = ${fmt(sampleRep.stdA, 2)},
        σb = ${fmt(sampleRep.stdB, 2)}<br/>
        mean ΔE00 (vs mean) = ${fmt(sampleRep.meanDE, 2)},
        max ΔE00 = ${fmt(sampleRep.maxDE, 2)}
      </div>
    `;
  }

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

    const barSource = sampleVal != null ? sampleVal : refVal;
    if (barSource == null) return;

    const v = Math.max(0, Math.min(100, barSource));
    const width = Math.max(3, Math.round(v));

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
        ${refTAC != null || sampleTAC != null ? `
        <div class="text-slate-300">
          <span class="text-slate-400">TAC:</span>
          Ref: ${refTAC != null ? fmtInt(refTAC) + '%' : '–'}${sampleTAC != null ? ' · Sample: ' + fmtInt(sampleTAC) + '%' : ''}
        </div>
        ` : ''}


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

        <div class="mt-1 border-t border-slate-700 pt-1">
          <div class="font-semibold text-slate-200 mb-1">Repeatability</div>
          <div class="space-y-0.5">
            <div><span class="text-slate-400">Reference:</span> ${refRepHtml}</div>
            <div><span class="text-slate-400">Sample:</span> ${sampleRepHtml}</div>
          </div>
        </div>
      </div>

      <!-- Color chips + index chart -->
      <div class="flex flex-col items-center justify-center gap-3">
        <div class="flex gap-4 items-center">
          <div class="flex flex-col items-center gap-1">
            <div class="w-20 h-12 rounded border border-slate-600" style="background:${refCss};"></div>
            <div class="text-[10px] text-slate-300">Reference</div>
          </div>
          <div class="flex flex-col items-center gap-1">
            <div class="w-20 h-12 rounded border border-slate-600" style="background:${sampleCss};"></div>
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

  //   // 🔹 NEW: TAC synthetic option
  const tacOpt = document.createElement("option");
  tacOpt.value = "TAC";
  tacOpt.textContent = "TAC (Total Area Coverage)";
  indexChannelSelect.appendChild(tacOpt);

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
        patchMap: res.patchMap,
        layoutMeta: res.layoutMeta,
      }))
    )
  );

  const fileNames = results.map((r) => r.name);

  // 2) Union of all patch IDs across files
  const allIdSet = new Set();
  results.forEach((r) => {
    Object.keys(r.patchMap).forEach((id) => allIdSet.add(id));
  });
  const allIds = Array.from(allIdSet);

  if (!allIds.length) {
    throw new Error("No patches found in selected CGATS files.");
  }

  const averagedPatchMap = {};

  // helper for std dev
  const stdDev = (arr) => {
    const n = arr.length;
    if (n < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const varSum = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0);
    return Math.sqrt(varSum / (n - 1));
  };

  allIds.forEach((id) => {
    let metaRef = null;
    let sumL = 0;
    let sumA = 0;
    let sumB = 0;
    let countLab = 0;

    const sumIndexValues = {}; // field → { sum, count }
    const measurements = [];   // per-file Lab for repeatability

    results.forEach((r) => {
      const p = r.patchMap[id];
      if (!p) return; // this file doesn’t have that patch

      if (!metaRef) metaRef = p;

      if (typeof p.L === "number" && typeof p.a === "number" && typeof p.b === "number") {
        sumL += p.L;
        sumA += p.a;
        sumB += p.b;
        countLab++;

        measurements.push({
          L: p.L,
          a: p.a,
          b: p.b,
          indexValues: p.indexValues ? { ...p.indexValues } : {},
          fileName: r.name,
        });
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

    const meanL = sumL / countLab;
    const meanA = sumA / countLab;
    const meanB = sumB / countLab;

    // compute repeatability ΔE vs mean and std dev of L,a,b
    let repeatStats = null;
    if (measurements.length > 1) {
      const dEs = measurements.map((m) =>
        deltaE2000(
          { L: meanL, a: meanA, b: meanB },
          { L: m.L, a: m.a, b: m.b }
        )
      );

      const n = dEs.length;
      const sumDE = dEs.reduce((a, b) => a + b, 0);
      const meanDE = sumDE / n;
      const maxDE = Math.max(...dEs);

      const Lvals = measurements.map((m) => m.L);
      const avals = measurements.map((m) => m.a);
      const bvals = measurements.map((m) => m.b);

      repeatStats = {
        count: n,
        stdL: stdDev(Lvals),
        stdA: stdDev(avals),
        stdB: stdDev(bvals),
        meanDE,
        maxDE,
      };
    }

    const indexValues = {};
    for (const [field, agg] of Object.entries(sumIndexValues)) {
      if (agg.count > 0) {
        indexValues[field] = agg.sum / agg.count;
      }
    }

    averagedPatchMap[id] = {
      ...metaRef, // keeps page / row / col / sampleId, etc.
      L: meanL,
      a: meanA,
      b: meanB,
      indexValues,
      repeatStats, // NEW: per-patch variability for this set of files
    };
  });

  const averagedIds = Object.keys(averagedPatchMap);
  if (!averagedIds.length) {
    throw new Error("No common patches with valid Lab values across the selected files.");
  }

  // 4) Layout: use the first file as reference, intersect index fields
  const baseLayout = results[0].layoutMeta;
  const layoutMeta = { ...baseLayout };

  let idxFields = [...(baseLayout.indexFields || [])];
  for (let i = 1; i < results.length; i++) {
    const lf = results[i].layoutMeta.indexFields || [];
    idxFields = idxFields.filter((name) => lf.includes(name));
  }
  layoutMeta.indexFields = idxFields;

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

  if (numberOfStrips == null || numberOfStrips <= 0) {
    numberOfStrips = 1;
  }

  // LGOROWLENGTH represents the total number of rows across all strips
  let totalRows = lgoRowLength;
  if (totalRows == null || totalRows <= 0) {
    totalRows = totalPatches;
  }

  const rowsPerPage = Math.ceil(totalRows / numberOfStrips);

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
  div.dataset.patchId = id;
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
    // Clear any ranking highlight
    document.querySelectorAll(".patch-ranking-highlight").forEach((el) =>
      el.classList.remove("patch-ranking-highlight")
    );

    // Apply grid-selection highlight
    if (selectedPatchElement && selectedPatchElement !== div) {
      selectedPatchElement.classList.remove("patch-selected");
    }
    selectedPatchElement = div;
    div.classList.add("patch-selected");

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
  // For TAC or other high-range values, use the full maxDelta range
  // For ΔE values, cap the color gradient at 5
  const colorMax = maxDelta > 50 ? maxDelta : 5;
  const colorCapped = Math.min(dE, colorMax);
  const hueT = colorCapped / colorMax;

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
// TAC → WHITE TO EMERALD-700 GRADIENT
// -----------------------------------------------------------------------------

function tacValueToColor(tacValue, maxValue) {
  // Normalize TAC value to 0–1 range
  const t = Math.min(tacValue, maxValue) / maxValue;

  // White (255, 255, 255) at 0% → emerald-700 (4, 120, 87) at 100%
  const r = Math.round(255 * (1 - t) + 4 * t);
  const g = Math.round(255 * (1 - t) + 120 * t);
  const b = Math.round(255 * (1 - t) + 87 * t);

  return `rgb(${r}, ${g}, ${b})`;
}

// -----------------------------------------------------------------------------
// GRAPH GRID — expand / minimize
// -----------------------------------------------------------------------------

const ICON_EXPAND = `<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
  <polyline points="9,1 13,1 13,5"/><polyline points="5,13 1,13 1,9"/>
  <line x1="13" y1="1" x2="8" y2="6"/><line x1="1" y1="13" x2="6" y2="8"/>
</svg>`;

const ICON_MINIMIZE = `<svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
  <polyline points="8,6 13,6 13,1"/><polyline points="6,8 1,8 1,13"/>
  <line x1="13" y1="1" x2="8" y2="6"/><line x1="1" y1="13" x2="6" y2="8"/>
</svg>`;

let expandedGraphId = null;

function initGraphExpandButtons() {
  const cells = document.querySelectorAll(".graph-cell");
  cells.forEach((cell) => {
    // Avoid duplicate buttons if called again
    if (cell.querySelector(".graph-expand-btn")) return;

    const btn = document.createElement("button");
    btn.className = "graph-expand-btn";
    btn.title = "Expand";
    btn.innerHTML = ICON_EXPAND;
    btn.addEventListener("click", () => toggleGraphExpand(cell.id));
    cell.appendChild(btn);
  });
}

function toggleGraphExpand(id) {
  const cells = document.querySelectorAll(".graph-cell");

  if (expandedGraphId === id) {
    // Minimize — restore all cells
    expandedGraphId = null;
    cells.forEach((cell) => {
      cell.classList.remove("graph-expanded");
      cell.style.display = "";
      const btn = cell.querySelector(".graph-expand-btn");
      if (btn) { btn.title = "Expand"; btn.innerHTML = ICON_EXPAND; }
    });
  } else {
    // Expand this cell, hide others
    expandedGraphId = id;
    cells.forEach((cell) => {
      if (cell.id === id) {
        cell.classList.add("graph-expanded");
        cell.style.display = "";
        const btn = cell.querySelector(".graph-expand-btn");
        if (btn) { btn.title = "Minimize"; btn.innerHTML = ICON_MINIMIZE; }
      } else {
        cell.style.display = "none";
      }
    });
  }
}

function highlightGraphPatch(id) {
  highlightedGraphPatchId = id;
  // Re-render all four graphs with the new highlight
  const deltaMap = buildDeltaMap();
  renderGraph1(deltaMap, highlightedGraphPatchId);
  renderBullseyePlot("graph-2", "da", "db", "← ∆a →", "← ∆b →", "∆a vs ∆b", highlightedGraphPatchId);
  renderBullseyePlot("graph-3", "da", "dL", "← ∆a →", "← ∆L →", "∆a vs ∆L", highlightedGraphPatchId);
  renderBullseyePlot("graph-4", "db", "dL", "← ∆b →", "← ∆L →", "∆b vs ∆L", highlightedGraphPatchId);
}

function buildDeltaMap() {
  if (!refPatches || !samplePatches) return null;
  const deltaMap = {};
  Object.keys(refPatches).forEach((id) => {
    const r = refPatches[id];
    const s = samplePatches[id];
    if (r && s) deltaMap[id] = deltaE2000(r, s);
  });
  return Object.keys(deltaMap).length ? deltaMap : null;
}

// -----------------------------------------------------------------------------
// GRAPH VIEW — chart renderers
// -----------------------------------------------------------------------------

function graphCellContent(id) {
  const container = document.getElementById(id);
  if (!container) return null;
  let inner = container.querySelector(".graph-cell-content");
  if (!inner) {
    inner = document.createElement("div");
    inner.className = "graph-cell-content w-full h-full";
    // Insert before the expand button so button stays on top
    container.insertBefore(inner, container.firstChild);
  }
  return inner;
}

function renderBullseyePlot(graphId, xKey, yKey, xLabel, yLabel, title, highlightId = null) {
  const inner = graphCellContent(graphId);
  if (!inner) return;

  if (!refPatches || !samplePatches) {
    inner.innerHTML = `<div class="text-slate-500 text-xs italic p-2">Load reference &amp; sample chart to see scatter plot.</div>`;
    return;
  }

  // Collect delta pairs
  const points = [];
  let highlightPt = null;
  Object.keys(refPatches).forEach((id) => {
    const ref    = refPatches[id];
    const sample = samplePatches[id];
    if (!ref || !sample) return;
    const vals = {
      dL: sample.L - ref.L,
      da: sample.a - ref.a,
      db: sample.b - ref.b,
    };
    const x = vals[xKey], y = vals[yKey];
    if (isNaN(x) || isNaN(y)) return;
    const pt = { x, y };
    points.push(pt);
    if (id === highlightId) highlightPt = pt;
  });

  if (!points.length) {
    inner.innerHTML = `<div class="text-slate-500 text-xs italic p-2">No common patches found.</div>`;
    return;
  }

  // Layout
  const vW = 300, vH = 300;
  const ml = 32, mr = 18, mt = 26, mb = 32;
  const iW = vW - ml - mr, iH = vH - mt - mb;
  const cx = ml + iW / 2, cy = mt + iH / 2;
  const plotR = Math.min(iW, iH) / 2;

  // Scale: biggest absolute value determines ring count
  const maxAbs = Math.max(
    Math.ceil(Math.max(...points.map((p) => Math.abs(p.x)), ...points.map((p) => Math.abs(p.y)))),
    2
  );
  const scale = plotR / maxAbs;
  const clipId = `clip-${graphId}`;

  // ── Concentric rings ──────────────────────────────────────────────────────
  let rings = "";
  for (let r = 1; r <= maxAbs; r++) {
    const cr = (r * scale).toFixed(1);
    const isTwo = r === 2;
    rings += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${cr}"
      fill="none"
      stroke="${isTwo ? "#f59e0b" : "#1e3a5f"}"
      stroke-width="${isTwo ? 1.2 : 0.8}"
      ${isTwo ? 'stroke-dasharray="5,3" opacity="0.75"' : ""}/>`;
  }

  // ── Ring labels on positive x-axis ───────────────────────────────────────
  let ringLabels = "";
  for (let r = 1; r <= maxAbs; r++) {
    const lx = (cx + r * scale).toFixed(1);
    ringLabels += `<text x="${lx}" y="${(cy + 9).toFixed(1)}"
      text-anchor="middle" fill="${r === 2 ? "#f59e0b" : "#334155"}"
      font-size="8">${r}</text>`;
  }
  // Label for "0" at origin
  ringLabels += `<text x="${(cx - 4).toFixed(1)}" y="${(cy + 9).toFixed(1)}"
    text-anchor="end" fill="#334155" font-size="8">0</text>`;

  // ── Negative axis labels (left of origin, above origin) ──────────────────
  for (let r = 1; r <= maxAbs; r++) {
    const lxNeg = (cx - r * scale).toFixed(1);
    ringLabels += `<text x="${lxNeg}" y="${(cy + 9).toFixed(1)}"
      text-anchor="middle" fill="#334155" font-size="8">−${r}</text>`;
    // Y-axis: positive = up, negative = down
    const lyPos = (cy - r * scale).toFixed(1);
    const lyNeg = (cy + r * scale).toFixed(1);
    ringLabels += `<text x="${(cx - 5).toFixed(1)}" y="${lyPos}"
      text-anchor="end" dominant-baseline="middle" fill="#334155" font-size="8">${r}</text>`;
    ringLabels += `<text x="${(cx - 5).toFixed(1)}" y="${lyNeg}"
      text-anchor="end" dominant-baseline="middle" fill="#334155" font-size="8">−${r}</text>`;
  }

  // ── Data dots ─────────────────────────────────────────────────────────────
  let dots = "";
  points.forEach(({ x, y }) => {
    const px = (cx + x * scale).toFixed(1);
    const py = (cy - y * scale).toFixed(1); // SVG y inverted
    dots += `<circle cx="${px}" cy="${py}" r="2.5"
      fill="rgba(52,211,153,0.65)" stroke="rgba(16,185,129,0.35)" stroke-width="0.8"/>`;
  });

  // ── Highlight dot ─────────────────────────────────────────────────────────
  let highlightDot = "";
  if (highlightPt) {
    const hx = (cx + highlightPt.x * scale).toFixed(1);
    const hy = (cy - highlightPt.y * scale).toFixed(1);
    highlightDot = `
      <circle cx="${hx}" cy="${hy}" r="7"
        fill="none" stroke="rgba(239,68,68,0.5)" stroke-width="1.5"/>
      <circle cx="${hx}" cy="${hy}" r="4"
        fill="rgb(239,68,68)" stroke="rgb(255,255,255)" stroke-width="1"/>`;
  }

  inner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 ${vW} ${vH}" style="width:100%;height:100%;display:block;">
    <defs>
      <clipPath id="${clipId}">
        <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${plotR.toFixed(1)}"/>
      </clipPath>
    </defs>

    <!-- Title -->
    <text x="${cx.toFixed(1)}" y="16" text-anchor="middle"
      fill="#cbd5e1" font-size="11" font-weight="600"
      font-family="Quicksand,system-ui">${title}</text>

    <!-- Rings -->
    ${rings}

    <!-- Crosshair -->
    <line x1="${(cx - plotR).toFixed(1)}" y1="${cy.toFixed(1)}"
          x2="${(cx + plotR).toFixed(1)}" y2="${cy.toFixed(1)}"
          stroke="#334155" stroke-width="0.8"/>
    <line x1="${cx.toFixed(1)}" y1="${(cy - plotR).toFixed(1)}"
          x2="${cx.toFixed(1)}" y2="${(cy + plotR).toFixed(1)}"
          stroke="#334155" stroke-width="0.8"/>

    <!-- Origin dot -->
    <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2"
      fill="#475569"/>

    <!-- Ring + axis labels -->
    ${ringLabels}

    <!-- Data points, clipped to plot circle -->
    <g clip-path="url(#${clipId})">${dots}${highlightDot}</g>

    <!-- Axis labels -->
    <text x="${cx.toFixed(1)}" y="${(vH - 4).toFixed(1)}"
      text-anchor="middle" fill="#64748b" font-size="10">${xLabel}</text>
    <text transform="rotate(-90)"
      x="${(-cy).toFixed(1)}" y="10"
      text-anchor="middle" fill="#64748b" font-size="10">${yLabel}</text>
  </svg>`;
}

function renderGraph1(deltaMap, highlightId = null) {
  const inner = graphCellContent("graph-1");
  if (!inner) return;

  if (!deltaMap) {
    inner.innerHTML =
      `<div class="text-slate-500 text-xs italic p-2">
         Load a reference &amp; sample chart to see ΔE distribution.
       </div>`;
    return;
  }

  const values = Object.values(deltaMap)
    .filter(v => typeof v === "number" && !isNaN(v))
    .sort((a, b) => a - b);

  if (!values.length) {
    inner.innerHTML = `<div class="text-slate-500 text-xs italic p-2">No ΔE data.</div>`;
    return;
  }

  const n = values.length;

  // SVG dimensions
  const vW = 500, vH = 280;
  const ml = 46, mr = 36, mt = 24, mb = 48;
  const iW = vW - ml - mr;
  const iH = vH - mt - mb;

  const yMax = Math.max(Math.ceil(Math.max(...values)), 5);
  const refDE = 2;

  const xPos = pct  => ml + (pct / 100) * iW;
  const yPos = de   => mt + iH - (de / yMax) * iH;

  // ── CFD polyline ──────────────────────────────────────────────────────────
  // each patch i → x = (i+1)/n × 100%, y = values[i]
  const pts = values
    .map((v, i) => `${xPos((i + 1) / n * 100).toFixed(1)},${yPos(v).toFixed(1)}`)
    .join(" ");

  // ── Crossing point at ΔE = refDE ─────────────────────────────────────────
  let crossPct = null;
  if (values[0] >= refDE) {
    crossPct = 0;
  } else if (values[n - 1] < refDE) {
    crossPct = 100;
  } else {
    const idx = values.findIndex(v => v >= refDE);
    if (idx > 0) {
      const x0 = idx / n * 100;
      const x1 = (idx + 1) / n * 100;
      crossPct = x0 + (x1 - x0) * (refDE - values[idx - 1]) / (values[idx] - values[idx - 1]);
    }
  }

  // ── Horizontal grid lines (every 1 ΔE step) ───────────────────────────────
  let gridLines = "";
  for (let de = 1; de <= yMax; de++) {
    const y = yPos(de).toFixed(1);
    const isRef = de === refDE;
    gridLines += `<line x1="${ml}" y1="${y}" x2="${ml + iW}" y2="${y}"
      stroke="${isRef ? '#f59e0b' : '#1e293b'}"
      stroke-width="${isRef ? 1.5 : 1}"
      stroke-dasharray="${isRef ? '6,4' : 'none'}" />`;
  }

  // ── Y-axis labels ─────────────────────────────────────────────────────────
  let yLabels = "";
  for (let de = 0; de <= yMax; de++) {
    const y = yPos(de).toFixed(1);
    const isRef = de === refDE;
    yLabels += `<text x="${ml - 7}" y="${y}" text-anchor="end" dominant-baseline="middle"
      fill="${isRef ? '#f59e0b' : '#64748b'}" font-size="10">${de}</text>`;
  }

  // ── X-axis ticks + labels (every 20%) ─────────────────────────────────────
  let xLabels = "";
  for (let pct = 0; pct <= 100; pct += 20) {
    const x = xPos(pct).toFixed(1);
    const yBase = (mt + iH).toFixed(1);
    xLabels += `<line x1="${x}" y1="${yBase}" x2="${x}" y2="${(mt + iH + 4).toFixed(1)}"
      stroke="#475569" stroke-width="1" />`;
    xLabels += `<text x="${x}" y="${(mt + iH + 14).toFixed(1)}" text-anchor="middle"
      fill="#64748b" font-size="10">${pct}%</text>`;
  }

  // ── Crossing annotation ───────────────────────────────────────────────────
  let crossingMarkup = "";
  if (crossPct !== null) {
    const cx = xPos(crossPct).toFixed(1);
    const cy = yPos(refDE).toFixed(1);
    const yBase = (mt + iH).toFixed(1);
    crossingMarkup = `
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${yBase}"
        stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,3" />
      <circle cx="${cx}" cy="${cy}" r="3.5" fill="#f59e0b" />
      <text x="${cx}" y="${(mt + iH + 30).toFixed(1)}" text-anchor="middle"
        fill="#f59e0b" font-size="10" font-weight="bold">${crossPct.toFixed(1)}%</text>`;
  }

  // ── Highlighted patch marker ──────────────────────────────────────────────
  let highlightMarkup = "";
  if (highlightId && deltaMap[highlightId] != null) {
    const hDE = deltaMap[highlightId];
    // find its rank in the sorted array
    const rank = values.filter(v => v <= hDE).length;
    const hPct = rank / n * 100;
    const hx = xPos(hPct).toFixed(1);
    const hy = yPos(hDE).toFixed(1);
    const yBase = (mt + iH).toFixed(1);
    highlightMarkup = `
      <line x1="${hx}" y1="${mt}" x2="${hx}" y2="${yBase}"
        stroke="rgba(239,68,68,0.35)" stroke-width="1" stroke-dasharray="3,3"/>
      <circle cx="${hx}" cy="${hy}" r="5"
        fill="none" stroke="rgba(239,68,68,0.5)" stroke-width="1.5"/>
      <circle cx="${hx}" cy="${hy}" r="3"
        fill="rgb(239,68,68)" stroke="white" stroke-width="1"/>`;
  }

  inner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${vW} ${vH}" style="width:100%;height:100%;display:block;">

    <!-- Title -->
    <text x="${ml}" y="13" fill="#cbd5e1" font-size="11" font-weight="600"
      font-family="Quicksand,system-ui">Cumulative ΔE2000 distribution</text>

    <!-- Grid -->
    ${gridLines}

    <!-- Axes -->
    <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + iH}" stroke="#334155" stroke-width="1" />
    <line x1="${ml}" y1="${mt + iH}" x2="${ml + iW}" y2="${mt + iH}" stroke="#334155" stroke-width="1" />

    <!-- Y-axis labels -->
    ${yLabels}
    <!-- Y-axis title -->
    <text transform="rotate(-90)" x="${-(mt + iH / 2).toFixed(0)}" y="11"
      text-anchor="middle" fill="#475569" font-size="10">ΔE2000</text>

    <!-- X-axis labels & ticks -->
    ${xLabels}
    <!-- X-axis title -->
    <text x="${(ml + iW / 2).toFixed(1)}" y="${(vH - 4).toFixed(1)}"
      text-anchor="middle" fill="#475569" font-size="10">Cumulative % of patches</text>

    <!-- ΔE=2 reference label -->
    <text x="${(ml + iW + 4).toFixed(1)}" y="${yPos(refDE).toFixed(1)}"
      dominant-baseline="middle" fill="#f59e0b" font-size="9" font-weight="600">ΔE 2</text>

    <!-- CFD line -->
    <polyline points="${pts}" fill="none" stroke="#34d399"
      stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

    <!-- Crossing annotation -->
    ${crossingMarkup}

    <!-- Highlighted patch -->
    ${highlightMarkup}
  </svg>`;
}

// -----------------------------------------------------------------------------
// INITIALIZE DEFAULT VIEW MODE
// -----------------------------------------------------------------------------

setViewMode("refColors");
