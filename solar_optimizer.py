import json
import urllib.request
from datetime import datetime, timedelta
from typing import Dict, List, Any


# ==============================================================================
# 1. COUNTY-BASED TIME-OF-USE (TOU) TARIFF REGISTRY
# ==============================================================================
# Rates in USD per kWh. Models peak, mid-peak, off-peak, and solar export credits.
COUNTY_TARIFFS = {
    "Orange County, CA": {
        "utility": "SCE (Southern California Edison - TOU-D-PRIME)",
        "summer_months": [6, 7, 8, 9],
        "rates": {
            # 4 PM to 9 PM is on-peak ($0.54)
            "peak": 0.54,
            "mid_peak": 0.28,
            "off_peak": 0.16,
            "export_credit": 0.06  # NEM 3.0 avoided cost
        },
        "schedule": {
            # Hour -> Rate category (0 = Midnight, 16 = 4 PM, etc.)
            h: "peak" if 16 <= h < 21 else ("mid_peak" if 8 <= h < 16 else "off_peak")
            for h in range(24)
        }
    },
    "Travis County, TX": {
        "utility": "Austin Energy",
        "summer_months": [6, 7, 8, 9],
        "rates": {
            "peak": 0.18,
            "mid_peak": 0.12,
            "off_peak": 0.08,
            "export_credit": 0.09
        },
        "schedule": {
            h: "peak" if 14 <= h < 20 else "off_peak"
            for h in range(24)
        }
    },
    "Maricopa County, AZ": {
        "utility": "APS (Time-of-Use 4pm-7pm)",
        "summer_months": [5, 6, 7, 8, 9, 10],
        "rates": {
            "peak": 0.42,
            "mid_peak": 0.22,
            "off_peak": 0.13,
            "export_credit": 0.07
        },
        "schedule": {
            h: "peak" if 16 <= h < 19 else "off_peak"
            for h in range(24)
        }
    }
}


# ==============================================================================
# 2. SOLAR PRODUCTION FORECASTER
# ==============================================================================
class SolarForecaster:
    """Fetches real-world GHI/irradiance data and predicts AC power output."""
    
    def __init__(self, lat: float, lon: float, panel_kwp: float, efficiency_factor: float = 0.85):
        self.lat = lat
        self.lon = lon
        self.panel_kwp = panel_kwp
        self.efficiency = efficiency_factor

    def fetch_24h_forecast(self) -> List[Dict[str, Any]]:
        # Open-Meteo Solar Radiation API (no API key required)
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={self.lat}&longitude={self.lon}&"
            f"hourly=direct_normal_irradiance,diffuse_radiation,global_tilted_irradiance&"
            f"forecast_days=1&timezone=auto"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "SolarHomeOrchestrator/1.0"})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())

        times = data["hourly"]["time"]
        gti = data["hourly"].get("global_tilted_irradiance") or data["hourly"]["direct_normal_irradiance"]

        forecast = []
        for t_str, irradiance in zip(times, gti):
            dt = datetime.fromisoformat(t_str)
            # Estimate AC kW = kWp * (Irradiance W/m² / 1000) * system efficiency
            kw_generated = round(self.panel_kwp * (irradiance / 1000.0) * self.efficiency, 2)
            forecast.append({
                "hour": dt.hour,
                "time_str": dt.strftime("%H:00"),
                "irradiance_wm2": irradiance,
                "estimated_kw": max(0.0, kw_generated)
            })
        return forecast


# ==============================================================================
# 3. SMART DEVICE DEFINITIONS
# ==============================================================================
class SmartDevice:
    def __init__(self, name: str, power_kw: float, duration_hours: int, deadline_hour: int, priority: int, interruptible: bool = True):
        self.name = name
        self.power_kw = power_kw
        self.duration_hours = duration_hours
        self.deadline_hour = deadline_hour  # Device must complete by this hour
        self.priority = priority            # 1 (Highest, e.g. Car for morning commute)
        self.interruptible = interruptible
        self.hours_scheduled: List[int] = []

    def __repr__(self):
        return f"<Device {self.name}: {self.power_kw}kW x {self.duration_hours}h>"


# ==============================================================================
# 4. DISPATCHER & OPTIMIZATION ENGINE
# ==============================================================================
class EnergyOptimizer:
    def __init__(self, county: str, solar_forecast: List[Dict[str, Any]]):
        if county not in COUNTY_TARIFFS:
            raise ValueError(f"County '{county}' not configured.")
        self.tariff = COUNTY_TARIFFS[county]
        self.solar_forecast = solar_forecast

    def get_hour_cost_score(self, hour: int, excess_solar_kw: float, device_kw: float) -> float:
        """
        Calculates the effective cost of running a device at a specific hour.
        - Solar used = $0 direct cost (opportunity cost = lost export credit).
        - Grid used = imported TOU tariff rate.
        """
        rate_name = self.tariff["schedule"][hour]
        import_rate = self.tariff["rates"][rate_name]
        export_rate = self.tariff["rates"]["export_credit"]

        if excess_solar_kw >= device_kw:
            # Fully covered by solar. Marginal cost is just the lost export credit
            cost = device_kw * export_rate
        elif excess_solar_kw > 0:
            # Partially covered by solar, partially by grid
            grid_needed = device_kw - excess_solar_kw
            cost = (excess_solar_kw * export_rate) + (grid_needed * import_rate)
        else:
            # 100% grid import
            cost = device_kw * import_rate

        return cost

    def optimize_loads(self, devices: List[SmartDevice]) -> Dict[int, List[str]]:
        """
        Allocates devices to the hours that minimize total system cost
        while respecting deadlines and panel generation capacity.
        """
        # Sort devices by priority (1 first)
        sorted_devices = sorted(devices, key=lambda d: (d.priority, -d.power_kw))
        
        # Track available solar capacity left per hour
        hourly_solar_remaining = {f["hour"]: f["estimated_kw"] for f in self.solar_forecast}
        hourly_schedule: Dict[int, List[str]] = {h: [] for h in range(24)}

        for dev in sorted_devices:
            # Valid hours are up to deadline
            candidate_hours = [h for h in range(24) if h < dev.deadline_hour]

            # Score each candidate hour
            scored_hours = []
            for h in candidate_hours:
                rem_solar = hourly_solar_remaining[h]
                cost = self.get_hour_cost_score(h, rem_solar, dev.power_kw)
                scored_hours.append((h, cost, rem_solar))

            # Pick the lowest cost hours
            if dev.interruptible:
                scored_hours.sort(key=lambda x: x[1])
                chosen = scored_hours[:dev.duration_hours]
            else:
                # Contiguous block required
                best_block_cost = float('inf')
                best_start_idx = 0
                for i in range(len(candidate_hours) - dev.duration_hours + 1):
                    block = candidate_hours[i:i + dev.duration_hours]
                    block_cost = sum(
                        self.get_hour_cost_score(h, hourly_solar_remaining[h], dev.power_kw) 
                        for h in block
                    )
                    if block_cost < best_block_cost:
                        best_block_cost = block_cost
                        best_start_idx = i
                chosen = [(h, 0, 0) for h in candidate_hours[best_start_idx:best_start_idx + dev.duration_hours]]

            for h, _, _ in chosen:
                hourly_schedule[h].append(dev.name)
                # Deduct solar capacity consumed
                hourly_solar_remaining[h] = max(0.0, hourly_solar_remaining[h] - dev.power_kw)

        return hourly_schedule


# ==============================================================================
# 5. IOT / SMART HOME ACTUATOR (MOCK DISPATCHER)
# ==============================================================================
class HomeAssistantDispatcher:
    """Translates the plan into Home Assistant REST API or MQTT commands."""
    
    @staticmethod
    def trigger_device(device_name: str, state: str):
        # In production: requests.post("http://homeassistant.local:8123/api/services/switch/turn_on", ...)
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] [IoT Webhook] -> Sending command to {device_name.upper()}: {state}")


# ==============================================================================
# 6. DEMO RUNNER
# ==============================================================================
if __name__ == "__main__":
    # Location: Irvine, Orange County, CA
    LATITUDE = 33.6846
    LONGITUDE = -117.8265
    COUNTY = "Orange County, CA"
    PANEL_CAPACITY_KWP = 8.5  # 8.5 kW solar roof array

    print("=" * 70)
    print("1. FETCHING SOLAR FORECAST & UTILITY RATES...")
    print("=" * 70)

    forecaster = SolarForecaster(LATITUDE, LONGITUDE, PANEL_CAPACITY_KWP)
    solar_data = forecaster.fetch_24h_forecast()

    print(f"Target Utility: {COUNTY_TARIFFS[COUNTY]['utility']}")
    print(f"{'Hour':<6} | {'GTI Irradiance':<16} | {'Est. Solar Output':<18} | {'TOU Status':<12}")
    print("-" * 60)
    for entry in solar_data[6:21]: # Display daytime window
        h = entry["hour"]
        rate_type = COUNTY_TARIFFS[COUNTY]["schedule"][h]
        print(f"{entry['time_str']:<6} | {entry['irradiance_wm2']:>5} W/m²       | {entry['estimated_kw']:>5} kW            | {rate_type.upper()}")

    print("\n" + "=" * 70)
    print("2. CONFIGURING SMART LOADS TO SCHEDULE...")
    print("=" * 70)

    devices = [
        SmartDevice("Tesla Model Y (Level 2)", power_kw=7.0, duration_hours=4, deadline_hour=19, priority=1),
        SmartDevice("AC Thermal Pre-Cooling", power_kw=3.5, duration_hours=2, deadline_hour=16, priority=2),
        SmartDevice("Heat Pump Water Heater", power_kw=1.8, duration_hours=2, deadline_hour=23, priority=3),
        SmartDevice("Bosch Dishwasher", power_kw=1.2, duration_hours=1, deadline_hour=22, priority=4, interruptible=False)
    ]
    for d in devices:
        print(f"• {d.name} -> {d.power_kw} kW for {d.duration_hours}h (Must finish by {d.deadline_hour}:00)")

    optimizer = EnergyOptimizer(COUNTY, solar_data)
    schedule = optimizer.optimize_loads(devices)

    print("\n" + "=" * 70)
    print("3. FINAL OPTIMIZED 24-HOUR DISPATCH SCHEDULE")
    print("=" * 70)
    
    for h in range(24):
        time_str = f"{h:02d}:00"
        actions = schedule.get(h, [])
        solar_kw = solar_data[h]["estimated_kw"]
        rate = COUNTY_TARIFFS[COUNTY]["schedule"][h]
        price = COUNTY_TARIFFS[COUNTY]["rates"][rate]

        if actions or solar_kw > 1.0:
            actions_formatted = ", ".join(actions) if actions else "-- Solar Surplus Idle --"
            print(f"[{time_str}] (Solar: {solar_kw:>4.1f} kW | Rate: ${price:.2f}/kWh - {rate.upper():<8}) -> {actions_formatted}")

    print("\n" + "=" * 70)
    print("4. SIMULATING IOT DISPATCH AT PEAK WINDOW (12:00 PM)")
    print("=" * 70)
    midday_loads = schedule[12]
    for load in midday_loads:
        HomeAssistantDispatcher.trigger_device(load, "TURN_ON")