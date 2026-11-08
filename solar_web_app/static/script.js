let devices = [
  { id: 1, name: "Tesla Model Y", power_kw: 7.2, duration_hours: 3, deadline: 19, enabled: true },
  { id: 2, name: "Central AC Pre-Cool", power_kw: 3.5, duration_hours: 2, deadline: 16, enabled: true },
  { id: 3, name: "Heat Pump Water Heater", power_kw: 1.5, duration_hours: 2, deadline: 23, enabled: true },
  { id: 4, name: "Smart Pool Pump", power_kw: 1.8, duration_hours: 4, deadline: 18, enabled: true }
];

let cachedHourlyData = [];
let cachedTariffs = { peak_rate: 0.52, off_rate: 0.16, export_credit: 0.06 };
let currentSort = { column: 'hour', direction: 'asc' };
let chartInstance = null;

// UI References
const zipInput = document.getElementById("zip-code");
const panelInput = document.getElementById("panel-kwp");
const kwpVal = document.getElementById("kwp-val");
const deviceList = document.getElementById("device-list");
const deviceForm = document.getElementById("device-form");
const editingIdInput = document.getElementById("editing-device-id");
const submitDeviceBtn = document.getElementById("submit-device-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const formHeading = document.getElementById("form-heading");
const calculateBtn = document.getElementById("calculate-btn");
const iotTriggerBtn = document.getElementById("iot-trigger-btn");

const tiltInput = document.getElementById("panel-tilt");
const tiltVal = document.getElementById("tilt-val");
const azimuthInput = document.getElementById("panel-azimuth");

panelInput.addEventListener("input", (e) => kwpVal.textContent = e.target.value);
tiltInput.addEventListener("input", (e) => tiltVal.textContent = e.target.value);
// Re-run the forecast when a panel setting changes, so the graph matches it
panelInput.addEventListener("change", fetchOptimization);
tiltInput.addEventListener("change", fetchOptimization);
azimuthInput.addEventListener("change", fetchOptimization);

// --- 1. DEVICE CRUD & EDITING ---
function renderDeviceList() {
  deviceList.innerHTML = "";
  devices.forEach((dev) => {
    const li = document.createElement("li");
    li.className = "device-item";
    li.innerHTML = `
      <div class="device-info">
        <strong>${dev.name}</strong>
        <span>${dev.power_kw} kW • ${dev.duration_hours} hrs (Deadline: ${dev.deadline}:00)</span>
      </div>
      <div class="device-actions-icons">
        <button class="icon-btn edit" onclick="startEditDevice(${dev.id})" title="Edit Device">Edit</button>
        <button class="icon-btn delete" onclick="removeDevice(${dev.id})" title="Delete Device">&times;</button>
      </div>
    `;
    deviceList.appendChild(li);
  });
}

function startEditDevice(id) {
  const dev = devices.find(d => d.id === id);
  if (!dev) return;

  editingIdInput.value = dev.id;
  document.getElementById("dev-name").value = dev.name;
  document.getElementById("dev-kw").value = dev.power_kw;
  document.getElementById("dev-hours").value = dev.duration_hours;
  document.getElementById("dev-deadline").value = dev.deadline;

  formHeading.textContent = "Edit Device";
  submitDeviceBtn.textContent = "Save Changes";
  cancelEditBtn.style.display = "inline-block";
}

function cancelEdit() {
  editingIdInput.value = "";
  deviceForm.reset();
  formHeading.textContent = "Smart Home Devices";
  submitDeviceBtn.textContent = "+ Add Appliance";
  cancelEditBtn.style.display = "none";
}

cancelEditBtn.addEventListener("click", cancelEdit);

function removeDevice(id) {
  devices = devices.filter(d => d.id !== id);
  if (editingIdInput.value == id) cancelEdit();
  renderDeviceList();
}

deviceForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("dev-name").value;
  const kw = parseFloat(document.getElementById("dev-kw").value);
  const hours = parseInt(document.getElementById("dev-hours").value);
  const deadline = parseInt(document.getElementById("dev-deadline").value);
  const editId = editingIdInput.value;

  if (editId) {
    // Update existing
    const dev = devices.find(d => d.id == editId);
    if (dev) {
      dev.name = name;
      dev.power_kw = kw;
      dev.duration_hours = hours;
      dev.deadline = deadline;
    }
    cancelEdit();
  } else {
    // Add new
    devices.push({
      id: Date.now(),
      name,
      power_kw: kw,
      duration_hours: hours,
      deadline,
      enabled: true
    });
    deviceForm.reset();
  }
  renderDeviceList();
});

// --- 2. FETCH OPTIMIZATION ---
async function fetchOptimization() {
  calculateBtn.textContent = "Calculating...";
  calculateBtn.disabled = true;
  const panelKwp = parseFloat(panelInput.value);

  try {
    const response = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zip_code: zipInput.value.trim(),
        panel_kwp: panelKwp,
        panel_tilt: parseFloat(tiltInput.value),
        panel_azimuth: parseFloat(azimuthInput.value),
        derate: getSettings().derateFactor / 100, // Settings page stores a percent
        devices: devices
      })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to calculate.");
    }

    cachedHourlyData = data.hourly;
    cachedTariffs = data.tariffs;
    document.getElementById("solar-source-note").hidden = data.solar_source !== "estimate";

    document.getElementById("location-badge").textContent = `${data.location.city}, ${data.location.state} (${data.utility})`;
    document.getElementById("stat-peak").textContent = `${data.summary.peak_solar_kw} kW`;
    document.getElementById("stat-total").textContent = `${data.summary.total_solar_kwh} kWh`;
    document.getElementById("stat-cost").textContent = `$${data.summary.optimized_cost}`;
    document.getElementById("stat-savings").textContent = `$${data.summary.savings}`;

    renderChart(cachedHourlyData, panelKwp);
    renderTable();

  } catch (err) {
    console.error(err);
    alert(`Could not load schedule: ${err.message}`);
  } finally {
    calculateBtn.textContent = "Optimize Schedule";
    calculateBtn.disabled = false;
  }
}

// --- 3. IN-TABLE EDITING & LIVE RECALCULATION ---
function removeActionFromHour(hour, actionName) {
  const row = cachedHourlyData.find(r => r.hour === hour);
  if (row) {
    row.actions = row.actions.filter(a => a !== actionName);
    recalculateMetrics();
    renderTable();
  }
}

function addActionToHour(hour, selectEl) {
  const actionName = selectEl.value;
  if (!actionName) return;

  const row = cachedHourlyData.find(r => r.hour === hour);
  if (row && !row.actions.includes(actionName)) {
    row.actions.push(actionName);
    recalculateMetrics();
    renderTable();
  }
}

function recalculateMetrics() {
  let optimizedCost = 0.0;
  let unmanagedCost = 0.0;

  // Track remaining solar capacity for recalculation
  const remainingSolar = cachedHourlyData.map(r => r.solar_kw);

  cachedHourlyData.forEach((row, idx) => {
    row.actions.forEach(actionName => {
      const dev = devices.find(d => d.name === actionName);
      const kw = dev ? dev.power_kw : 2.0;

      const solarUsed = Math.min(remainingSolar[idx], kw);
      const gridUsed = Math.max(0.0, kw - solarUsed);
      remainingSolar[idx] -= solarUsed;

      optimizedCost += (solarUsed * cachedTariffs.export_credit) + (gridUsed * row.grid_rate);
      unmanagedCost += kw * cachedTariffs.peak_rate;
    });
  });

  const savings = Math.max(0.0, unmanagedCost - optimizedCost);
  document.getElementById("stat-cost").textContent = `$${optimizedCost.toFixed(2)}`;
  document.getElementById("stat-savings").textContent = `$${savings.toFixed(2)}`;
}

// --- 4. SORTING LOGIC ---
document.querySelectorAll("th.sortable").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.getAttribute("data-sort");
    if (currentSort.column === col) {
      currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
    } else {
      currentSort.column = col;
      currentSort.direction = "asc";
    }
    updateSortIndicators();
    renderTable();
  });
});

function updateSortIndicators() {
  document.querySelectorAll("th.sortable").forEach(th => {
    const indicator = th.querySelector(".sort-indicator");
    if (th.getAttribute("data-sort") === currentSort.column) {
      indicator.textContent = currentSort.direction === "asc" ? "▲" : "▼";
    } else {
      indicator.textContent = "";
    }
  });
}

function getSortedHourlyData() {
  return [...cachedHourlyData].sort((a, b) => {
    let valA = a[currentSort.column];
    let valB = b[currentSort.column];

    if (currentSort.column === "actions") {
      valA = a.actions.length;
      valB = b.actions.length;
    }

    if (typeof valA === "string") {
      return currentSort.direction === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return currentSort.direction === "asc" ? valA - valB : valB - valA;
  });
}

// --- 5. RENDER TABLE WITH EDITING CONTROLS ---
function renderTable() {
  const tbody = document.getElementById("schedule-body");
  tbody.innerHTML = "";

  const sortedData = getSortedHourlyData();

  sortedData.forEach(row => {
    const tr = document.createElement("tr");

    // Action Pills with "x" remove button
    const actionPills = row.actions.map(act => `
      <span class="action-pill">
        ${act}
        <span class="remove-action" onclick="removeActionFromHour(${row.hour}, '${act.replace(/'/g, "\\'")}')" title="Remove from this hour">&times;</span>
      </span>
    `).join("");

    // Inline "+ Add" dropdown for this hour
    const availableDevices = devices.filter(d => !row.actions.includes(d.name));
    const optionsHtml = availableDevices.map(d => `<option value="${d.name}">${d.name}</option>`).join("");
    const addDropdown = `
      <select class="inline-add-device" onchange="addActionToHour(${row.hour}, this)">
        <option value="" selected hidden>+ Add to ${row.time_label}</option>
        ${optionsHtml}
      </select>
    `;

    tr.innerHTML = `
      <td><strong>${row.time_label}</strong></td>
      <td>${row.solar_kw.toFixed(1)} kW</td>
      <td>$${row.grid_rate.toFixed(2)}/kWh</td>
      <td>${row.tier}</td>
      <td>
        <div class="table-actions-container">
          ${actionPills || '<span style="color: #94a3b8; font-size: 0.85rem;">Idle</span>'}
          ${addDropdown}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// --- 6. CHART.JS ---
// panelKwp: the array size used for this forecast; the solar axis tops out there
function renderChart(hourlyData, panelKwp) {
  const ctx = document.getElementById("solarChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  // Match the site's body font in axis labels, legend and tooltips
  Chart.defaults.font.family = '"Lora", Georgia, serif';

  // User-chosen colors (Settings page) and theme-aware axis/grid colors
  const settings = getSettings();
  const solarColor = settings.chartSolarColor;
  const tariffColor = settings.chartTariffColor;
  const css = getComputedStyle(document.documentElement);
  const mutedText = css.getPropertyValue("--text-muted").trim();
  const gridColor = css.getPropertyValue("--border-color").trim();

  // Soft vertical fade under each curve: strong at the line, clear at the bottom
  const fadeFill = (hex) => (context) => {
    const { ctx: c, chartArea } = context.chart;
    if (!chartArea) return null; // first layout pass, not sized yet
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, hexToRgba(hex, 0.45));
    g.addColorStop(1, hexToRgba(hex, 0));
    return g;
  };

  const curve = (hex) => ({
    type: "line",
    borderColor: hex,
    borderWidth: 3,
    backgroundColor: fadeFill(hex),
    fill: "origin",
    cubicInterpolationMode: "monotone", // smooth, without overshooting below 0
    pointRadius: 0,
    pointHoverRadius: 7,
    pointHoverBackgroundColor: "#fff",
    pointHoverBorderColor: hex,
    pointHoverBorderWidth: 3
  });

  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: hourlyData.map(d => d.time_label),
      datasets: [
        {
          ...curve(solarColor),
          label: "Solar Power (kW)",
          data: hourlyData.map(d => d.solar_kw),
          yAxisID: "ySolar",
          order: 1 // drawn on top
        },
        {
          ...curve(tariffColor),
          label: "Tariff ($/kWh)",
          data: hourlyData.map(d => d.grid_rate),
          yAxisID: "yRate",
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 8,
            boxHeight: 8,
            color: mutedText,
            padding: 18
          }
        },
        // One box per series, each in its own line color, drawn by splitTooltip()
        tooltip: {
          enabled: false,
          external: splitTooltip
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: mutedText, maxRotation: 0, autoSkipPadding: 16 }
        },
        ySolar: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          // Top of the axis = array size, so the curve reads as a share of capacity
          // (suggestedMax still lets the axis grow if a value ever goes above it)
          suggestedMax: panelKwp,
          border: { display: false, dash: [6, 6] }, // v4: dashed grid lines
          grid: { color: gridColor, drawTicks: false },
          ticks: { color: mutedText, padding: 10, callback: v => `${v} kW` }
        },
        yRate: {
          type: "linear",
          position: "right",
          beginAtZero: true,
          border: { display: false },
          grid: { drawOnChartArea: false, drawTicks: false },
          ticks: { color: mutedText, padding: 10, callback: v => `${settings.currency}${v.toFixed(2)}` }
        }
      }
    }
  });
}

// Chart.js draws a single shared tooltip; this replaces it with one box per
// series, placed next to that series' point and colored to match its line.
function splitTooltip({ chart, tooltip }) {
  const wrapper = chart.canvas.parentNode;
  let boxes = wrapper.querySelectorAll(".chart-tip");
  if (boxes.length === 0) {
    chart.data.datasets.forEach(() => {
      const box = document.createElement("div");
      box.className = "chart-tip";
      box.innerHTML = '<div class="chart-tip-title"></div><div class="chart-tip-body"></div>';
      wrapper.appendChild(box);
    });
    boxes = wrapper.querySelectorAll(".chart-tip");
  }

  if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
    boxes.forEach(b => { b.style.opacity = 0; });
    return;
  }

  const currency = getSettings().currency;
  const placed = [];
  boxes.forEach(b => { b.style.opacity = 0; });

  // Higher point first, so the lower box is the one nudged down on overlap
  const points = [...tooltip.dataPoints].sort((a, b) => a.element.y - b.element.y);
  points.forEach(p => {
    const box = boxes[p.datasetIndex];
    const ds = p.dataset;
    const value = ds.yAxisID === "yRate"
      ? `${currency}${p.parsed.y.toFixed(2)}/kWh`
      : `${p.parsed.y.toFixed(2)} kW`;
    box.style.backgroundColor = ds.borderColor;
    box.querySelector(".chart-tip-title").textContent = ds.label.replace(/\s*\(.*\)$/, "");
    box.querySelector(".chart-tip-body").textContent = `${p.label}: ${value}`;
    box.style.opacity = 1;

    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const gap = 12;
    // Right of the point, or left of it near the right edge
    let left = p.element.x + gap;
    if (left + w > wrapper.clientWidth) left = p.element.x - gap - w;
    let top = p.element.y - h / 2;
    placed.forEach(prev => {
      if (top < prev.top + prev.h + 6 && top + h > prev.top - 6) top = prev.top + prev.h + 6;
    });
    top = Math.max(0, Math.min(top, wrapper.clientHeight - h));
    placed.push({ top, h });
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  });
}

// "#6366f1" -> "rgba(99, 102, 241, alpha)"
function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(ch => ch + ch).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Live MQTT Trigger Simulation
iotTriggerBtn.addEventListener("click", () => {
  const hr = new Date().getHours();
  const currentRow = cachedHourlyData.find(r => r.hour === hr);
  const actions = currentRow && currentRow.actions.length ? currentRow.actions.join(", ") : "None (Idle)";
  alert(`[IoT Relay Triggered]: Published MQTT event for ${hr}:00 -> Running: [${actions}]`);
});

// Initialization
renderDeviceList();
calculateBtn.addEventListener("click", fetchOptimization);
window.onload = fetchOptimization;