import json
import math
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

ZIP_REGION_FALLBACK = {
    "0": {"city": "New England Area", "state": "MA", "lat": 42.3601, "lon": -71.0589},
    "1": {"city": "New York / Tri-State", "state": "NY", "lat": 40.7128, "lon": -74.0060},
    "2": {"city": "Mid-Atlantic / DC", "state": "DC", "lat": 38.9072, "lon": -77.0369},
    "3": {"city": "Southeast / Florida", "state": "FL", "lat": 25.7617, "lon": -80.1918},
    "4": {"city": "Great Lakes / Ohio", "state": "OH", "lat": 39.9612, "lon": -82.9988},
    "5": {"city": "Northern Midwest", "state": "MN", "lat": 44.9778, "lon": -93.2650},
    "6": {"city": "Central Midwest / IL", "state": "IL", "lat": 41.8781, "lon": -87.6298},
    "7": {"city": "Texas / Gulf Coast", "state": "TX", "lat": 30.2672, "lon": -97.7431},
    "8": {"city": "Mountain West / AZ", "state": "AZ", "lat": 33.4484, "lon": -112.0740},
    "9": {"city": "West Coast / CA", "state": "CA", "lat": 34.0522, "lon": -118.2437},
}

def get_location_from_zip(zip_code):
    clean_zip = "".join(filter(str.isdigit, str(zip_code)))[:5]
    if len(clean_zip) < 5:
        clean_zip = "90210"

    try:
        url = f"https://api.zippopotam.us/us/{clean_zip}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            place = data["places"][0]
            return {
                "city": place["place name"],
                "state": place["state abbreviation"],
                "lat": float(place["latitude"]),
                "lon": float(place["longitude"])
            }
    except Exception:
        pass

    first_digit = clean_zip[0] if clean_zip and clean_zip[0] in ZIP_REGION_FALLBACK else "9"
    fallback = ZIP_REGION_FALLBACK[first_digit].copy()
    fallback["city"] = f"{fallback['city']} ({clean_zip})"
    return fallback

def get_solar_production(lat, lon, panel_kwp):
    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={lat}&longitude={lon}&"
            f"hourly=shortwave_radiation,direct_normal_irradiance&"
            f"forecast_days=1&timezone=auto"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode())

        times = data["hourly"]["time"]
        shortwave = data["hourly"].get("shortwave_radiation") or [0] * len(times)

        hourly_kw = []
        for i, t_str in enumerate(times[:24]):
            dt = datetime.fromisoformat(t_str)
            irr = shortwave[i] if i < len(shortwave) else 0.0
            kw = max(0.0, round(panel_kwp * (irr / 1000.0) * 0.85, 2))
            hourly_kw.append({"hour": dt.hour, "time_label": f"{dt.hour:02d}:00", "solar_kw": kw})
        return hourly_kw

    except Exception:
        hourly_kw = []
        for h in range(24):
            if 6 <= h <= 18:
                sun_pct = math.sin((h - 6) / 12.0 * math.pi)
                kw = round(panel_kwp * 0.82 * sun_pct, 2)
            else:
                kw = 0.0
            hourly_kw.append({"hour": h, "time_label": f"{h:02d}:00", "solar_kw": kw})
        return hourly_kw

@app.route("/")
def home():
    return render_template("index.html")

# Add this route right below your @app.route("/")
@app.route("/settings")
def settings():
    return render_template("settings.html")

@app.route("/api/optimize", methods=["POST"])
def optimize():
    try:
        body = request.get_json(force=True) or {}
        zip_code = str(body.get("zip_code", "90210"))
        panel_kwp = float(body.get("panel_kwp", 8.5))
        devices = body.get("devices", [])

        loc = get_location_from_zip(zip_code)
        state_cfg = STATE_TARIFFS.get(loc.get("state"), STATE_TARIFFS["DEFAULT"])

        peak_rate = float(body.get("peak_rate", state_cfg["peak_rate"]))
        off_rate = float(body.get("off_rate", state_cfg["off_rate"]))
        export_credit = float(body.get("export_credit", state_cfg["export"]))
        peak_start = int(body.get("peak_start", state_cfg["peak_start"]))
        peak_end = int(body.get("peak_end", state_cfg["peak_end"]))

        solar_data = get_solar_production(loc["lat"], loc["lon"], panel_kwp)

        for row in solar_data:
            h = row["hour"]
            if peak_start <= h < peak_end:
                row["grid_rate"] = peak_rate
                row["tier"] = "On-Peak"
            else:
                row["grid_rate"] = off_rate
                row["tier"] = "Off-Peak"

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

            candidates = list(range(deadline))
            candidates.sort(key=lambda h: (-min(remaining_solar[h], kw), solar_data[h]["grid_rate"]))
            chosen = candidates[:dur]

            for h in chosen:
                scheduled_map[h].append(name)
                solar_used = min(remaining_solar[h], kw)
                grid_used = max(0.0, kw - solar_used)
                remaining_solar[h] -= solar_used
                optimized_cost += (solar_used * export_credit) + (grid_used * solar_data[h]["grid_rate"])

            unmanaged_cost += (kw * dur) * peak_rate

        for row in solar_data:
            row["actions"] = scheduled_map[row["hour"]]

        return jsonify({
            "success": True,
            "location": loc,
            "utility": state_cfg["utility"],
            "tariffs": {
                "peak_rate": peak_rate,
                "off_rate": off_rate,
                "export_credit": export_credit
            },
            "summary": {
                "total_solar_kwh": round(sum(r["solar_kw"] for r in solar_data), 1),
                "peak_solar_kw": max(r["solar_kw"] for r in solar_data),
                "optimized_cost": round(optimized_cost, 2),
                "savings": round(max(0.0, unmanaged_cost - optimized_cost), 2)
            },
            "hourly": solar_data
        })

    except Exception as err:
        return jsonify({"success": False, "error": str(err)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)