let devices = [
  { id: 1, name: "Tesla Model Y", power_kw: 7.2, duration_hours: 3, deadline: 19, enabled: true },
  { id: 2, name: "Central AC Pre-Cool", power_kw: 3.5, duration_hours: 2, deadline: 16, enabled: true },
  { id: 3, name: "Heat Pump Water Heater", power_kw: 1.5, duration_hours: 2, deadline: 23, enabled: true },
  { id: 4, name: "Smart Pool Pump", power_kw: 1.8, duration_hours: 4, deadline: 18, enabled: true }
];

let chartInstance = null;

const zipInput = document.getElementById("zip-code");
const panelInput = document.getElementById("panel-kwp");
const kwpVal = document.getElementById("kwp-val");
const deviceList = document.getElementById("device-list");
const addForm = document.getElementById("add-device-form");
const calculateBtn = document.getElementById("calculate-btn");
const iotTriggerBtn = document.getElementById("iot-trigger-btn");

panelInput.addEventListener("input", (e) => kwpVal.textContent = e.target.value);

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

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  devices.push({
    id: Date.now(),
    name: document.getElementById("dev-name").value,
    power_kw: parseFloat(document.getElementById("dev-kw").value),
    duration_hours: parseInt(document.getElementById("dev-hours").value),
    deadline: parseInt(document.getElementById("dev-deadline").value),
    enabled: true
  });
  addForm.reset();
  renderDeviceList();
});

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
      throw new Error(data.error || `Server status ${response.status}`);
    }

    document.getElementById("location-badge").textContent = `${data.location.city}, ${data.location.state} (${data.utility})`;
    document.getElementById("stat-peak").textContent = `${data.summary.peak_solar_kw} kW`;
    document.getElementById("stat-total").textContent = `${data.summary.total_solar_kwh} kWh`;
    document.getElementById("stat-cost").textContent = `$${data.summary.optimized_cost}`;
    document.getElementById("stat-savings").textContent = `$${data.summary.savings}`;

    renderChart(data.hourly);
    renderTable(data.hourly);

  } catch (err) {
    console.error("Dashboard error:", err);
    alert(`Could not load schedule: ${err.message}`);
  } finally {
    calculateBtn.textContent = "⚡ Optimize Schedule";
    calculateBtn.disabled = false;
  }
}

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

function renderTable(hourlyData) {
  const tbody = document.getElementById("schedule-body");
  tbody.innerHTML = "";

  hourlyData.forEach(row => {
    const tr = document.createElement("tr");
    const actionsHtml = row.actions.length > 0
      ? row.actions.map(a => `<span class="action-pill">${a}</span>`).join("")
      : `<span class="action-idle">Idle / Battery storing</span>`;

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

iotTriggerBtn.addEventListener("click", () => {
  const hr = new Date().getHours();
  alert(`[IoT Webhook]: Successfully published MQTT command to Home Assistant for ${hr}:00!`);
});

renderDeviceList();
calculateBtn.addEventListener("click", fetchOptimization);
window.onload = fetchOptimization;