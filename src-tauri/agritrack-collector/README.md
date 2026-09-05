# AgriTrack collector

Daily collection of free, keyless public agricultural data for South
Africa's nine provinces. Writes into the SQLite database the Udaan Tauri
app owns — it never creates or seeds the schema itself.

## Prerequisites

Launch Udaan at least once first. `src-tauri/src/agritrack/store.rs`
creates the schema and seeds the reference tables (9 locations, 33 crops,
17 FAO-56 crop water coefficients) on startup; this script reads those
and will refuse to run against a missing database.

```
pip install -r requirements.txt
```

## Usage

```bash
# Collect the default target date (today minus the upstream publication lag)
python collector.py

# A specific day
python collector.py --date 2026-08-20

# Fill a range, e.g. after the machine was off for a fortnight
python collector.py --backfill-from 2026-08-01

# Point at a different database (testing)
python collector.py --db /tmp/agritrack-test.sqlite3
```

The database path defaults to Tauri's app data dir —
`%APPDATA%\dev.udaan.workstation\agritrack.sqlite3` on Windows. The
`AGRITRACK_DB` environment variable overrides it.

### Why the default date isn't today

Open-Meteo's archive reanalysis runs about five days behind and NASA
POWER about seven. Asking either for "today" returns nulls, so the
default target is `today - 8 days` (`COLLECTION_LAG_DAYS`). Running the
script daily still collects every day exactly once — just on an
eight-day delay.

## Windows Task Scheduler

Create a daily task running:

- **Program:** `python` (or the absolute path to your interpreter)
- **Arguments:** `collector.py`
- **Start in:** this directory

The script is safely re-runnable. It detects gaps against `collection_log`
and backfills every missed day, so a machine that was asleep for a week
catches up on its next run rather than leaving a permanent hole. Days
already fully collected are skipped, so a redundant run costs one query
and exits.

It is also invoked from inside the app by the "Collect Now" button, via
the `agritrack_run_collector_now` Tauri command, which runs this same
entry point with no arguments.

## Data sources

| Field | Source | Notes |
| --- | --- | --- |
| `rainfall_mm`, `temp_min_c`, `temp_max_c`, `humidity_pct` | Open-Meteo archive API | Free, no key |
| `evapotranspiration_mm`, `solar_radiation`, `soil_moisture_est` | NASA POWER daily point (`EVPTRNS`, `ALLSKY_SFC_SW_DWN`, `GWETROOT`) | Free, no key |
| `historical_climate_normals` | NASA POWER (`PRECTOTCORR`, `T2M`), 10 years averaged by day-of-year | Seeded once per location on first run |

All nine provinces are fetched concurrently — one ranged request per
source per province, so a 14-day backfill costs the same 18 HTTP calls as
a single day.

## Derived fields

- **`gdd_accumulated`** — Σ `max(0, (tmax + tmin) / 2 − base_temp_c)` over
  every stored day since the crop's `planting_date`. Recomputed from
  `daily_weather` rather than carried forward, so a backfilled day that
  arrives out of order still yields a correct cumulative total. Filling a
  gap also re-derives every later day's GDD, which would otherwise be
  understated by the days that were missing when it was first computed.
- **`water_stress_gap`** — `(ET0 × Kc) − rainfall`, in mm. Positive means
  the crop needed more water than fell. `Kc` is chosen per FAO-56 growth
  stage using accumulated GDD against the crop's
  `maturity_gdd_threshold`: initial below 33%, mid through 75%, late
  beyond. Thermal time rather than calendar days, so a cold season
  correctly delays the mid-season step.
- **`rainfall_deficit_30d`** — trailing 30-day actual rainfall minus the
  same window's climate normal. Negative is drier than normal. `NULL`
  when no normals exist for the location, rather than `0`, which would
  read as "exactly normal".
- **`frost_risk_flag` / `heat_stress_flag`** — crop-specific thresholds in
  `CROP_THRESHOLDS` (defaults 2 °C / 35 °C). Subtropicals are flagged
  well above freezing — bananas at 6 °C — while wheat tolerates −3 °C.

## Deliberately not implemented

These are stubbed rather than approximated. A fabricated value would be
indistinguishable from a real one in the table view and would silently
poison later analysis.

- **NDVI** (`get_ndvi_stub`) — needs a free Google Earth Engine account
  and service-account credentials, not yet set up. Writes `NULL`.
- **`daily_economic`** (`collect_economic_stub`) — no genuinely free,
  keyless source found for ZAR/USD, SA CPI, or SAFEX maize. The usual
  candidates all fail at least one test: exchangerate.host and Fixer now
  require an API key, the SARB and Stats SA publish releases rather than
  an open JSON endpoint, and JSE/SAFEX pricing is licensed commercial
  data. A row is still written per day with `NULL` indicators so the date
  is accounted for and the gap is visible.
- **`disease_bulletins`** — no automated collection. Populate manually.

## Failure handling

A failing source for one province on one day is recorded in
`collection_log.sources_failed` with the actual exception text; that
province is skipped and every other province still writes. If only one of
the two sources answers for a province, the row is still written with the
missing columns as `NULL` rather than being dropped entirely.

`collection_log` gets one row per run recording the date, timestamp, which
sources succeeded and failed, and notes such as how many days were
backfilled.

## Concurrency

The Udaan app may hold the same database open while this runs as a
sidecar. The connection uses WAL journaling and a 5-second busy timeout,
matching `src-tauri/src/db.rs`, so concurrent reads in the UI don't turn
these writes into `SQLITE_BUSY`.
