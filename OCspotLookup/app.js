const state = {
  baseUrl: "",
  projects: [],
  filteredProjects: [],
  selectedProjectIds: new Set(),
  sortKey: "projectName",
  sortDirection: "asc",
  requestedColors: [],
  resultsByProjectId: new Map()
};

const els = {
  hostInput: document.getElementById("hostInput"),
  connectButton: document.getElementById("connectButton"),
  connectionStatus: document.getElementById("connectionStatus"),
  greenThresholdInput: document.getElementById("greenThresholdInput"),
  orangeThresholdInput: document.getElementById("orangeThresholdInput"),
  globalSearchInput: document.getElementById("globalSearchInput"),
  columnFilterSelect: document.getElementById("columnFilterSelect"),
  selectVisibleButton: document.getElementById("selectVisibleButton"),
  clearSelectionButton: document.getElementById("clearSelectionButton"),
  selectionHint: document.getElementById("selectionHint"),
  colorInput: document.getElementById("colorInput"),
  runLookupButton: document.getElementById("runLookupButton"),
  clearResultsButton: document.getElementById("clearResultsButton"),
  tableHead: document.getElementById("tableHead"),
  tableBody: document.getElementById("tableBody"),
  tableSummary: document.getElementById("tableSummary"),
  loadingIndicator: document.getElementById("loadingIndicator")
};

const BASE_COLUMNS = [
  { key: "selected", label: "", sortable: false },
  { key: "projectName", label: "Project Name", sortable: true },
  { key: "lastChangedDisplay", label: "Last Changed", sortable: true },
  { key: "printProcess", label: "Print Process", sortable: true },
  { key: "media", label: "Media", sortable: true },
  { key: "keywords", label: "Keywords", sortable: true }
];

init();

function init() {
  els.hostInput.value = localStorage.getItem("projectMatcher.host") || "";

  els.connectButton.addEventListener("click", loadProjects);
  els.globalSearchInput.addEventListener("input", applyFiltersAndRender);
  els.columnFilterSelect.addEventListener("change", applyFiltersAndRender);
  els.selectVisibleButton.addEventListener("click", selectVisibleProjects);
  els.clearSelectionButton.addEventListener("click", clearSelection);
  els.runLookupButton.addEventListener("click", runDeltaELookup);
  els.clearResultsButton.addEventListener("click", clearResults);
  els.greenThresholdInput.addEventListener("input", renderTable);
  els.orangeThresholdInput.addEventListener("input", renderTable);

  renderTable();
  updateSelectionHint();
}

async function loadProjects() {
  const host = sanitizeHost(els.hostInput.value);
  const endpoint = "/separationProjects";

  if (!host) {
    setStatus("Please enter an IP:port first.", "error");
    return;
  }

  state.baseUrl = `http://${host}`;
  localStorage.setItem("projectMatcher.host", host);

  setLoading(true);
  setStatus("Connecting…", "");

  try {
    const response = await fetch(`${state.baseUrl}${endpoint}`, { method: "GET" });
    console.log("Project list URL:", `${state.baseUrl}${endpoint}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    const xmlDoc = parseXml(xmlText);
    state.projects = parseProjectsXml(xmlDoc);
    state.selectedProjectIds.clear();
    state.resultsByProjectId.clear();

    applyFiltersAndRender();
    setStatus(`Connected · ${state.projects.length} projects loaded`, "connected");
  } catch (error) {
    console.error(error);
    setStatus(`Connection failed: ${error.message}`, "error");
  } finally {
    setLoading(false);
  }
}

function parseProjectsXml(xmlDoc) {
  const projectNodes = Array.from(xmlDoc.querySelectorAll("projects > project, project"));

  return projectNodes.map(projectNode => {
    const projectId = text(projectNode, "projectId");
    const lastChangeIso = text(projectNode, "projectLastChangeEx");
    const rawKeywords = text(projectNode, "projectKeywords");

    return {
      projectId,
      projectName: text(projectNode, "projectName"),
      lastChangedRaw: text(projectNode, "projectLastChange"),
      lastChangedIso: lastChangeIso,
      lastChangedDisplay: formatDate(lastChangeIso) || text(projectNode, "projectLastChange"),
      printProcess: text(projectNode, "projectProcess"),
      media: text(projectNode, "projectMedia"),
      keywords: decodeKeywords(rawKeywords)
    };
  }).filter(project => project.projectId && project.projectName);
}

function parseProjectDetailXml(xmlDoc) {
  const projectInks = Array.from(xmlDoc.querySelectorAll("projectSeparationRules > inks > ink")).map(inkNode => ({
    name: text(inkNode, "name"),
    lab: parseLab(text(inkNode, "lab")),
    rgb: labToRgb(parseLab(text(inkNode, "lab")))
  }));

  const inkNodes = Array.from(xmlDoc.querySelectorAll("projectSeparationRules projectSeparationRule > ink"));

  const colors = inkNodes.map(inkNode => {
    const sepValues = Array.from(inkNode.querySelectorAll("sepOutput > outputInk"))
      .map(node => Number.parseFloat(node.textContent.trim()));

    const separations = sepValues
      .map((value, index) => ({
        value,
        ink: projectInks[index]
      }))
      .filter(item => Number.isFinite(item.value) && item.value > 0 && item.ink);

    return {
      name: text(inkNode, "name"),
      deltaE: Number.parseFloat(text(inkNode, "deltaE")),
      separations
    };
  }).filter(color => color.name && Number.isFinite(color.deltaE));

  return colors;
}

async function runDeltaELookup() {
  const selectedProjects = state.projects.filter(project => state.selectedProjectIds.has(project.projectId));
  const requestedColors = getRequestedColors();

  if (!selectedProjects.length) {
    setStatus("Select at least one project before running the ∆E lookup.", "error");
    return;
  }

  if (!requestedColors.length) {
    setStatus("Enter at least one requested color before running the ∆E lookup.", "error");
    return;
  }

  state.requestedColors = requestedColors;
  state.resultsByProjectId.clear();

  setLoading(true);
  setStatus(`Checking ${selectedProjects.length} selected project(s)…`, "");

  for (const [index, project] of selectedProjects.entries()) {
    try {
      setStatus(`Checking ${index + 1}/${selectedProjects.length}: ${project.projectName}`, "");
      const detailUrl = `${state.baseUrl}/project/%7B${project.projectId}%7D`;
      const response = await fetch(detailUrl, { method: "GET" });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xmlText = await response.text();
      const xmlDoc = parseXml(xmlText);
      const availableColors = parseProjectDetailXml(xmlDoc);
      const matches = matchRequestedColors(requestedColors, availableColors);

      state.resultsByProjectId.set(project.projectId, {
        status: getOverallProjectStatus(matches),
        matches
      });

      renderTable();
    } catch (error) {
      console.error(error);
      const failedMatches = requestedColors.map(color => ({
        requestedName: color,
        matchedName: "",
        deltaE: null,
        status: "missing",
        note: error.message
      }));

      state.resultsByProjectId.set(project.projectId, {
        status: "red",
        matches: failedMatches
      });

      renderTable();
    }
  }

  setStatus(`Lookup complete · ${selectedProjects.length} project(s) checked`, "connected");
  setLoading(false);
}

function matchRequestedColors(requestedColors, availableColors) {
  return requestedColors.map(requestedName => {
    const normalizedRequested = normalizeForMatch(requestedName);

    // The rest of the name is matched loosely, but any number in the request
    // must appear as an exact number in the color name ("185" must not hit "1185").
    const candidates = availableColors.filter(color =>
      numbersCompatible(requestedName, color.name)
    );

    const exactish = candidates.find(color =>
      normalizeForMatch(color.name) === normalizedRequested
    );

    const partial = exactish || candidates.find(color => {
      const normalizedAvailable = normalizeForMatch(color.name);
      return normalizedAvailable.includes(normalizedRequested) ||
             normalizedRequested.includes(normalizedAvailable);
    });

    const fuzzy = partial || findBestTokenOverlapMatch(normalizedRequested, candidates);

    if (!fuzzy) {
      return {
        requestedName,
        matchedName: "",
        deltaE: null,
        status: "missing",
        note: "No match"
      };
    }

    return {
      requestedName,
      matchedName: fuzzy.name,
      deltaE: fuzzy.deltaE,
      status: getDeltaEStatus(fuzzy.deltaE),
      note: fuzzy.name,
      separations: fuzzy.separations || []
    };
  });
}

function findBestTokenOverlapMatch(normalizedRequested, availableColors) {
  const requestTokens = tokenize(normalizedRequested);
  let best = null;

  for (const color of availableColors) {
    const availableTokens = tokenize(normalizeForMatch(color.name));
    const score = requestTokens.filter(token => availableTokens.includes(token)).length;

    if (score > 0 && (!best || score > best.score)) {
      best = { color, score };
    }
  }

  return best ? best.color : null;
}

function getOverallProjectStatus(matches) {
  if (matches.some(match => match.status === "red" || match.status === "missing")) return "red";
  if (matches.some(match => match.status === "orange")) return "orange";
  return "green";
}

function getDeltaEStatus(deltaE) {
  const greenThreshold = Number.parseFloat(els.greenThresholdInput.value);
  const orangeThreshold = Number.parseFloat(els.orangeThresholdInput.value);

  if (!Number.isFinite(deltaE)) return "missing";
  if (deltaE <= greenThreshold) return "green";
  if (deltaE <= orangeThreshold) return "orange";
  return "red";
}

function applyFiltersAndRender() {
  const searchValue = normalizeSearch(els.globalSearchInput.value);
  const column = els.columnFilterSelect.value;

  state.filteredProjects = state.projects.filter(project => {
    if (!searchValue) return true;

    if (column !== "all") {
      return normalizeSearch(project[column]).includes(searchValue);
    }

    return [
      project.projectName,
      project.lastChangedDisplay,
      project.printProcess,
      project.media,
      project.keywords
    ].some(value => normalizeSearch(value).includes(searchValue));
  });

  sortFilteredProjects();
  renderTable();
}

function sortFilteredProjects() {
  const { sortKey, sortDirection } = state;
  const direction = sortDirection === "asc" ? 1 : -1;

  state.filteredProjects.sort((a, b) => {
    const aValue = normalizeSearch(a[sortKey]);
    const bValue = normalizeSearch(b[sortKey]);

    if (aValue < bValue) return -1 * direction;
    if (aValue > bValue) return 1 * direction;
    return 0;
  });
}

function renderTable() {
  const colorColumns = state.requestedColors.map(color => ({
    key: `color:${color}`,
    label: color,
    sortable: false
  }));

  const columns = [...BASE_COLUMNS, ...colorColumns];

  els.tableHead.innerHTML = `
    <tr>
      ${columns.map(col => renderHeaderCell(col)).join("")}
    </tr>
  `;

  els.tableBody.innerHTML = state.filteredProjects.map(project => renderProjectRow(project, columns)).join("");

  wireTableEvents();

  const selectedVisibleCount = state.filteredProjects.filter(project => state.selectedProjectIds.has(project.projectId)).length;
  els.tableSummary.textContent = `${state.filteredProjects.length} visible of ${state.projects.length} loaded · ${state.selectedProjectIds.size} selected (${selectedVisibleCount} visible)`;
  updateSelectionHint();
}

function renderHeaderCell(col) {
  if (col.key === "selected") {
    return `<th><input type="checkbox" id="selectAllVisibleCheckbox" title="Select all visible projects" /></th>`;
  }

  const sortMarker = col.key === state.sortKey
    ? state.sortDirection === "asc" ? " ↑" : " ↓"
    : "";

  return `
    <th class="${col.sortable ? "sortable" : ""}" data-sort-key="${col.sortable ? col.key : ""}">
      ${escapeHtml(col.label)}${sortMarker}
    </th>
  `;
}

function renderProjectRow(project, columns) {
  const result = state.resultsByProjectId.get(project.projectId);
  const rowClass = result ? `row-${result.status}` : "";

  return `
    <tr class="${rowClass}" data-project-id="${escapeHtml(project.projectId)}">
      ${columns.map(col => renderProjectCell(project, col, result)).join("")}
    </tr>
  `;
}

function renderProjectCell(project, col, result) {
  if (col.key === "selected") {
    const checked = state.selectedProjectIds.has(project.projectId) ? "checked" : "";
    return `<td><input type="checkbox" class="row-select" data-project-id="${escapeHtml(project.projectId)}" ${checked} /></td>`;
  }

  if (col.key.startsWith("color:")) {
    const requestedColor = col.key.replace("color:", "");
    const match = result?.matches?.find(item => item.requestedName === requestedColor);
    return `<td class="de-cell">${renderDeltaEBadge(match)}</td>`;
  }

  if (col.key === "projectName") {
    return `<td class="project-name-cell">${escapeHtml(project.projectName)}</td>`;
  }

  if (col.key === "keywords") {
    return `<td class="keyword-cell">${escapeHtml(project.keywords)}</td>`;
  }

  return `<td>${escapeHtml(project[col.key] || "")}</td>`;
}

function renderDeltaEBadge(match) {
  if (!match) return `<span class="muted">—</span>`;

  const smiley = {
    green: "😊",
    orange: "😐",
    red: "☹️",
    missing: "❌"
  }[match.status] || "—";

  const value = Number.isFinite(match.deltaE) ? `∆E ${match.deltaE.toFixed(2)}` : "No match";
  const note = match.note ? `<span class="small-note">${escapeHtml(match.note)}</span>` : "";
  const separations = renderSeparations(match.separations || []);

  return `
    <span class="de-badge ${match.status}">
      <span>${smiley}</span>
      <span>${escapeHtml(value)}</span>
    </span>
    ${note}
    ${separations}
  `;
}

function wireTableEvents() {
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const sortKey = th.dataset.sortKey;
      if (!sortKey) return;

      if (state.sortKey === sortKey) {
        state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = sortKey;
        state.sortDirection = "asc";
      }

      sortFilteredProjects();
      renderTable();
    });
  });

  document.querySelectorAll(".row-select").forEach(checkbox => {
    checkbox.addEventListener("change", event => {
      const projectId = event.target.dataset.projectId;
      if (event.target.checked) {
        state.selectedProjectIds.add(projectId);
      } else {
        state.selectedProjectIds.delete(projectId);
      }
      renderTable();
    });
  });

  const selectAllCheckbox = document.getElementById("selectAllVisibleCheckbox");
  if (selectAllCheckbox) {
    const visibleCount = state.filteredProjects.length;
    const selectedVisibleCount = state.filteredProjects.filter(project => state.selectedProjectIds.has(project.projectId)).length;

    selectAllCheckbox.checked = visibleCount > 0 && selectedVisibleCount === visibleCount;
    selectAllCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleCount;

    selectAllCheckbox.addEventListener("change", event => {
      if (event.target.checked) {
        selectVisibleProjects();
      } else {
        state.filteredProjects.forEach(project => state.selectedProjectIds.delete(project.projectId));
        renderTable();
      }
    });
  }
}

function selectVisibleProjects() {
  state.filteredProjects.forEach(project => state.selectedProjectIds.add(project.projectId));
  renderTable();
}

function clearSelection() {
  state.selectedProjectIds.clear();
  renderTable();
}

function clearResults() {
  state.requestedColors = [];
  state.resultsByProjectId.clear();
  renderTable();
}

function updateSelectionHint() {
  if (!state.projects.length) {
    els.selectionHint.textContent = "Connect to your OpenColor first. Then filter the list and select projects before running the ∆E lookup.";
    return;
  }

  if (!state.selectedProjectIds.size) {
    els.selectionHint.textContent = "Select one or more projects before running the ∆E lookup.";
    return;
  }

  els.selectionHint.textContent = `${state.selectedProjectIds.size} project(s) selected. Enter requested colors and run the ∆E lookup.`;
}

function getRequestedColors() {
  return els.colorInput.value
    .split(/\r?\n|,/)
    .map(value => value.trim())
    .filter(Boolean);
}

function parseXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");

  if (parserError) {
    throw new Error("API returned invalid XML.");
  }

  return doc;
}

function text(parent, selector) {
  return parent.querySelector(selector)?.textContent?.trim() || "";
}

function sanitizeHost(value) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/g, "");
}

function sanitizeEndpoint(value) {
  const clean = value.trim() || "/api/projects";
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function decodeKeywords(value) {
  if (!value) return "";

  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value.replace(/\+/g, " ");
  }
}

function formatDate(isoValue) {
  if (!isoValue) return "";

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().trim();
}

function normalizeForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function tokenize(value) {
  return String(value || "").match(/[a-z]+|\d+/g) || [];
}

function numericTokens(value) {
  return String(value || "").match(/\d+/g) || [];
}

// True when every number in the request appears as a whole number in the
// color name. Requests without a number are unconstrained (fully loose).
function numbersCompatible(requestedName, colorName) {
  const requestedNumbers = numericTokens(requestedName);
  if (!requestedNumbers.length) return true;

  const colorNumbers = numericTokens(colorName);
  return requestedNumbers.every(number => colorNumbers.includes(number));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSeparations(separations) {
  if (!separations.length) return "";

  return `
    <div class="separation-strip">
      ${separations.map(item => `
        <div class="separation-item" title="${escapeHtml(item.ink.name)}: ${item.value.toFixed(2)}%">
          <span 
            class="separation-square" 
            style="background-color: rgb(${item.ink.rgb.r}, ${item.ink.rgb.g}, ${item.ink.rgb.b});"
          ></span>
          <span class="separation-value">${item.value.toFixed(1)}%</span>
        </div>
      `).join("")}
    </div>
  `;
}

function parseLab(value) {
  const parts = String(value || "")
    .split(",")
    .map(part => Number.parseFloat(part.trim()));

  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) {
    return null;
  }

  return {
    l: parts[0],
    a: parts[1],
    b: parts[2]
  };
}

function labToRgb(lab) {
  if (!lab) {
    return { r: 200, g: 200, b: 200 };
  }

  const y = (lab.l + 16) / 116;
  const x = lab.a / 500 + y;
  const z = y - lab.b / 200;

  const xyz = [x, y, z].map(value => {
    const cubed = value ** 3;
    return cubed > 0.008856 ? cubed : (value - 16 / 116) / 7.787;
  });

  let [X, Y, Z] = [
    xyz[0] * 95.047,
    xyz[1] * 100.000,
    xyz[2] * 108.883
  ];

  X /= 100;
  Y /= 100;
  Z /= 100;

  let r = X * 3.2406 + Y * -1.5372 + Z * -0.4986;
  let g = X * -0.9689 + Y * 1.8758 + Z * 0.0415;
  let b = X * 0.0557 + Y * -0.2040 + Z * 1.0570;

  [r, g, b] = [r, g, b].map(value => {
    return value > 0.0031308
      ? 1.055 * (value ** (1 / 2.4)) - 0.055
      : 12.92 * value;
  });

  return {
    r: clampRgb(r * 255),
    g: clampRgb(g * 255),
    b: clampRgb(b * 255)
  };
}

function clampRgb(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function setLoading(isLoading) {
  els.loadingIndicator.classList.toggle("hidden", !isLoading);
  els.connectButton.disabled = isLoading;
  els.runLookupButton.disabled = isLoading;
}

function setStatus(message, type) {
  els.connectionStatus.textContent = message;
  els.connectionStatus.className = "status-pill";
  if (type) els.connectionStatus.classList.add(type);
}
