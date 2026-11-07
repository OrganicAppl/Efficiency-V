import json
import hashlib
import hmac
import math
import os
import secrets
import time
import urllib.request
from datetime import datetime
from functools import wraps
from flask import Flask, render_template, request, jsonify, redirect, send_from_directory, session, url_for
import re
import requests
from dotenv import load_dotenv

# Load GEMINI_API_KEY from .env
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# ==============================================================================
# INPUT SANITIZATION & GUARDRAILS
# ==============================================================================
PROMPT_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions",
    r"you\s+are\s+now",
    r"system\s*prompt",
    r"reveal\s+(the\s+)?(prompt|instructions)",
    r"jailbreak",
    r"<script.*?>",
    r"drop\s+table"
]

ENERGY_KEYWORDS = [
    "solar", "sun", "panel", "peak", "kw", "kwh", "price", "rate", "cost", "bill",
    "tariff", "tou", "charge", "car", "ev", "tesla", "ac", "cool", "heat", "pump",
    "washer", "dishwasher", "energy", "save", "savings", "battery", "weather",
    "grid", "export", "schedule", "time", "hour", "when", "today", "tomorrow", "appliance", "production"
]

def sanitize_and_validate(user_text: str):
    if not user_text or not isinstance(user_text, str):
        return None, "Empty query received."

    # 1. Length cap to prevent token flooding
    cleaned = user_text.strip()[:300]

    # 2. Block prompt injections
    for pattern in PROMPT_INJECTION_PATTERNS:
        if re.search(pattern, cleaned, re.IGNORECASE):
            return None, "Security Alert: Potentially malicious or unsupported prompt detected."

    # 4. Domain relevance filter
    words = re.findall(r"\w+", cleaned.lower())
    has_energy_topic = any(w in ENERGY_KEYWORDS for w in words)
    greetings = ["hi", "hello", "hey", "help", "who", "what"]
    is_greeting = any(cleaned.lower().startswith(g) for g in greetings) and len(cleaned.split()) <= 4

    if not has_energy_topic and not is_greeting:
        return None, "I am SolarBot, your smart energy copilot. I can only assist with your solar production, utility rates, and smart appliances."

    return cleaned, None


# ==============================================================================
# CALL GEMINI API
# ==============================================================================
def ask_gemini(user_prompt: str, context: dict) -> str:
    """
    Sends the user question to Google Gemini grounded with the dashboard forecast.
    """
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not found in .env file.")

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"

    system_instruction = f"""
You are SolarBot, a helpful home solar and energy assistant.
Use the dashboard data below when answering questions about this user's system.
It contains a forecast, not measured real-time production. Do not invent missing
measurements, rates, schedules, or location details. If dashboard data is not
available, say so and give general information only. Distinguish solar power
(kW) from energy generated (kWh). Stay focused on solar, electricity rates,
and appliance scheduling. Answer in 2-4 concise sentences and use bold for
important values.

Dashboard data (JSON):
{json.dumps(context, ensure_ascii=False, allow_nan=False)}
"""

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt}]
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 512
        }
    }

    try:
        response = requests.post(
            url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": GEMINI_API_KEY
            },
            timeout=(5, 45)
        )
    except requests.Timeout as err:
        raise RuntimeError("Gemini did not respond within 45 seconds. Please try again.") from err
    except requests.RequestException as err:
        raise RuntimeError(f"Could not connect to Gemini: {err}") from err

    try:
        data = response.json()
    except ValueError as err:
        raise RuntimeError(f"Gemini returned an unreadable response (HTTP {response.status_code}).") from err

    if response.status_code != 200:
        error_msg = data.get("error", {}).get("message", "Gemini API request failed")
        raise RuntimeError(f"Gemini error: {error_msg}")

    candidates = data.get("candidates", [])
    if not candidates:
        feedback = data.get("promptFeedback", {}).get("blockReason", "No response candidate was returned.")
        raise RuntimeError(f"Gemini could not answer: {feedback}")

    candidate = candidates[0]
    parts = candidate.get("content", {}).get("parts", [])
    answer = "".join(part.get("text", "") for part in parts if isinstance(part.get("text"), str)).strip()
    if not answer:
        raise RuntimeError("Gemini returned an empty answer.")

    if candidate.get("finishReason") == "MAX_TOKENS":
        answer += "\n\n(Gemini cut off this answer at its output limit.)"
    return answer


# ==============================================================================
# CHAT API ROUTE
# ==============================================================================
app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")
if not app.secret_key:
    raise RuntimeError(
        "FLASK_SECRET_KEY is required. Set it to a long, random value before starting the app."
    )

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("APP_ENV") == "production",
)


@app.route("/brand-logo")
def brand_logo():
    return send_from_directory(os.path.join(app.root_path, "imgs"), "square.jpeg")


LOGIN_QUERY = """
SELECT email, hex(password_hash), salt
FROM workspace.users.login
WHERE lower(email) = lower(:email)
LIMIT 2
"""
REGISTER_QUERY = """
INSERT INTO workspace.users.login (uid, email, password_hash, salt)
SELECT CAST(COALESCE(MAX(uid), 0) + 1 AS INT), :email, unhex(:password_hash), :salt
FROM workspace.users.login
"""


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if "user_email" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "Authentication required."}), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


@app.context_processor
def inject_csrf_token():
    return {"csrf_token": session.setdefault("csrf_token", secrets.token_urlsafe(32))}


def execute_databricks_statement(statement_sql, parameters):
    hostname = os.getenv("DATABRICKS_SERVER_HOSTNAME")
    token = os.getenv("DATABRICKS_TOKEN") or os.getenv("DATABRICKS_ACCESS_TOKEN")
    warehouse_id = os.getenv("DATABRICKS_WAREHOUSE_ID")
    http_path = os.getenv("DATABRICKS_HTTP_PATH", "")
    if not warehouse_id:
        warehouse_match = re.search(r"(?:^|/)warehouses/([^/]+)", http_path.rstrip("/"))
        if warehouse_match:
            warehouse_id = warehouse_match.group(1)
    if not hostname or not token or not warehouse_id:
        raise RuntimeError(
            "Set DATABRICKS_SERVER_HOSTNAME, DATABRICKS_TOKEN "
            "(or DATABRICKS_ACCESS_TOKEN), and DATABRICKS_WAREHOUSE_ID "
            "(or DATABRICKS_HTTP_PATH) to enable login."
        )

    hostname = hostname.removeprefix("https://").removeprefix("http://").rstrip("/")
    base_url = f"https://{hostname}/api/2.0/sql/statements"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    response = requests.post(
        base_url,
        headers=headers,
        json={
            "statement": statement_sql,
            "warehouse_id": warehouse_id,
            "wait_timeout": "10s",
            "on_wait_timeout": "CONTINUE",
            "disposition": "INLINE",
            "format": "JSON_ARRAY",
            "parameters": parameters,
        },
        timeout=(5, 15),
    )
    statement = _read_databricks_response(response)

    deadline = time.monotonic() + 30
    while statement.get("status", {}).get("state") in {"PENDING", "RUNNING"}:
        statement_id = statement.get("statement_id")
        if not statement_id:
            raise RuntimeError("Databricks did not return a statement ID.")
        if time.monotonic() >= deadline:
            raise RuntimeError("Databricks login query timed out.")
        time.sleep(0.25)
        response = requests.get(
            f"{base_url}/{statement_id}",
            headers=headers,
            timeout=(5, 15),
        )
        statement = _read_databricks_response(response)

    state = statement.get("status", {}).get("state")
    if state != "SUCCEEDED":
        error = statement.get("status", {}).get("error") or statement.get("error") or {}
        detail = error.get("message") if isinstance(error, dict) else str(error)
        if not detail:
            detail = "No error details were returned."
        raise RuntimeError(
            f"Databricks statement failed with state {state or 'unknown'}: {detail}"
        )

    return statement


def _read_databricks_response(response):
    try:
        body = response.json()
    except ValueError as err:
        raise RuntimeError(
            f"Databricks returned non-JSON data (HTTP {response.status_code})."
        ) from err

    if not response.ok:
        if isinstance(body, dict):
            detail = body.get("message") or body.get("error") or "No error details were returned."
        else:
            detail = "No error details were returned."
        raise RuntimeError(f"Databricks request failed (HTTP {response.status_code}): {detail}")
    if not isinstance(body, dict):
        raise RuntimeError("Databricks returned an unexpected response format.")
    return body


def lookup_login(email):
    statement = execute_databricks_statement(
        LOGIN_QUERY,
        [{"name": "email", "type": "STRING", "value": email}],
    )
    result = statement.get("result")
    rows = result.get("data_array") if isinstance(result, dict) else None
    if isinstance(rows, list):
        return rows

    manifest = statement.get("manifest")
    if isinstance(manifest, dict) and manifest.get("total_row_count") == 0:
        return []

    response_keys = ", ".join(sorted(statement))
    raise RuntimeError(
        "Databricks login query response did not contain row data "
        f"(response fields: {response_keys or 'none'})."
    )


def create_login(email, password):
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    execute_databricks_statement(
        REGISTER_QUERY,
        [
            {"name": "email", "type": "STRING", "value": email},
            {"name": "password_hash", "type": "STRING", "value": password_hash},
            {"name": "salt", "type": "STRING", "value": salt},
        ],
    )


def normalize_stored_password_hash(stored_hash):
    stored_hash_bytes = bytes.fromhex(stored_hash)
    if len(stored_hash_bytes) == 32:
        return stored_hash.lower()
    if len(stored_hash_bytes) == 64:
        legacy_hash = stored_hash_bytes.decode("ascii").lower()
        if len(bytes.fromhex(legacy_hash)) == 32:
            return legacy_hash
    raise ValueError("Unexpected password hash format.")


@app.route("/api/chat", methods=["POST"])
@login_required
def chat():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"reply": "Please send a valid chat message.", "safe": False}), 400

    raw_prompt = body.get("message", "")
    context = body.get("context", {})
    if not isinstance(context, dict):
        context = {}

    # 1. Sanitize & check guardrails first
    clean_prompt, error_msg = sanitize_and_validate(raw_prompt)
    if error_msg:
        return jsonify({"reply": error_msg, "safe": False})

    # 2. Call Gemini securely from backend
    try:
        ai_reply = ask_gemini(clean_prompt, context)
    except RuntimeError as err:
        return jsonify({"reply": str(err), "safe": False}), 502
    return jsonify({"reply": ai_reply, "safe": True})

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
@login_required
def home():
    return render_template("index.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if "user_email" in session:
        return redirect(url_for("home"))

    if request.method == "GET":
        csrf_token = session.setdefault("csrf_token", secrets.token_urlsafe(32))
        return render_template("login.html", csrf_token=csrf_token)

    submitted_csrf = request.form.get("csrf_token", "")
    expected_csrf = session.get("csrf_token", "")
    if not expected_csrf or not hmac.compare_digest(submitted_csrf, expected_csrf):
        return jsonify({"success": False, "error": "Your login session expired. Reload the page and try again."}), 400

    email = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    if not email or not password:
        return jsonify({"success": False, "error": "Enter your email and password."}), 400

    try:
        rows = lookup_login(email)
    except Exception:
        app.logger.exception("Databricks login lookup failed")
        return jsonify({"success": False, "error": "Login is temporarily unavailable."}), 503

    if len(rows) != 1:
        return jsonify({"success": False, "error": "Invalid email or password."}), 401

    if not isinstance(rows[0], list) or len(rows[0]) != 3:
        app.logger.error("Databricks login query returned a malformed row")
        return jsonify({"success": False, "error": "Login is temporarily unavailable."}), 503

    stored_email, stored_hash, salt = rows[0]
    if (
        not isinstance(stored_email, str)
        or not isinstance(stored_hash, str)
        or not isinstance(salt, str)
        or not salt
    ):
        app.logger.error("Databricks login row has an unexpected value type")
        return jsonify({"success": False, "error": "Login is temporarily unavailable."}), 503

    try:
        expected_hash = normalize_stored_password_hash(stored_hash)
    except (UnicodeDecodeError, ValueError):
        app.logger.error("Databricks login row has an invalid password hash")
        return jsonify({"success": False, "error": "Login is temporarily unavailable."}), 503

    candidate_hash = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    if not hmac.compare_digest(candidate_hash, expected_hash):
        return jsonify({"success": False, "error": "Invalid email or password."}), 401

    session.clear()
    session["user_email"] = stored_email
    return jsonify({"success": True})


@app.route("/logout", methods=["POST"])
def logout():
    submitted_csrf = request.form.get("csrf_token", "")
    expected_csrf = session.get("csrf_token", "")
    if not expected_csrf or not hmac.compare_digest(submitted_csrf, expected_csrf):
        return "Your session expired. Reload the page and try again.", 400

    session.clear()
    return redirect(url_for("login"))


@app.route("/register", methods=["POST"])
def register():
    if "user_email" in session:
        return jsonify({"success": False, "error": "You are already signed in."}), 400

    submitted_csrf = request.form.get("csrf_token", "")
    expected_csrf = session.get("csrf_token", "")
    if not expected_csrf or not hmac.compare_digest(submitted_csrf, expected_csrf):
        return jsonify({"success": False, "error": "Your session expired. Reload the page and try again."}), 400

    email = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    confirm_password = request.form.get("confirm_password", "")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify({"success": False, "error": "Enter a valid email address."}), 400
    if len(password) < 12:
        return jsonify({"success": False, "error": "Use a password with at least 12 characters."}), 400
    if password != confirm_password:
        return jsonify({"success": False, "error": "The passwords do not match."}), 400

    try:
        existing_users = lookup_login(email)
        if existing_users:
            return jsonify({"success": False, "error": "An account with that email already exists."}), 409
        create_login(email, password)
    except Exception:
        app.logger.exception("Databricks account creation failed")
        return jsonify({"success": False, "error": "Account creation is temporarily unavailable."}), 503

    session.clear()
    session["user_email"] = email
    return jsonify({"success": True})


@app.route("/settings")
@login_required
def settings():
    return render_template("settings.html")

@app.route("/api/optimize", methods=["POST"])
@login_required
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