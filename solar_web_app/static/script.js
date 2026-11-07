// Default Devices in Memory
let devices = [
  { id: 1, name: "Tesla Model Y", power_kw: 7.2, duration_hours: 3, deadline: 19, enabled: true },
  { id: 2, name: "Central AC Pre-Cool", power_kw: 3.5, duration_hours: 2, deadline: 16, enabled: true },
  { id: 3, name: "Heat Pump Water Heater", power_kw: 1.5, duration_hours: 2, deadline: 23, enabled: true },
  { id: 4, name: "Smart Pool Pump", power_kw: 1.8, duration_hours: 4, deadline: 18, enabled: true }
];

let chartInstance = null;

// UI Elements
const zipInput = document.getElementById("zip-code");
const panelInput = document.getElementById("panel-kwp");
const kwpVal = document.getElementById("kwp-val");
const deviceList = document.getElementById("device-list");
const addForm = document.getElementById("add-device-form");
const calculateBtn = document.getElementById("calculate-btn");
const iotTriggerBtn = document.getElementById("iot-trigger-btn");

// Slider dynamic text
panelInput.addEventListener("input", (e) => kwpVal.textContent = e.target.value);

// Render Device List UI
function renderDeviceList() {
  deviceList.innerHTML = "";
  devices.forEach((dev) => {
    const li = document.createElement("li");
    li.className = "device-item";
    li.innerHTML = `
      <div class="device-info">
        <strong>${dev.name}</strong>
        <span>${dev.power_kw} kW • ${dev.duration_hours} hrs (before ${dev.deadline}:00)</span>
      </div>
      <button class="delete-btn" onclick="removeDevice(${dev.id})">&times;</button>
    `;
    deviceList.appendChild(li);
  });
}

function removeDevice(id) {
  devices = devices.filter(d => d.id !== id);
  renderDeviceList();
}

// Add New Device Handler
addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("dev-name").value;
  const kw = parseFloat(document.getElementById("dev-kw").value);
  const hours = parseInt(document.getElementById("dev-hours").value);
  const deadline = parseInt(document.getElementById("dev-deadline").value);

  devices.push({
    id: Date.now(),
    name,
    power_kw: kw,
    duration_hours: hours,
    deadline,
    enabled: true
  });

  addForm.reset();
  renderDeviceList();
});

// Fetch Solar & Optimized Schedule from Backend
async function fetchOptimization() {
  calculateBtn.textContent = "Calculating...";
  calculateBtn.disabled = true;

  try {
    const response = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zip_code: zipInput.value,
        panel_kwp: parseFloat(panelInput.value),
        devices: devices
      })
    });

    const data = await response.json();

    // Update Header & KPIs
    document.getElementById("location-badge").textContent = `${data.location.city}, ${data.location.state} (${data.utility})`;
    document.getElementById("stat-peak").textContent = `${data.summary.peak_solar_kw} kW`;
    document.getElementById("stat-total").textContent = `${data.summary.total_solar_kwh} kWh`;
    document.getElementById("stat-cost").textContent = `$${data.summary.optimized_cost}`;
    document.getElementById("stat-savings").textContent = `$${data.summary.savings}`;

    // Render Chart & Table
    renderChart(data.hourly);
    renderTable(data.hourly);

  } catch (err) {
    alert("Error fetching data. Please ensure the ZIP code is valid.");
    console.error(err);
  } finally {
    calculateBtn.textContent = "⚡ Optimize Schedule";
    calculateBtn.disabled = false;
  }
}

// Render Chart.js Dual Axis Chart
function renderChart(hourlyData) {
  const ctx = document.getElementById("solarChart").getContext("2d");
  const labels = hourlyData.map(d => d.time_label);
  const solarKWs = hourlyData.map(d => d.solar_kw);
  const rates = hourlyData.map(d => d.grid_rate);

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Solar Generation (kW)",
          data: solarKWs,
          backgroundColor: "#f59e0b",
          yAxisID: "ySolar",
          borderRadius: 4
        },
        {
          label: "Grid Tariff ($/kWh)",
          data: rates,
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
        ySolar: {
          type: "linear",
          position: "left",
          title: { display: true, text: "Estimated Solar (kW)" }
        },
        yRate: {
          type: "linear",
          position: "right",
          title: { display: true, text: "Tariff ($/kWh)" },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// Render Schedule Table
function renderTable(hourlyData) {
  const tbody = document.getElementById("schedule-body");
  tbody.innerHTML = "";

  hourlyData.forEach(row => {
    const tr = document.createElement("tr");
    const actionsHtml = row.actions.length > 0
      ? row.actions.map(a => `<span class="action-pill">${a}</span>`).join("")
      : `<span class="action-idle">Idle / Battery charging</span>`;

    tr.innerHTML = `
      <td><strong>${row.time_label}</strong></td>
      <td>${row.solar_kw.toFixed(1)} kW</td>
      <td>$${row.grid_rate.toFixed(2)}/kWh</td>
      <td>${row.tier}</td>
      <td>${actionsHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// IoT Live Simulation
iotTriggerBtn.addEventListener("click", () => {
  const currentHour = new Date().getHours();
  alert(`[IoT Webhook Sent]: Dispatch command issued to Home Assistant MQTT for Hour ${currentHour}:00!`);
});

// Run Initial Setup
renderDeviceList();
calculateBtn.addEventListener("click", fetchOptimization);
window.onload = fetchOptimization;