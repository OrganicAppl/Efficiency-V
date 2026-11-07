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

panelInput.addEventListener("input", (e) => kwpVal.textContent = e.target.value);

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
        <button class="icon-btn edit" onclick="startEditDevice(${dev.id})" title="Edit Device">✏️</button>
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

  formHeading.textContent = "✏️ Edit Device";
  submitDeviceBtn.textContent = "Save Changes";
  cancelEditBtn.style.display = "inline-block";
}

function cancelEdit() {
  editingIdInput.value = "";
  deviceForm.reset();
  formHeading.textContent = "🔌 Smart Home Devices";
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

  try {
    const response = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zip_code: zipInput.value.trim(),
        panel_kwp: parseFloat(panelInput.value),
        devices: devices
      })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to calculate.");
    }

    cachedHourlyData = data.hourly;
    cachedTariffs = data.tariffs;

    document.getElementById("location-badge").textContent = `${data.location.city}, ${data.location.state} (${data.utility})`;
    document.getElementById("stat-peak").textContent = `${data.summary.peak_solar_kw} kW`;
    document.getElementById("stat-total").textContent = `${data.summary.total_solar_kwh} kWh`;
    document.getElementById("stat-cost").textContent = `$${data.summary.optimized_cost}`;
    document.getElementById("stat-savings").textContent = `$${data.summary.savings}`;

    renderChart(cachedHourlyData);
    renderTable();

  } catch (err) {
    console.error(err);
    alert(`Could not load schedule: ${err.message}`);
  } finally {
    calculateBtn.textContent = "⚡ Optimize Schedule";
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
        <option value="">+ Add to ${row.time_label}</option>
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
function renderChart(hourlyData) {
  const ctx = document.getElementById("solarChart").getContext("2d");
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: hourlyData.map(d => d.time_label),
      datasets: [
        {
          label: "Solar Power (kW)",
          data: hourlyData.map(d => d.solar_kw),
          backgroundColor: "#f59e0b",
          yAxisID: "ySolar",
          borderRadius: 4
        },
        {
          label: "Tariff ($/kWh)",
          data: hourlyData.map(d => d.grid_rate),
          type: "line",
          borderColor: "#ef4444",
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 2,
          yAxisID: "yRate"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        ySolar: { type: "linear", position: "left", title: { display: true, text: "Estimated Solar (kW)" } },
        yRate: { type: "linear", position: "right", title: { display: true, text: "Grid Tariff ($/kWh)" }, grid: { drawOnChartArea: false } }
      }
    }
  });
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