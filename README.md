# Silver Lining

Silver Lining is a home solar and energy-planning project. Its dashboard estimates
hourly solar production from a location and solar-panel capacity, applies
time-of-use electricity rates, and suggests when to run household appliances to
make better use of solar power and lower-cost electricity. The web dashboard
also includes SolarBot, which can answer energy questions using the dashboard's
forecast and appliance schedule.

Solar production is an estimate based on forecast data, not a measurement from
your solar inverter. The dashboards use online services for location lookup and
weather/solar forecast data, so an internet connection is required.

## Flask web dashboard

### Requirements

- Python 3
- An internet connection
- A Gemini API key to use SolarBot chat (the dashboard and optimizer can be used
  without the chat key)

### Install

In PowerShell, change to the repository folder and install the Flask app's
dependencies:

```powershell
cd C:\Users\Angelina\Documents\GitHub\Silver-Lining
python -m pip install Flask requests python-dotenv
```

### Configure SolarBot (optional)

Add your Gemini API key to the repository-root `.env` file:

```text
GEMINI_API_KEY=your_api_key_here
```

Keep the key private. The `.env` file is listed in `.gitignore`. Gemini chat
also requires available quota for the configured model and API project.

### Run

From the repository folder:

```powershell
python .\solar_web_app\app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser. Stop the
development server with `Ctrl+C`.

## Streamlit optimizer (alternate dashboard)

The repository also contains a standalone Streamlit version of the solar
optimizer in `solar_optimizer.py`. To run it, install its dependencies and
launch it from the repository folder:

```powershell
python -m pip install streamlit pandas plotly
python -m streamlit run .\solar_optimizer.py
```
