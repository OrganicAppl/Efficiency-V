// Default Settings
const DEFAULT_SETTINGS = {
  theme: "light",          // 'light' | 'dark' | 'auto'
  fontSize: "medium",      // 'small' | 'medium' | 'large' | 'xlarge'
  accentColor: "#f59e0b",  // default Solar Gold
  currency: "$",
  timeFormat: "24h",       // '24h' | '12h'
  derateFactor: 85,        // 85% efficiency
  haUrl: "http://homeassistant.local:8123",
  haToken: "",
  dispatchMode: "simulated"
};

// Retrieve saved settings or defaults
function getSettings() {
  const saved = localStorage.getItem("solar_app_settings");
  return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
}

// Apply visual themes to DOM
function applyVisualSettings() {
  const s = getSettings();
  const root = document.documentElement;

  // 1. Theme (Dark / Light / Auto)
  if (s.theme === "auto") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    root.setAttribute("data-theme", s.theme);
  }

  // 2. Font Size
  root.setAttribute("data-font-size", s.fontSize);

  // 3. Accent Color
  root.style.setProperty("--primary-color", s.accentColor);
}

// Run immediately
applyVisualSettings();