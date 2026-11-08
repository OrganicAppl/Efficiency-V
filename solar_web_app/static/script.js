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

const dashboardEl = document.getElementById("dashboard");
const zipInput = document.getElementById("zip-code");
const panelInput = document.getElementById("panel-kwp");
const kwpVal = document.getElementById("kwp-val");
const deviceList = document.getElementById("device-list");
const deviceEmpty = document.getElementById("device-empty");
const deviceCount = document.getElementById("device-count");
const deviceForm = document.getElementById("device-form");
const editingIdInput = document.getElementById("editing-device-id");
const deviceModal = document.getElementById("device-modal");
const deviceModalTitle = document.getElementById("device-modal-title");
const deviceModalSave = document.getElementById("device-modal-save");
const addDeviceBtn = document.getElementById("add-device-btn");
const calculateBtn = document.getElementById("calculate-btn");
const iotTriggerBtn = document.getElementById("iot-trigger-btn");
const scheduleBody = document.getElementById("schedule-body");
const addMenu = document.getElementById("add-menu");

const tiltInput = document.getElementById("panel-tilt");
const tiltVal = document.getElementById("tilt-val");
const azimuthInput = document.getElementById("panel-azimuth");

const ICONS = {
  edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.6 3.9a1.9 1.9 0 0 1 2.7 2.7l-8.6 8.6-3.5.8.8-3.5 8.6-8.6Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 9.5h7.4l.8-9.5M8.5 9v4M11.5 9v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v10M5 10h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function formatNumber(n) {
  return String(Math.round(Number(n) * 100) / 100);
}

function deadlineLabel(hour) {
  return Number(hour) >= 24 ? "midnight" : `${String(hour).padStart(2, "0")}:00`;
}

function paintRange(input) {
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const pct = ((parseFloat(input.value) - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${pct}%`);
}

[panelInput, tiltInput].forEach(paintRange);
panelInput.addEventListener("input", (e) => { kwpVal.textContent = e.target.value; paintRange(e.target); });
tiltInput.addEventListener("input", (e) => { tiltVal.textContent = e.target.value; paintRange(e.target); });
panelInput.addEventListener("change", fetchOptimization);
tiltInput.addEventListener("change", fetchOptimization);
azimuthInput.addEventListener("change", fetchOptimization);

function initCustomSelect(select, trigger, listbox) {
  const valueEl = trigger.querySelector(".cselect-value");
  const options = [...select.options];
  listbox.innerHTML = options.map((opt, i) => `
    <li role="option" id="${listbox.id}-opt-${i}" class="popover-item" aria-selected="false">
      <span>${escapeHtml(opt.text)}</span>
      <span class="popover-check">${ICONS.check}</span>
    </li>`).join("");
  const items = [...listbox.children];
  let active = select.selectedIndex;

  const sync = () => {
    valueEl.textContent = select.options[select.selectedIndex].text;
    items.forEach((li, i) => li.setAttribute("aria-selected", String(i === select.selectedIndex)));
  };

  const setActive = (i) => {
    active = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((li, idx) => li.classList.toggle("is-active", idx === active));
    listbox.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  };

  const onOutside = (e) => {
    if (!trigger.contains(e.target) && !listbox.contains(e.target)) close(false);
  };

  function open() {
    listbox.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    setActive(select.selectedIndex);
    listbox.focus();
    document.addEventListener("pointerdown", onOutside, true);
  }

  function close(returnFocus = true) {
    if (listbox.hidden) return;
    listbox.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (returnFocus) trigger.focus();
  }

  function choose(i) {
    if (i !== select.selectedIndex) {
      select.selectedIndex = i;
      sync();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
  }

  trigger.addEventListener("click", () => (listbox.hidden ? open() : close()));
  trigger.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      open();
    }
  });

  listbox.addEventListener("keydown", (e) => {
    const keyMap = {
      ArrowDown: () => setActive(active + 1),
      ArrowUp: () => setActive(active - 1),
      Home: () => setActive(0),
      End: () => setActive(items.length - 1),
      Enter: () => choose(active),
      " ": () => choose(active),
      Escape: () => close()
    };
    if (keyMap[e.key]) {
      e.preventDefault();
      keyMap[e.key]();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const match = options.findIndex(o => o.text.toLowerCase().startsWith(e.key.toLowerCase()));
      if (match >= 0) setActive(match);
    }
  });

  items.forEach((li, i) => {
    li.addEventListener("click", () => choose(i));
    li.addEventListener("pointermove", () => { if (active !== i) setActive(i); });
  });

  select.addEventListener("change", sync);
  sync();
}

initCustomSelect(azimuthInput, document.getElementById("azimuth-trigger"), document.getElementById("azimuth-listbox"));

// --- 1. DEVICE CRUD & EDITING ---
function renderDeviceList() {
  deviceList.innerHTML = devices.map(dev => `
    <li class="device-item" data-id="${dev.id}">
      <div class="device-info">
        <span class="device-name">${escapeHtml(dev.name)}</span>
        <span class="device-meta">${formatNumber(dev.power_kw)} kW <span class="sep" aria-hidden="true">&middot;</span> ${dev.duration_hours} h <span class="sep" aria-hidden="true">&middot;</span> by ${deadlineLabel(dev.deadline)}</span>
      </div>
      <div class="device-actions">
        <button type="button" class="icon-btn edit" data-action="edit" aria-label="Edit ${escapeHtml(dev.name)}" title="Edit">${ICONS.edit}</button>
        <button type="button" class="icon-btn delete" data-action="delete" aria-label="Remove ${escapeHtml(dev.name)}" title="Remove">${ICONS.trash}</button>
      </div>
    </li>`).join("");
  deviceCount.textContent = devices.length;
  deviceEmpty.hidden = devices.length > 0;
}

deviceList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = Number(btn.closest(".device-item").dataset.id);
  if (btn.dataset.action === "edit") startEditDevice(id);
  else removeDevice(id);
});

const fieldIds = ["dev-name", "dev-kw", "dev-hours", "dev-deadline"];
const field = (id) => document.getElementById(id);
let modalReturnFocus = null;

function setFieldError(id, message) {
  const input = field(id);
  field(`${id}-err`).textContent = message || "";
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

function openDeviceModal(dev) {
  modalReturnFocus = document.activeElement;
  fieldIds.forEach(id => setFieldError(id, ""));
  editingIdInput.value = dev ? dev.id : "";
  field("dev-name").value = dev ? dev.name : "";
  field("dev-kw").value = dev ? dev.power_kw : "";
  field("dev-hours").value = dev ? dev.duration_hours : "";
  field("dev-deadline").value = dev ? dev.deadline : 20;
  deviceModalTitle.textContent = dev ? "Edit appliance" : "Add appliance";
  deviceModalSave.textContent = dev ? "Save changes" : "Add appliance";
  deviceModal.showModal();
  field("dev-name").focus();
  if (dev) field("dev-name").select();
}

function closeDeviceModal() {
  if (deviceModal.open) deviceModal.close();
}

function startEditDevice(id) {
  const dev = devices.find(d => d.id === id);
  if (dev) openDeviceModal(dev);
}

function cancelEdit() {
  closeDeviceModal();
}

deviceModal.addEventListener("close", () => {
  const target = modalReturnFocus && document.contains(modalReturnFocus) ? modalReturnFocus : addDeviceBtn;
  target.focus();
  modalReturnFocus = null;
});

let backdropPress = false;
deviceModal.addEventListener("pointerdown", (e) => { backdropPress = e.target === deviceModal; });
deviceModal.addEventListener("click", (e) => {
  if (e.target === deviceModal && backdropPress) closeDeviceModal();
  backdropPress = false;
});
deviceModal.querySelectorAll("[data-close]").forEach(btn => btn.addEventListener("click", closeDeviceModal));

deviceModal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusables = [...deviceModal.querySelectorAll("button, input:not([type=hidden])")].filter(el => !el.disabled);
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

fieldIds.forEach(id => field(id).addEventListener("input", () => setFieldError(id, "")));

addDeviceBtn.addEventListener("click", () => openDeviceModal(null));

function removeDevice(id) {
  const index = devices.findIndex(d => d.id === id);
  if (index < 0) return;
  const [removed] = devices.splice(index, 1);
  cachedHourlyData.forEach(row => { row.actions = row.actions.filter(a => a !== removed.name); });
  renderDeviceList();
  refreshSchedule();
  const nextItem = deviceList.children[Math.min(index, devices.length - 1)];
  (nextItem ? nextItem.querySelector(".icon-btn.edit") : addDeviceBtn).focus();
}

function validateDeviceForm() {
  const editId = Number(editingIdInput.value) || null;
  const name = field("dev-name").value.trim();
  const kw = parseFloat(field("dev-kw").value);
  const hoursRaw = field("dev-hours").value;
  const deadlineRaw = field("dev-deadline").value;
  const hours = Number(hoursRaw);
  const deadline = Number(deadlineRaw);
  const errors = {};

  if (!name) errors["dev-name"] = "Give the appliance a name.";
  else if (devices.some(d => d.id !== editId && d.name.toLowerCase() === name.toLowerCase())) {
    errors["dev-name"] = "You already have an appliance with this name.";
  }
  if (!Number.isFinite(kw) || kw <= 0 || kw > 50) errors["dev-kw"] = "Enter 0.1 to 50 kW.";
  if (hoursRaw === "" || !Number.isInteger(hours) || hours < 1 || hours > 24) errors["dev-hours"] = "Whole hours, 1 to 24.";
  if (deadlineRaw === "" || !Number.isInteger(deadline) || deadline < 1 || deadline > 24) errors["dev-deadline"] = "An hour from 1 to 24.";
  if (!errors["dev-hours"] && !errors["dev-deadline"] && hours > deadline) {
    errors["dev-hours"] = `Must fit before ${deadlineLabel(deadline)}.`;
  }

  fieldIds.forEach(id => setFieldError(id, errors[id]));
  const firstInvalid = fieldIds.find(id => errors[id]);
  if (firstInvalid) {
    field(firstInvalid).focus();
    return null;
  }
  return { editId, name, kw, hours, deadline };
}

deviceForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const values = validateDeviceForm();
  if (!values) return;
  const { editId, name, kw, hours, deadline } = values;
  let savedId = editId;

  if (editId) {
    const dev = devices.find(d => d.id === editId);
    if (dev) {
      if (dev.name !== name) {
        cachedHourlyData.forEach(row => { row.actions = row.actions.map(a => (a === dev.name ? name : a)); });
      }
      dev.name = name;
      dev.power_kw = kw;
      dev.duration_hours = hours;
      dev.deadline = deadline;
    }
  } else {
    savedId = Date.now();
    devices.push({ id: savedId, name, power_kw: kw, duration_hours: hours, deadline, enabled: true });
    modalReturnFocus = null;
  }

  renderDeviceList();
  refreshSchedule();
  closeDeviceModal();
  const savedItem = deviceList.querySelector(`[data-id="${savedId}"]`);
  if (savedItem) {
    savedItem.classList.add("is-new");
    savedItem.addEventListener("animationend", () => savedItem.classList.remove("is-new"), { once: true });
    if (!editId) savedItem.querySelector(".icon-btn.edit").focus();
  }
});

// --- 2. FETCH OPTIMIZATION ---
function setStat(id, value, sub, unit) {
  const el = document.getElementById(id);
  el.textContent = value;
  if (unit) {
    const unitEl = document.createElement("span");
    unitEl.className = "stat-unit";
    unitEl.textContent = ` ${unit}`;
    el.appendChild(unitEl);
  }
  if (sub !== undefined) document.getElementById(`${id}-sub`).textContent = sub;
}

async function fetchOptimization() {
  calculateBtn.textContent = "Calculating...";
  calculateBtn.disabled = true;
  dashboardEl.classList.add("is-loading");
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
        derate: getSettings().derateFactor / 100,
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

    const locationText = `${data.location.city}, ${data.location.state} (${data.utility})`;
    document.getElementById("location-badge").textContent = locationText;
    const heroLocation = document.getElementById("hero-location-text");
    if (heroLocation) heroLocation.textContent = locationText;

    const peakRow = cachedHourlyData.reduce((best, r) => (r.solar_kw > best.solar_kw ? r : best), cachedHourlyData[0]);
    const sunnyHours = cachedHourlyData.filter(r => r.solar_kw >= 0.05).length;
    setStat("stat-peak", `${data.summary.peak_solar_kw}`, peakRow && peakRow.solar_kw > 0 ? `around ${peakRow.time_label}` : "no sun forecast", "kW");
    setStat("stat-total", `${data.summary.total_solar_kwh}`, `across ${sunnyHours} sunny hours`, "kWh");
    setStat("stat-cost", `$${data.summary.optimized_cost}`);
    setStat("stat-savings", `$${data.summary.savings}`, "vs. running at peak rates");
    updateCostSub();

    dashboardEl.classList.remove("is-empty");
    renderChart(cachedHourlyData, panelKwp);
    renderTable();

  } catch (err) {
    console.error(err);
    alert(`Could not load schedule: ${err.message}`);
  } finally {
    calculateBtn.textContent = "Optimize Schedule";
    calculateBtn.disabled = false;
    dashboardEl.classList.remove("is-loading");
  }
}

// --- 3. IN-TABLE EDITING & LIVE RECALCULATION ---
function refreshSchedule() {
  if (!cachedHourlyData.length) return;
  recalculateMetrics();
  renderTable();
}

function removeActionFromHour(hour, actionName) {
  const row = cachedHourlyData.find(r => r.hour === hour);
  if (row) {
    row.actions = row.actions.filter(a => a !== actionName);
    refreshSchedule();
  }
}

function addActionToHour(hour, nameOrSelect) {
  const actionName = typeof nameOrSelect === "string" ? nameOrSelect : nameOrSelect.value;
  if (!actionName) return;

  const row = cachedHourlyData.find(r => r.hour === hour);
  if (row && !row.actions.includes(actionName)) {
    row.actions.push(actionName);
    refreshSchedule();
  }
}

function updateCostSub() {
  const scheduled = new Set(cachedHourlyData.flatMap(r => r.actions)).size;
  document.getElementById("stat-cost-sub").textContent =
    scheduled ? `${scheduled} appliance${scheduled === 1 ? "" : "s"} scheduled` : "nothing scheduled";
}

function recalculateMetrics() {
  let optimizedCost = 0.0;
  let unmanagedCost = 0.0;

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
  updateCostSub();
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
  closeAddMenu(false);
  if (!cachedHourlyData.length) return;

  scheduleBody.innerHTML = getSortedHourlyData().map(row => {
    const chips = row.actions.map(act => `
      <span class="action-pill">
        <span class="action-pill-name">${escapeHtml(act)}</span>
        <button type="button" class="remove-action" data-hour="${row.hour}" data-name="${escapeHtml(act)}" aria-label="Remove ${escapeHtml(act)} from ${row.time_label}" title="Remove from this hour">${ICONS.close}</button>
      </span>`).join("");

    const canAdd = devices.some(d => !row.actions.includes(d.name));
    const addBtn = canAdd
      ? `<button type="button" class="add-chip-btn" data-hour="${row.hour}" aria-haspopup="menu" aria-expanded="false" aria-label="Add appliance to ${row.time_label}" title="Add appliance to ${row.time_label}">${ICONS.plus}</button>`
      : "";

    const tierSlug = String(row.tier).toLowerCase().replace(/[^a-z]+/g, "-");
    return `
      <tr>
        <td class="col-time"><strong>${row.time_label}</strong></td>
        <td class="col-solar" data-label="Solar">${row.solar_kw.toFixed(1)} kW</td>
        <td class="col-price" data-label="Grid">$${row.grid_rate.toFixed(2)}<span class="unit">/kWh</span></td>
        <td class="col-tier"><span class="tier-tag tier-${tierSlug}">${row.tier}</span></td>
        <td class="col-actions">
          <div class="table-actions-container">
            ${chips || '<span class="idle-label">Idle</span>'}
            ${addBtn}
          </div>
        </td>
      </tr>`;
  }).join("");
}

scheduleBody.addEventListener("click", (e) => {
  const remove = e.target.closest(".remove-action");
  if (remove) {
    const hour = Number(remove.dataset.hour);
    removeActionFromHour(hour, remove.dataset.name);
    const next = scheduleBody.querySelector(`.add-chip-btn[data-hour="${hour}"]`);
    if (next) next.focus();
    return;
  }
  const add = e.target.closest(".add-chip-btn");
  if (add) {
    if (addMenuButton === add) closeAddMenu();
    else openAddMenu(add);
  }
});

let addMenuButton = null;

function addMenuItems() {
  return [...addMenu.querySelectorAll('[role="menuitem"]')];
}

function openAddMenu(btn) {
  closeAddMenu(false);
  const hour = Number(btn.dataset.hour);
  const row = cachedHourlyData.find(r => r.hour === hour);
  if (!row) return;
  const available = devices.filter(d => !row.actions.includes(d.name));
  if (!available.length) return;

  addMenu.innerHTML = `<p class="popover-label">Run at ${row.time_label}</p>` + available.map(d => `
    <button type="button" role="menuitem" class="popover-item" tabindex="-1" data-name="${escapeHtml(d.name)}">
      <span>${escapeHtml(d.name)}</span>
      <span class="popover-meta">${formatNumber(d.power_kw)} kW</span>
    </button>`).join("");
  addMenu.dataset.hour = hour;
  addMenu.hidden = false;
  addMenuButton = btn;
  btn.setAttribute("aria-expanded", "true");
  positionAddMenu();
  addMenuItems()[0].focus();
  document.addEventListener("pointerdown", onAddMenuOutside, true);
  window.addEventListener("scroll", onAddMenuScroll, true);
  window.addEventListener("resize", onAddMenuScroll);
}

function positionAddMenu() {
  const rect = addMenuButton.getBoundingClientRect();
  const w = addMenu.offsetWidth;
  const h = addMenu.offsetHeight;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
  let top = rect.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
  addMenu.style.left = `${left}px`;
  addMenu.style.top = `${top}px`;
}

function closeAddMenu(returnFocus = true) {
  if (addMenu.hidden) return;
  addMenu.hidden = true;
  document.removeEventListener("pointerdown", onAddMenuOutside, true);
  window.removeEventListener("scroll", onAddMenuScroll, true);
  window.removeEventListener("resize", onAddMenuScroll);
  const btn = addMenuButton;
  addMenuButton = null;
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
    if (returnFocus && document.contains(btn)) btn.focus();
  }
}

function onAddMenuOutside(e) {
  if (!addMenu.contains(e.target) && !(addMenuButton && addMenuButton.contains(e.target))) closeAddMenu(false);
}

function onAddMenuScroll(e) {
  if (!addMenuButton || (e && e.target && addMenu.contains(e.target))) return;
  const rect = addMenuButton.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) closeAddMenu(false);
  else positionAddMenu();
}

addMenu.addEventListener("click", (e) => {
  const item = e.target.closest('[role="menuitem"]');
  if (!item) return;
  const hour = Number(addMenu.dataset.hour);
  closeAddMenu(false);
  addActionToHour(hour, item.dataset.name);
  const focusTarget = scheduleBody.querySelector(`.add-chip-btn[data-hour="${hour}"]`)
    || scheduleBody.querySelector(`.remove-action[data-hour="${hour}"]`);
  if (focusTarget) focusTarget.focus();
});

addMenu.addEventListener("keydown", (e) => {
  const items = addMenuItems();
  const i = items.indexOf(document.activeElement);
  const moves = {
    ArrowDown: () => items[(i + 1) % items.length],
    ArrowUp: () => items[(i - 1 + items.length) % items.length],
    Home: () => items[0],
    End: () => items[items.length - 1]
  };
  if (moves[e.key]) {
    e.preventDefault();
    moves[e.key]().focus();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeAddMenu();
  } else if (e.key === "Tab") {
    e.preventDefault();
    closeAddMenu();
  }
});

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
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !addMenu.hidden) closeAddMenu();
});
calculateBtn.addEventListener("click", fetchOptimization);
window.onload = fetchOptimization;