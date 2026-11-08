# Efficiency V

Efficiency V is a home solar and energy-planning project. Its dashboard estimates
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
cd C:\Users\name\Documents\GitHub\Silver-Lining
python -m pip install Flask requests python-dotenv
```

### Configure SolarBot (optional)

After cloning or downloading the repository, create a file named `.env` in the
repository's root folder (the same folder as this README). Open the new file in Notepad and add your Gemini API key to the file, then save it:

```text
GEMINI_API_KEY=*your_api_key_here*
```

Replace `your_api_key_here` with your actual key. Keep it private; do not share
or commit it. The `.env` file is listed in `.gitignore` so it is not distributed in this repo. Gemini chat also
requires available quota for the configured model and API project. It should be using Gemini 3.5 Flash.

### Configure account registration (Databricks)

Login and account registration require a Databricks SQL warehouse. Add these
settings to the same repository-root `.env` file:

```text
DATABRICKS_SERVER_HOSTNAME=your-workspace-hostname
DATABRICKS_ACCESS_TOKEN=your-databricks-access-token
DATABRICKS_WAREHOUSE_ID=your-sql-warehouse-id
```

The app also accepts `DATABRICKS_TOKEN` instead of
`DATABRICKS_ACCESS_TOKEN`. The configured warehouse needs permission to select
from and insert into `workspace.users.login`. Create that table in Databricks
before registering the first account:

```sql
CREATE SCHEMA IF NOT EXISTS workspace.users;

CREATE TABLE IF NOT EXISTS workspace.users.login (
  uid INT NOT NULL,
  username STRING,
  salt STRING NOT NULL,
  password_hash BINARY NOT NULL,
  email STRING,
  zip INT,
  CONSTRAINT login_pk PRIMARY KEY (uid)
);
```

If the table already exists without the `uid` column, add it before using
registration:

```sql
ALTER TABLE workspace.users.login ADD COLUMNS (uid INT);
```

The app stores password digests as binary data and converts them to hex when
checking logins. The `username` and `zip` fields are optional for the current
registration form.

If your Databricks catalog or schema has a different name, update the
`LOGIN_QUERY` and `REGISTER_QUERY` table paths in `solar_web_app/app.py` to
match it.

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
