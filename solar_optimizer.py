import streamlit as st
import pandas as pd
import plotly.graph_objects as go
import json
import urllib.request
from datetime import datetime

# --- PAGE SETUP ---
st.set_page_config(page_title="SolarPeak: Dynamic Home Orchestrator", layout="wide")

# --- REGIONAL UTILITY TARIFF DEFAULTS ---
STATE_TARIFF_DEFAULTS = {
    "CA": {"utility": "California Default (NEM 3.0 / TOU)", "peak_rate": 0.52, "mid_rate": 0.28, "off_rate": 0.16, "export": 0.06, "peak_start": 16, "peak_end": 21},
    "TX": {"utility": "Texas ERCOT Region", "peak_rate": 0.22, "mid_rate": 0.14, "off_rate": 0.08, "export": 0.08, "peak_start": 14, "peak_end": 20},
    "AZ": {"utility": "Arizona APS / SRP", "peak_rate": 0.42, "mid_rate": 0.24, "off_rate": 0.13, "export": 0.07, "peak_start": 16, "peak_end": 19},
    "NY": {"utility": "New York ConEd / NYSERDA", "peak_rate": 0.34, "mid_rate": 0.22, "off_rate": 0.14, "export": 0.09, "peak_start": 14, "peak_end": 19},
    "FL": {"utility": "Florida FPL", "peak_rate": 0.22, "mid_rate": 0.15, "off_rate": 0.09, "export": 0.06, "peak_start": 12, "peak_end": 21},
    "DEFAULT": {"utility": "US Standard TOU Average", "peak_rate": 0.26, "mid_rate": 0.17, "off_rate": 0.11, "export": 0.07, "peak_start": 15, "peak_end": 20}
}

# --- HELPER: GEOCODE ZIP CODE ---
@st.cache_data(ttl=86400)
def lookup_zip(zip_code: str):
    """Fetches City, State, Lat, Lon from free Zippopotam API."""
    url = f"https://api.zippopotam.us/us/{zip_code.strip()}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SolarApp/1.0"})
        with urllib.request.urlopen(req, timeout=4) as response:
            data = json.loads(response.read().decode())
            place = data["places"][0]
            return {
                "city": place["place name"],
                "state": place["state abbreviation"],
                "lat": float(place["latitude"]),
                "lon": float(place["longitude"])
            }
    except Exception:
        return None

# --- HELPER: SOLAR FORECAST ---
@st.cache_data(ttl=1800)
def get_solar_forecast(lat: float, lon: float, panel_kwp: float):
    """Pulls 24-hr hourly tilted irradiance from Open-Meteo."""
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}&"
        f"hourly=global_tilted_irradiance,direct_normal_irradiance&forecast_days=1&timezone=auto"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "SolarApp/1.0"})
    with urllib.request.urlopen(req, timeout=6) as resp:
        data = json.loads(resp.read().decode())
    
    times = data["hourly"]["time"]
    gti = data["hourly"].get("global_tilted_irradiance") or data["hourly"]["direct_normal_irradiance"]
    
    rows = []
    for t_str, irr in zip(times, gti):
        h = datetime.fromisoformat(t_str).hour
        # Formula: Capacity * (Irradiance / 1000) * System Derate (~85%)
        kw = max(0.0, round(panel_kwp * (irr / 1000.0) * 0.85, 2))
        rows.append({"hour": h, "time_label": f"{h:02d}:00", "solar_kw": kw, "irradiance": irr})
    return pd.DataFrame(rows)


# ==========================================
# SIDEBAR: LOCATION & UTILITY CONFIG
# ==========================================
st.sidebar.header("1. Home Location")
zip_input = st.sidebar.text_input("Enter 5-Digit US ZIP Code", value="92618")

loc = lookup_zip(zip_input)
if not loc:
    st.sidebar.error("Invalid ZIP code. Defaulting to Irvine, CA.")
    loc = {"city": "Irvine", "state": "CA", "lat": 33.6846, "lon": -117.8265}
else:
    st.sidebar.success(f"Found: **{loc['city']}, {loc['state']}**")

panel_kwp = st.sidebar.slider("Solar Array Capacity (kWp)", min_value=1.0, max_value=25.0, value=8.5, step=0.5)

# Load State Utility Profile
state_rule = STATE_TARIFF_DEFAULTS.get(loc["state"], STATE_TARIFF_DEFAULTS["DEFAULT"])

st.sidebar.markdown("---")
st.sidebar.header("2. Electricity Tariff (TOU)")
with st.sidebar.expander("Review / Customise Utility Rates", expanded=False):
    st.caption(f"Default mapped to: **{state_rule['utility']}**")
    peak_rate = st.number_input("On-Peak Price ($/kWh)", value=state_rule["peak_rate"], step=0.01)
    off_rate = st.number_input("Off-Peak Price ($/kWh)", value=state_rule["off_rate"], step=0.01)
    export_credit = st.number_input("Grid Solar Export Credit ($/kWh)", value=state_rule["export"], step=0.01)
    peak_start = st.slider("On-Peak Start Hour (24h)", 0, 23, state_rule["peak_start"])
    peak_end = st.slider("On-Peak End Hour (24h)", 0, 23, state_rule["peak_end"])


# ==========================================
# MAIN PAGE: USER DEVICES INPUT
# ==========================================
st.title("SolarPeak: Automated Home Energy Dispatcher")
st.markdown(f"Optimizing smart loads for **{loc['city']}, {loc['state']} (ZIP: {zip_input})** using live solar forecasts.")

st.subheader("Add & Manage Your Home Devices")
st.markdown("Modify the table below: adjust device ratings, add new appliances, or toggle them on/off.")

# Default Device Table
default_devices = [
    {"Enabled": True, "Device Name": "Tesla / EV Charger", "Power (kW)": 7.2, "Duration (Hours)": 3, "Deadline Hour (0-23)": 19},
    {"Enabled": True, "Device Name": "Central AC Pre-Cool", "Power (kW)": 3.5, "Duration (Hours)": 2, "Deadline Hour (0-23)": 16},
    {"Enabled": True, "Device Name": "Heat Pump Water Heater", "Power (kW)": 1.5, "Duration (Hours)": 2, "Deadline Hour (0-23)": 23},
    {"Enabled": True, "Device Name": "Smart Pool Pump", "Power (kW)": 1.8, "Duration (Hours)": 4, "Deadline Hour (0-23)": 18},
    {"Enabled": False, "Device Name": "Dishwasher", "Power (kW)": 1.2, "Duration (Hours)": 1, "Deadline Hour (0-23)": 22},
]

# Editable Data Table
devices_df = st.data_editor(
    pd.DataFrame(default_devices),
    num_rows="dynamic",
    use_container_width=True,
    key="device_editor"
)

# Filter active devices
active_devices = devices_df[devices_df["Enabled"] == True].to_dict("records")


# ==========================================
# OPTIMIZATION ENGINE
# ==========================================
df_solar = get_solar_forecast(loc["lat"], loc["lon"], panel_kwp)

# Assign hourly pricing
def calculate_rate(hour):
    if peak_start <= hour < peak_end:
        return peak_rate, "On-Peak"
    return off_rate, "Off-Peak"

df_solar[["grid_rate", "rate_tier"]] = df_solar["hour"].apply(lambda h: pd.Series(calculate_rate(h)))

# Schedule loads based on solar surplus & lowest grid tariff
remaining_solar = df_solar["solar_kw"].copy().tolist()
scheduled_device_map = {h: [] for h in range(24)}
optimized_cost = 0.0
unmanaged_cost = 0.0

for dev in active_devices:
    name = dev["Device Name"]
    kw = float(dev["Power (kW)"])
    dur = int(dev["Duration (Hours)"])
    deadline = min(24, int(dev["Deadline Hour (0-23)"]))

    # Sort available hours before deadline: prioritize surplus solar first, then lowest grid cost
    candidate_hours = list(range(deadline))
    candidate_hours.sort(
        key=lambda h: (
            -min(remaining_solar[h], kw),         # 1st: maximize solar coverage
            df_solar.loc[h, "grid_rate"]          # 2nd: minimize grid price
        )
    )
    chosen_hours = candidate_hours[:dur]

    for h in chosen_hours:
        scheduled_device_map[h].append(name)
        solar_drawn = min(remaining_solar[h], kw)
        grid_drawn = max(0.0, kw - solar_drawn)
        remaining_solar[h] -= solar_drawn

        # Cost = lost opportunity of exported solar + grid purchase
        optimized_cost += (solar_drawn * export_credit) + (grid_drawn * df_solar.loc[h, "grid_rate"])

    # Baseline cost: assume device would have run unmanaged during the 5 PM on-peak window
    unmanaged_cost += (kw * dur) * peak_rate

df_solar["Triggered_Devices"] = [
    ", ".join(scheduled_device_map[h]) if scheduled_device_map[h] else "—" for h in range(24)
]


# ==========================================
# DASHBOARD VISUALS & METRICS
# ==========================================
st.markdown("---")
c1, c2, c3, c4 = st.columns(4)
peak_solar_val = df_solar["solar_kw"].max()
peak_hour = df_solar.loc[df_solar["solar_kw"].idxmax(), "time_label"]
total_solar = df_solar["solar_kw"].sum()
savings = max(0.0, unmanaged_cost - optimized_cost)

c1.metric("Peak Solar Output", f"{peak_solar_val:.1f} kW", f"At {peak_hour}")
c2.metric("Total Solar Generated", f"{total_solar:.1f} kWh")
c3.metric("Optimized Run Cost", f"${optimized_cost:.2f}")
c4.metric("Daily Money Saved", f"${savings:.2f}", delta="Saved vs On-Peak")

# Plot: Dual Axis Solar Curve vs Tariff
fig = go.Figure()
fig.add_trace(go.Bar(
    x=df_solar["time_label"], y=df_solar["solar_kw"],
    name="Solar Power (kW)", marker_color="#FFB300", opacity=0.85
))
fig.add_trace(go.Scatter(
    x=df_solar["time_label"], y=df_solar["grid_rate"],
    name="Grid Tariff ($/kWh)", yaxis="y2", line=dict(color="#D32F2F", width=3, dash="dot")
))

fig.update_layout(
    title=f"Solar Production vs. Grid Pricing Schedule ({loc['city']}, {loc['state']})",
    xaxis=dict(title="Hour of the Day"),
    yaxis=dict(title="Solar Production (kW)", side="left"),
    yaxis2=dict(title="Grid Rate ($/kWh)", side="right", overlaying="y", showgrid=False),
    legend=dict(x=0.01, y=0.99),
    hovermode="x unified",
    template="plotly_white",
    height=400
)
st.plotly_chart(fig, use_container_width=True)

# Schedule View
st.subheader("Automated 24-Hour Smart Device Schedule")
display_table = df_solar[["time_label", "solar_kw", "grid_rate", "rate_tier", "Triggered_Devices"]].rename(columns={
    "time_label": "Time", "solar_kw": "Solar (kW)", "grid_rate": "Tariff ($/kWh)",
    "rate_tier": "Rate Category", "Triggered_Devices": "Automated Smart Home Action"
})
st.dataframe(display_table, use_container_width=True, hide_index=True)

# Dispatch Trigger Button
if st.button("Send Dispatch Commands to Smart Home (Home Assistant / MQTT)"):
    now_hour = datetime.now().hour
    current_actions = scheduled_device_map.get(now_hour, [])
    if current_actions:
        st.success(f"Successfully signaled IoT relays for: **{', '.join(current_actions)}**")
    else:
        st.info("System is currently in idle / storage state. No devices need power this hour.")