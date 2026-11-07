// DOM Elements
const chatContainer = document.getElementById("chat-container");
const chatToggleBtn = document.getElementById("chat-toggle-btn");
const chatMinBtn = document.getElementById("chat-min-btn");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");

// Toggle Open / Close
chatToggleBtn.addEventListener("click", () => chatContainer.classList.toggle("open"));
chatMinBtn.addEventListener("click", () => chatContainer.classList.remove("open"));

// Helper: Append a message to the chat UI
function appendMessage(sender, text, isWarning = false) {
  const msg = document.createElement("div");
  msg.className = `message ${sender}-msg ${isWarning ? "warning" : ""}`;
  msg.style.whiteSpace = "pre-wrap";

  const parts = String(text).split(/(\*\*.*?\*\*)/s);
  parts.forEach(part => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      msg.appendChild(strong);
    } else {
      msg.appendChild(document.createTextNode(part));
    }
  });

  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Helper: Collect live dashboard context
function gatherLiveContext() {
  const locBadge = document.getElementById("location-badge")?.textContent || "Home";
  const peakVal = parseFloat(document.getElementById("stat-peak")?.textContent) || 0.0;
  const totalVal = parseFloat(document.getElementById("stat-total")?.textContent) || 0.0;
  const savingsVal = parseFloat(document.getElementById("stat-savings")?.textContent.replace("$", "")) || 0.0;
  const hourlyForecast = Array.isArray(cachedHourlyData)
    ? cachedHourlyData.map(row => ({
        hour: row.hour,
        time: row.time_label,
        solar_kw: row.solar_kw,
        grid_rate: row.grid_rate,
        rate_period: row.tier,
        scheduled_appliances: row.actions || []
      }))
    : [];

  const scheduledSummary = [];
  hourlyForecast.forEach(row => {
    if (row.scheduled_appliances.length > 0) {
      scheduledSummary.push(`${row.time}: ${row.scheduled_appliances.join(", ")}`);
    }
  });

  return {
    available: hourlyForecast.length > 0,
    location: locBadge,
    panel_capacity_kwp: parseFloat(document.getElementById("panel-kwp")?.value) || 0,
    peak_solar_kw: peakVal,
    total_solar_kwh: totalVal,
    savings: savingsVal,
    tariffs: cachedTariffs,
    hourly_forecast: hourlyForecast,
    scheduled_summary: scheduledSummary
  };
}

// Send Message Handler
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = chatInput.value.trim();
  if (!query) return;

  // 1. Render User Message
  appendMessage("user", query);
  chatInput.value = "";

  // 2. Add Thinking Placeholder
  const loadingId = "loading-" + Date.now();
  const loadingMsg = document.createElement("div");
  loadingMsg.id = loadingId;
  loadingMsg.className = "message bot-msg";
  loadingMsg.textContent = "Analyzing telemetry...";
  chatMessages.appendChild(loadingMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const payload = {
      message: query,
      context: gatherLiveContext()
    };

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    document.getElementById(loadingId)?.remove();

    // 3. Render Assistant Response
    appendMessage("bot", data.reply || "The energy assistant returned an empty response.", !res.ok || !data.safe);

  } catch (err) {
    document.getElementById(loadingId)?.remove();
    appendMessage("bot", "Network error: Could not reach the energy engine.", true);
  }
});