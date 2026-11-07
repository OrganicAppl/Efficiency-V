import json
import urllib.request
from datetime import datetime
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

STATE_TARIFFS = {
    "CA": {"utility": "California TOU / NEM 3.0", "peak_rate": 0.52, "off_rate": 0.16, "export": 0.06, "peak_start": 16, "peak_end": 21},
    "TX": {"utility": "Texas ERCOT Region", "peak_rate": 0.22, "off_rate": 0.08, "export": 0.08, "peak_start": 14, "peak_end": 20},
    "AZ": {"utility": "Arizona APS / SRP", "peak_rate": 0.42, "off_rate": 0.13, "export": 0.07, "peak_start": 16, "peak_end": 19},
    "NY": {"utility": "New York ConEd", "peak_rate": 0.34, "off_rate": 0.14, "export": 0.09, "peak_start": 14, "peak_end": 19},
    "FL": {"utility": "Florida FPL", "peak_rate": 0.22, "off_rate": 0.09, "export": 0.06, "peak_start": 12, "peak_end": 21},
    "DEFAULT": {"utility": "US Standard TOU", "peak_rate": 0.28, "off_rate": 0.12, "export": 0.07, "peak_start": 15, "peak_end": 20}
}

def get_location_from_zip(zip_code):
    try:
        url = f"https://api.zippopotam.us/us/{zip_code.strip()}"
        req = urllib.request.Request(url, headers={"User-Agent": "SolarWeb/1.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode())
            place = data["places"][0]
            return {
                "city": place["place name"],
                "state": place["state abbreviation"],
                "lat": float(place["latitude"]),
                "lon": float(place["longitude"])
            }
    except Exception:
        return {"city": "Irvine", "state": "CA", "lat": 33.6846, "lon": -117.8265}

def get_solar_production(lat, lon, panel_kwp):
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&hourly=global_tilted_irradiance,direct_normal_irradiance&forecast_days=1&timezone=auto"
    req = urllib.request.Request(url, headers={"User-Agent": "SolarWeb/1.0"})
    with urllib.request.urlopen(req, timeout=6) as resp:
        data = json.loads(resp.read().decode())

    times = data["hourly"]["time"]
    gti = data["hourly"].get("global_tilted_irradiance") or data["hourly"]["direct_normal_irradiance"]
    hourly_kw = []
    for t_str, irr in zip(times, gti):
        dt = datetime.fromisoformat(t_str)
        # AC Output = Panel kWp * (Irradiance / 1000) * 85% derate factor
        kw = max(0.0, round(panel_kwp * (irr / 1000.0) * 0.85, 2))
        hourly_kw.append({"hour": dt.hour, "time_label": f"{dt.hour:02d}:00", "solar_kw": kw})
    return hourly_kw

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/api/optimize", methods=["POST"])
def optimize():
    body = request.json or {}
    zip_code = body.get("zip_code", "92618")
    panel_kwp = float(body.get("panel_kwp", 8.5))
    devices = body.get("devices", [])

    loc = get_location_from_zip(zip_code)
    state_cfg = STATE_TARIFFS.get(loc["state"], STATE_TARIFFS["DEFAULT"])

    # Utility rates override or default
    peak_rate = float(body.get("peak_rate", state_cfg["peak_rate"]))
    off_rate = float(body.get("off_rate", state_cfg["off_rate"]))
    export_credit = float(body.get("export_credit", state_cfg["export"]))
    peak_start = int(body.get("peak_start", state_cfg["peak_start"]))
    peak_end = int(body.get("peak_end", state_cfg["peak_end"]))

    solar_data = get_solar_production(loc["lat"], loc["lon"], panel_kwp)

    # Calculate hourly grid rate
    for row in solar_data:
        h = row["hour"]
        if peak_start <= h < peak_end:
            row["grid_rate"] = peak_rate
            row["tier"] = "On-Peak"
        else:
            row["grid_rate"] = off_rate
            row["tier"] = "Off-Peak"

    # Scheduling Optimization
    remaining_solar = [r["solar_kw"] for r in solar_data]
    scheduled_map = {h: [] for h in range(24)}
    optimized_cost = 0.0
    unmanaged_cost = 0.0

    for dev in devices:
        if not dev.get("enabled", True):
            continue
        name = dev["name"]
        kw = float(dev["power_kw"])
        dur = int(dev["duration_hours"])
        deadline = min(24, int(dev.get("deadline", 24)))

        # Prioritize hours with maximum remaining solar surplus, then lowest grid cost
        candidate_hours = list(range(deadline))
        candidate_hours.sort(key=lambda h: (-min(remaining_solar[h], kw), solar_data[h]["grid_rate"]))
        chosen = candidate_hours[:dur]

        for h in chosen:
            scheduled_map[h].append(name)
            solar_used = min(remaining_solar[h], kw)
            grid_used = max(0.0, kw - solar_used)
            remaining_solar[h] -= solar_used
            optimized_cost += (solar_used * export_credit) + (grid_used * solar_data[h]["grid_rate"])

        # Cost if run during peak evening hours (5 PM)
        unmanaged_cost += (kw * dur) * peak_rate

    for row in solar_data:
        h = row["hour"]
        row["actions"] = scheduled_map[h]

    total_solar = round(sum(r["solar_kw"] for r in solar_data), 1)
    peak_solar = max(r["solar_kw"] for r in solar_data)

    return jsonify({
        "location": loc,
        "utility": state_cfg["utility"],
        "summary": {
            "total_solar_kwh": total_solar,
            "peak_solar_kw": peak_solar,
            "optimized_cost": round(optimized_cost, 2),
            "savings": round(max(0.0, unmanaged_cost - optimized_cost), 2)
        },
        "hourly": solar_data
    })

if __name__ == "__main__":
    app.run(debug=True, port=5000)