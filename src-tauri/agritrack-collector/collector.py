"""AgriTrack daily data collector.

Pulls free, keyless public data for South African agricultural regions and
writes it into the SQLite database the Udaan Tauri app owns.

This script never creates or seeds the schema — `src-tauri/src/agritrack/
store.rs` does that on app launch. Here we only READ the reference tables
(locations, crops, crop_water_coefficients) and WRITE the daily/log tables.

Runs two ways, both supported:
  * As a Tauri sidecar, invoked by `agritrack_run_collector_now` with no
    arguments and cwd set to this directory.
  * Standalone from Windows Task Scheduler: `python collector.py`
    (optionally `--date YYYY-MM-DD` / `--backfill-from YYYY-MM-DD`).

Data sources (both free, no API key, no scraping):
  * Open-Meteo archive API  -> rainfall, temp min/max, humidity
  * NASA POWER daily point  -> evapotranspiration, solar radiation,
                               root-zone soil moisture

Everything else the schema has room for (NDVI, economic indicators,
disease bulletins) is deliberately stubbed rather than approximated —
see get_ndvi_stub(); economic.py documents its own sources.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
import pandas as pd

from economic import EconomicRow, collect_economic
from ndvi import NdviService, resolve_ndvi

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

APP_IDENTIFIER = "dev.udaan.workstation"
DB_FILENAME = "agritrack.sqlite3"

OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
NASA_POWER_DAILY = "https://power.larc.nasa.gov/api/temporal/daily/point"

SOURCE_OPEN_METEO = "open-meteo"
SOURCE_NASA_POWER = "nasa-power"

# Both upstreams publish on a lag — Open-Meteo's archive reanalysis is
# ~5 days behind and NASA POWER ~7. Collecting "today" would therefore
# reliably return nulls, so the default target date is deliberately
# offset rather than being date.today().
COLLECTION_LAG_DAYS = 8

# How far back gap-detection is willing to walk on a first run (or after
# a long outage) before giving up and just collecting the target date.
# Keeps an empty database from trying to backfill from epoch.
MAX_BACKFILL_DAYS = 45

# Years of NASA POWER history averaged per day-of-year to populate
# historical_climate_normals. Done once per location, not every run.
NORMALS_YEARS = 10

# Fallback stress thresholds, used when a crop has no more specific value
# in CROP_THRESHOLDS below.
DEFAULT_FROST_C = 2.0
DEFAULT_HEAT_C = 35.0

# Crop-specific frost/heat thresholds where the generic 2 C / 35 C
# defaults would be misleading. Subtropicals are damaged well above
# freezing; small grains tolerate far more heat than soft fruit.
CROP_THRESHOLDS: dict[str, tuple[float, float]] = {
    # crop_name: (frost_risk_below_c, heat_stress_above_c)
    "Citrus": (0.0, 38.0),
    "Bananas": (6.0, 37.0),
    "Mangoes": (4.0, 40.0),
    "Pineapples": (7.0, 35.0),
    "Sugarcane": (2.0, 38.0),
    "Tomatoes": (2.0, 32.0),
    "Potatoes": (0.0, 30.0),
    "Maize": (0.0, 35.0),
    "Wheat": (-3.0, 32.0),
    "Canola": (-3.0, 30.0),
    "Sunflower": (0.0, 37.0),
    "Lucerne": (-5.0, 38.0),
    "Apples": (-2.0, 32.0),
    "Wine grapes": (0.0, 35.0),
    "Table grapes": (0.0, 38.0),
    "Onions": (-2.0, 35.0),
    "Vegetables": (2.0, 32.0),
}

HTTP_TIMEOUT = httpx.Timeout(60.0, connect=20.0)
# Open-Meteo and NASA POWER are both fine with 9 concurrent point
# queries; this cap exists to stay a polite client, not because either
# documents a hard limit at this level.
MAX_CONCURRENCY = 9


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------


def resolve_db_path() -> str:
    """Locate the SQLite file the Rust side created.

    Mirrors Tauri's `app_data_dir()` on Windows (%APPDATA%/<identifier>).
    AGRITRACK_DB overrides it, which is what the test/verification path
    and any non-Windows debugging uses.
    """
    override = os.environ.get("AGRITRACK_DB")
    if override:
        return override

    appdata = os.environ.get("APPDATA")
    if appdata:
        return os.path.join(appdata, APP_IDENTIFIER, DB_FILENAME)

    # Non-Windows fallback, matching Tauri's Linux/macOS app_data_dir.
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", APP_IDENTIFIER, DB_FILENAME)
    return os.path.join(home, ".local", "share", APP_IDENTIFIER, DB_FILENAME)


def connect(db_path: str) -> sqlite3.Connection:
    """Open the shared DB with the same concurrency settings as Rust.

    The Udaan app may well be running (and holding this same file open)
    while this script executes as a sidecar, so WAL + a real busy timeout
    are not optional — they're what stop a concurrent read in the UI from
    turning our writes into SQLITE_BUSY. `src-tauri/src/db.rs` configures
    the Rust connections identically.
    """
    if not os.path.exists(db_path):
        raise SystemExit(
            f"AgriTrack database not found at {db_path}.\n"
            "Launch Udaan once first — the Rust side creates and seeds the schema."
        )
    conn = sqlite3.connect(db_path, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    # daily_economic is one row per date, but the Rust schema predates
    # that being enforced. The index is what makes the ON CONFLICT upsert
    # in write_economic() work, so it is created here rather than assumed.
    # CREATE UNIQUE INDEX IF NOT EXISTS is a no-op once it exists.
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_economic_date ON daily_economic(date)"
    )
    conn.commit()
    return conn


@dataclass(frozen=True)
class Location:
    location_id: int
    province: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class Crop:
    crop_id: int
    crop_name: str
    location_id: int
    latitude: float
    longitude: float
    base_temp_c: float
    planting_date: date | None


@dataclass(frozen=True)
class WaterCoefficients:
    kc_initial: float
    kc_mid: float
    kc_late: float
    maturity_gdd_threshold: float


def load_locations(conn: sqlite3.Connection) -> list[Location]:
    rows = conn.execute(
        "SELECT location_id, province, latitude, longitude FROM locations ORDER BY location_id"
    ).fetchall()
    return [Location(r["location_id"], r["province"], r["latitude"], r["longitude"]) for r in rows]


def load_crops(conn: sqlite3.Connection) -> list[Crop]:
    """Read the crop rows the Rust seeder wrote.

    Crop coordinates are per-crop (a crop's growing area often sits well
    away from its province's representative point — Western Cape wine
    grapes in the Breede River Valley vs. the Swartland wheat belt), but
    weather is fetched per *location*, so `crop_latitude`/`crop_longitude`
    are carried here for future per-crop fetching without being used to
    duplicate today's API calls 32x.
    """
    rows = conn.execute(
        """SELECT crop_id, crop_name, location_id, crop_latitude, crop_longitude,
                  base_temp_c, planting_date
           FROM crops ORDER BY crop_id"""
    ).fetchall()
    crops: list[Crop] = []
    for r in rows:
        planting = None
        if r["planting_date"]:
            try:
                planting = date.fromisoformat(str(r["planting_date"]))
            except ValueError:
                planting = None
        crops.append(
            Crop(
                crop_id=r["crop_id"],
                crop_name=r["crop_name"],
                location_id=r["location_id"],
                latitude=r["crop_latitude"],
                longitude=r["crop_longitude"],
                base_temp_c=r["base_temp_c"] if r["base_temp_c"] is not None else 10.0,
                planting_date=planting,
            )
        )
    return crops


def load_water_coefficients(conn: sqlite3.Connection) -> dict[str, WaterCoefficients]:
    rows = conn.execute(
        """SELECT crop_name, kc_initial, kc_mid, kc_late, maturity_gdd_threshold
           FROM crop_water_coefficients"""
    ).fetchall()
    return {
        r["crop_name"]: WaterCoefficients(
            kc_initial=r["kc_initial"],
            kc_mid=r["kc_mid"],
            kc_late=r["kc_late"],
            maturity_gdd_threshold=r["maturity_gdd_threshold"],
        )
        for r in rows
    }


# --------------------------------------------------------------------------
# Upstream fetching
# --------------------------------------------------------------------------


class SourceFailure(Exception):
    """One province's one API call failed.

    Carried rather than raised to the top so a single bad response
    degrades that province only — every other province in the same run
    still gets collected and written.
    """

    def __init__(self, source: str, province: str, detail: str):
        super().__init__(f"{source}/{province}: {detail}")
        self.source = source
        self.province = province
        self.detail = detail


async def fetch_open_meteo(
    client: httpx.AsyncClient, loc: Location, start: date, end: date
) -> pd.DataFrame:
    """Daily rainfall / temp extremes / mean humidity for a date range."""
    params = {
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": "precipitation_sum,temperature_2m_min,temperature_2m_max,relative_humidity_2m_mean",
        "timezone": "UTC",
    }
    try:
        resp = await client.get(OPEN_METEO_ARCHIVE, params=params)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        raise SourceFailure(SOURCE_OPEN_METEO, loc.province, f"{type(exc).__name__}: {exc}") from exc

    daily = payload.get("daily")
    if not daily or not daily.get("time"):
        raise SourceFailure(SOURCE_OPEN_METEO, loc.province, "response contained no daily block")

    frame = pd.DataFrame(
        {
            "date": pd.to_datetime(daily["time"]).date,
            "rainfall_mm": daily.get("precipitation_sum"),
            "temp_min_c": daily.get("temperature_2m_min"),
            "temp_max_c": daily.get("temperature_2m_max"),
            "humidity_pct": daily.get("relative_humidity_2m_mean"),
        }
    )
    return frame.set_index("date")


async def fetch_nasa_power(
    client: httpx.AsyncClient, loc: Location, start: date, end: date
) -> pd.DataFrame:
    """Evapotranspiration / solar radiation / root-zone soil wetness.

    EVPTRNS is mm/day, ALLSKY_SFC_SW_DWN is MJ/m^2/day, GWETROOT is a
    unitless 0-1 root-zone wetness fraction. POWER encodes missing values
    as -999, which pandas would otherwise happily average into nonsense.
    """
    params = {
        "parameters": "EVPTRNS,ALLSKY_SFC_SW_DWN,GWETROOT",
        "community": "AG",
        "latitude": loc.latitude,
        "longitude": loc.longitude,
        "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "format": "JSON",
    }
    try:
        resp = await client.get(NASA_POWER_DAILY, params=params)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        raise SourceFailure(SOURCE_NASA_POWER, loc.province, f"{type(exc).__name__}: {exc}") from exc

    parameters = payload.get("properties", {}).get("parameter")
    if not parameters:
        raise SourceFailure(SOURCE_NASA_POWER, loc.province, "response contained no parameter block")

    frame = pd.DataFrame(
        {
            "evapotranspiration_mm": pd.Series(parameters.get("EVPTRNS", {})),
            "solar_radiation": pd.Series(parameters.get("ALLSKY_SFC_SW_DWN", {})),
            "soil_moisture_est": pd.Series(parameters.get("GWETROOT", {})),
        }
    )
    frame = frame.replace(-999.0, pd.NA)
    frame.index = pd.to_datetime(frame.index, format="%Y%m%d").date
    return frame


async def gather_province_weather(
    locations: list[Location], start: date, end: date
) -> tuple[dict[int, pd.DataFrame], list[SourceFailure]]:
    """Fetch both sources for all 9 provinces concurrently.

    Each province needs two independent HTTP calls, and no province
    depends on any other, so the whole 18-call matrix goes out at once
    rather than serially — the difference between ~2 seconds and ~40.
    """
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

    async def one(client: httpx.AsyncClient, loc: Location, fetcher) -> pd.DataFrame:
        async with semaphore:
            return await fetcher(client, loc, start, end)

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers={"User-Agent": "Udaan-AgriTrack/1.0"}) as client:
        tasks = []
        for loc in locations:
            tasks.append(one(client, loc, fetch_open_meteo))
            tasks.append(one(client, loc, fetch_nasa_power))
        results = await asyncio.gather(*tasks, return_exceptions=True)

    merged: dict[int, pd.DataFrame] = {}
    failures: list[SourceFailure] = []

    for idx, loc in enumerate(locations):
        meteo = results[idx * 2]
        power = results[idx * 2 + 1]

        frames = []
        for outcome in (meteo, power):
            if isinstance(outcome, SourceFailure):
                failures.append(outcome)
            elif isinstance(outcome, BaseException):
                failures.append(SourceFailure("unknown", loc.province, repr(outcome)))
            else:
                frames.append(outcome)

        if frames:
            # An outer join keeps a province usable when only one of the
            # two sources answered — the missing columns land as NaN and
            # are written as NULL rather than the whole row being dropped.
            combined = frames[0]
            for extra in frames[1:]:
                combined = combined.join(extra, how="outer")
            merged[loc.location_id] = combined

    return merged, failures


# --------------------------------------------------------------------------
# Climate normals
# --------------------------------------------------------------------------


async def ensure_climate_normals(
    conn: sqlite3.Connection, locations: list[Location]
) -> tuple[list[str], list[SourceFailure]]:
    """Populate historical_climate_normals for any location missing it.

    rainfall_deficit_30d is meaningless without a baseline to compare
    against, so the first run for a location pulls NORMALS_YEARS of NASA
    POWER history and averages precipitation/temperature by day-of-year.
    Idempotent: locations that already have rows are skipped, so this
    costs nothing on every subsequent run.
    """
    notes: list[str] = []
    failures: list[SourceFailure] = []

    missing = [
        loc
        for loc in locations
        if conn.execute(
            "SELECT COUNT(*) FROM historical_climate_normals WHERE location_id = ?",
            (loc.location_id,),
        ).fetchone()[0]
        == 0
    ]
    if not missing:
        return notes, failures

    end = date.today() - timedelta(days=COLLECTION_LAG_DAYS)
    start = date(end.year - NORMALS_YEARS, 1, 1)
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

    async def one(client: httpx.AsyncClient, loc: Location):
        async with semaphore:
            params = {
                "parameters": "PRECTOTCORR,T2M",
                "community": "AG",
                "latitude": loc.latitude,
                "longitude": loc.longitude,
                "start": start.strftime("%Y%m%d"),
                "end": end.strftime("%Y%m%d"),
                "format": "JSON",
            }
            try:
                resp = await client.get(NASA_POWER_DAILY, params=params)
                resp.raise_for_status()
                payload = resp.json()
            except Exception as exc:  # noqa: BLE001
                raise SourceFailure(
                    SOURCE_NASA_POWER, loc.province, f"normals: {type(exc).__name__}: {exc}"
                ) from exc

            parameters = payload.get("properties", {}).get("parameter")
            if not parameters:
                raise SourceFailure(SOURCE_NASA_POWER, loc.province, "normals: no parameter block")

            frame = pd.DataFrame(
                {
                    "avg_rainfall_mm": pd.Series(parameters.get("PRECTOTCORR", {})),
                    "avg_temp_c": pd.Series(parameters.get("T2M", {})),
                }
            ).replace(-999.0, pd.NA)
            frame.index = pd.to_datetime(frame.index, format="%Y%m%d")
            frame["day_of_year"] = frame.index.dayofyear
            return loc, frame.groupby("day_of_year").mean(numeric_only=True)

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers={"User-Agent": "Udaan-AgriTrack/1.0"}) as client:
        outcomes = await asyncio.gather(*(one(client, loc) for loc in missing), return_exceptions=True)

    for outcome in outcomes:
        if isinstance(outcome, SourceFailure):
            failures.append(outcome)
            continue
        if isinstance(outcome, BaseException):
            failures.append(SourceFailure("unknown", "?", repr(outcome)))
            continue

        loc, normals = outcome
        rows = [
            (
                loc.location_id,
                int(doy),
                None if pd.isna(row["avg_rainfall_mm"]) else float(row["avg_rainfall_mm"]),
                None if pd.isna(row["avg_temp_c"]) else float(row["avg_temp_c"]),
            )
            for doy, row in normals.iterrows()
        ]
        conn.executemany(
            """INSERT INTO historical_climate_normals
                 (location_id, day_of_year, avg_rainfall_mm, avg_temp_c)
               VALUES (?, ?, ?, ?)""",
            rows,
        )
        conn.commit()
        notes.append(f"seeded {len(rows)} climate normals for {loc.province}")

    return notes, failures


def rainfall_deficit_30d(conn: sqlite3.Connection, location_id: int, target: date) -> float | None:
    """Actual trailing-30-day rainfall minus the same window's normal.

    Negative means drier than normal, which is the direction that matters
    agronomically. Returns None when we have no normals for the location
    (rather than silently reporting a deficit of zero, which would read
    as "exactly normal" and be actively misleading).
    """
    window_start = target - timedelta(days=29)

    actual_row = conn.execute(
        "SELECT SUM(rainfall_mm) FROM daily_weather WHERE location_id = ? AND date BETWEEN ? AND ?",
        (location_id, window_start.isoformat(), target.isoformat()),
    ).fetchone()
    actual = actual_row[0]
    if actual is None:
        return None

    days = [(window_start + timedelta(days=i)).timetuple().tm_yday for i in range(30)]
    placeholders = ",".join("?" * len(days))
    normal_row = conn.execute(
        f"""SELECT SUM(avg_rainfall_mm) FROM historical_climate_normals
            WHERE location_id = ? AND day_of_year IN ({placeholders})""",
        (location_id, *days),
    ).fetchone()
    normal = normal_row[0]
    if normal is None:
        return None

    return round(float(actual) - float(normal), 3)


# --------------------------------------------------------------------------
# Crop calculations
# --------------------------------------------------------------------------


def resolve_crop_ndvi(
    service: NdviService, conn: sqlite3.Connection, crop: Crop, target: date
) -> tuple[float | None, int | None]:
    """(ndvi_value, ndvi_age_days) for one crop-day.

    Delegates to ndvi.py, which handles the Sentinel-2 query, the
    three-group rotation, and carry-forward. When Earth Engine isn't
    configured this returns (None, None) for every crop without an API
    call — weather and telemetry collection proceed untouched.
    """
    reading = resolve_ndvi(service, conn, crop.crop_id, crop.latitude, crop.longitude, target)
    return reading.value, reading.age_days


def growth_stage_kc(gdd: float, coeffs: WaterCoefficients) -> float:
    """Pick the FAO-56 Kc matching the crop's current development stage.

    Stage boundaries are expressed against accumulated GDD as a fraction
    of the crop's maturity threshold — thermal time rather than calendar
    days, so a cold season correctly delays the mid-season Kc step.
    """
    threshold = coeffs.maturity_gdd_threshold or 0.0
    if threshold <= 0:
        return coeffs.kc_mid
    progress = gdd / threshold
    if progress < 0.33:
        return coeffs.kc_initial
    if progress <= 0.75:
        return coeffs.kc_mid
    return coeffs.kc_late


def accumulated_gdd(
    conn: sqlite3.Connection, crop: Crop, target: date
) -> float:
    """Sum max(0, mean_temp - base_temp) over every stored day since planting.

    Reads back from daily_weather rather than keeping a running total in
    daily_crop_telemetry, so a backfilled day that lands out of order
    still produces a correct cumulative figure on the next run.
    """
    if crop.planting_date is None or crop.planting_date > target:
        return 0.0

    rows = conn.execute(
        """SELECT temp_min_c, temp_max_c FROM daily_weather
           WHERE location_id = ? AND date BETWEEN ? AND ?
             AND temp_min_c IS NOT NULL AND temp_max_c IS NOT NULL""",
        (crop.location_id, crop.planting_date.isoformat(), target.isoformat()),
    ).fetchall()

    total = 0.0
    for row in rows:
        mean_temp = (row["temp_max_c"] + row["temp_min_c"]) / 2.0
        total += max(0.0, mean_temp - crop.base_temp_c)
    return round(total, 2)


def water_stress_gap(et0: float | None, rainfall: float | None, kc: float) -> float | None:
    """Crop water requirement minus supply, in mm.

    (ET0 x Kc) - rainfall. Positive means the crop needed more water than
    fell that day. Returns None when ET0 is missing rather than treating
    an absent measurement as zero demand.
    """
    if et0 is None or pd.isna(et0):
        return None
    rain = 0.0 if rainfall is None or pd.isna(rainfall) else float(rainfall)
    return round(float(et0) * kc - rain, 3)


def stress_flags(crop_name: str, temp_min: float | None, temp_max: float | None) -> tuple[bool | None, bool | None]:
    frost_threshold, heat_threshold = CROP_THRESHOLDS.get(crop_name, (DEFAULT_FROST_C, DEFAULT_HEAT_C))
    frost = None if temp_min is None or pd.isna(temp_min) else bool(float(temp_min) < frost_threshold)
    heat = None if temp_max is None or pd.isna(temp_max) else bool(float(temp_max) > heat_threshold)
    return frost, heat


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------


def _clean(value: Any) -> Any:
    """NaN/pd.NA -> None, numpy scalar -> Python float, for sqlite3 binding."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        return value.item()
    return value


def write_daily_weather(
    conn: sqlite3.Connection, loc: Location, target: date, row: pd.Series
) -> None:
    """Upsert one province-day.

    ON CONFLICT rather than INSERT OR IGNORE: a backfill re-run for a day
    whose data has since been revised upstream (Open-Meteo's reanalysis
    does firm up over the following days) should update the row, not
    silently keep the earlier provisional numbers.
    """
    retrieved = datetime.now(timezone.utc).isoformat(timespec="seconds")
    conn.execute(
        """INSERT INTO daily_weather
             (location_id, date, rainfall_mm, temp_min_c, temp_max_c, humidity_pct,
              evapotranspiration_mm, solar_radiation, soil_moisture_est,
              rainfall_deficit_30d, data_source, retrieved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(location_id, date) DO UPDATE SET
             rainfall_mm = excluded.rainfall_mm,
             temp_min_c = excluded.temp_min_c,
             temp_max_c = excluded.temp_max_c,
             humidity_pct = excluded.humidity_pct,
             evapotranspiration_mm = excluded.evapotranspiration_mm,
             solar_radiation = excluded.solar_radiation,
             soil_moisture_est = excluded.soil_moisture_est,
             rainfall_deficit_30d = excluded.rainfall_deficit_30d,
             data_source = excluded.data_source,
             retrieved_at = excluded.retrieved_at""",
        (
            loc.location_id,
            target.isoformat(),
            _clean(row.get("rainfall_mm")),
            _clean(row.get("temp_min_c")),
            _clean(row.get("temp_max_c")),
            _clean(row.get("humidity_pct")),
            _clean(row.get("evapotranspiration_mm")),
            _clean(row.get("solar_radiation")),
            _clean(row.get("soil_moisture_est")),
            None,  # rainfall_deficit_30d filled in a second pass below
            f"{SOURCE_OPEN_METEO}+{SOURCE_NASA_POWER}",
            retrieved,
        ),
    )


def write_crop_telemetry(
    conn: sqlite3.Connection,
    crop: Crop,
    target: date,
    weather_row: sqlite3.Row,
    coeffs: WaterCoefficients | None,
    ndvi_service: NdviService,
) -> None:
    """Derive and upsert one crop-day from that location's stored weather."""
    gdd = accumulated_gdd(conn, crop, target)
    kc = growth_stage_kc(gdd, coeffs) if coeffs else 1.0
    gap = water_stress_gap(weather_row["evapotranspiration_mm"], weather_row["rainfall_mm"], kc)
    frost, heat = stress_flags(crop.crop_name, weather_row["temp_min_c"], weather_row["temp_max_c"])
    ndvi_value, ndvi_age = resolve_crop_ndvi(ndvi_service, conn, crop, target)
    retrieved = datetime.now(timezone.utc).isoformat(timespec="seconds")

    conn.execute(
        """INSERT INTO daily_crop_telemetry
             (crop_id, date, ndvi_value, ndvi_age_days, water_stress_gap, gdd_accumulated,
              frost_risk_flag, heat_stress_flag, data_source, retrieved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(crop_id, date) DO UPDATE SET
             ndvi_value = excluded.ndvi_value,
             ndvi_age_days = excluded.ndvi_age_days,
             water_stress_gap = excluded.water_stress_gap,
             gdd_accumulated = excluded.gdd_accumulated,
             frost_risk_flag = excluded.frost_risk_flag,
             heat_stress_flag = excluded.heat_stress_flag,
             data_source = excluded.data_source,
             retrieved_at = excluded.retrieved_at""",
        (
            crop.crop_id,
            target.isoformat(),
            ndvi_value,
            ndvi_age,
            gap,
            gdd,
            frost,
            heat,
            f"derived:{SOURCE_OPEN_METEO}+{SOURCE_NASA_POWER}",
            retrieved,
        ),
    )


def write_economic(conn: sqlite3.Connection, target: date, row: "EconomicRow") -> None:
    """Upsert one day's economic indicators.

    Skips entirely when every field is None — a row of nothing but NULLs
    records only that the collector ran, which `collection_log` already
    says more clearly. Weekends legitimately have no FX or settlement
    price, and an empty row would misrepresent that as a failed fetch.
    """
    if row.is_empty():
        return

    conn.execute(
        """INSERT INTO daily_economic
             (date, zar_usd_rate, inflation_rate, maize_price_safex, data_source, retrieved_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET
             zar_usd_rate = COALESCE(excluded.zar_usd_rate, daily_economic.zar_usd_rate),
             inflation_rate = COALESCE(excluded.inflation_rate, daily_economic.inflation_rate),
             maize_price_safex = COALESCE(excluded.maize_price_safex, daily_economic.maize_price_safex),
             data_source = excluded.data_source,
             retrieved_at = excluded.retrieved_at""",
        (
            target.isoformat(),
            row.zar_usd_rate,
            row.inflation_rate,
            row.maize_price_safex,
            row.data_source(),
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
        ),
    )


def write_collection_log(
    conn: sqlite3.Connection,
    run_date: date,
    succeeded: list[str],
    failed: list[str],
    notes: list[str],
) -> None:
    conn.execute(
        """INSERT INTO collection_log
             (run_date, run_timestamp, sources_succeeded, sources_failed, notes)
           VALUES (?, ?, ?, ?, ?)""",
        (
            run_date.isoformat(),
            datetime.now(timezone.utc).isoformat(timespec="seconds"),
            ", ".join(sorted(set(succeeded))) or None,
            "; ".join(failed) or None,
            " | ".join(notes) or None,
        ),
    )
    conn.commit()


# --------------------------------------------------------------------------
# Gap detection
# --------------------------------------------------------------------------


def dates_to_collect(conn: sqlite3.Connection, target: date, backfill_from: date | None) -> list[date]:
    """Every date this run should cover, oldest first.

    An explicit --backfill-from wins. Otherwise the window opens the day
    after the most recent logged run and closes at the target date, so a
    machine that was off for a week catches up on all seven days instead
    of collecting only the latest and leaving a permanent hole. Days
    already present in daily_weather for all 9 provinces are dropped, so
    re-running the same day is cheap rather than a no-op full refetch.
    """
    if backfill_from is not None:
        start = backfill_from
    else:
        row = conn.execute("SELECT MAX(run_date) FROM collection_log").fetchone()
        last_run = row[0] if row else None
        if last_run:
            try:
                start = date.fromisoformat(str(last_run)) + timedelta(days=1)
            except ValueError:
                start = target
        else:
            # First ever run: just the target day. Deep history is what
            # --backfill-from is for; silently pulling 45 days unasked
            # would be a surprising first-launch cost.
            start = target

    if start > target:
        return []
    span = (target - start).days
    if span > MAX_BACKFILL_DAYS:
        start = target - timedelta(days=MAX_BACKFILL_DAYS)

    location_count = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    wanted: list[date] = []
    cursor = start
    while cursor <= target:
        have = conn.execute(
            "SELECT COUNT(*) FROM daily_weather WHERE date = ?", (cursor.isoformat(),)
        ).fetchone()[0]
        if have < location_count:
            wanted.append(cursor)
        cursor += timedelta(days=1)
    return wanted


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


async def run(target: date, backfill_from: date | None, db_path: str) -> int:
    conn = connect(db_path)
    succeeded: list[str] = []
    failed: list[str] = []
    notes: list[str] = []

    try:
        locations = load_locations(conn)
        crops = load_crops(conn)
        coefficients = load_water_coefficients(conn)
        if not locations or not crops:
            raise SystemExit("Reference tables are empty — launch Udaan once so the Rust seeder runs.")

        # Constructed once per run. An unconfigured Earth Engine is a
        # logged note, not a failure — the run is still a success if
        # weather collected, it just carries no fresh NDVI.
        ndvi_service = NdviService()
        if ndvi_service.available:
            succeeded.append("earth-engine")
            notes.append(ndvi_service.status)
        else:
            notes.append(ndvi_service.status)

        normals_notes, normals_failures = await ensure_climate_normals(conn, locations)
        notes.extend(normals_notes)
        failed.extend(f.detail and str(f) for f in normals_failures)
        if normals_notes:
            succeeded.append(f"{SOURCE_NASA_POWER}(normals)")

        pending = dates_to_collect(conn, target, backfill_from)
        if not pending:
            notes.append("nothing to collect — all days already present")
            write_collection_log(conn, target, succeeded, [f for f in failed if f], notes)
            print(f"[agritrack] up to date through {target}")
            return 0

        if len(pending) > 1:
            notes.append(f"backfilled {len(pending)} missing days ({pending[0]} .. {pending[-1]})")

        # gdd_accumulated for a given day is a running total over every
        # prior day's weather, so filling a hole invalidates the GDD of
        # every day already stored *after* that hole — those rows were
        # computed when the earlier days simply weren't there yet. Widen
        # the telemetry pass to cover them; the weather fetch stays
        # limited to `pending`, since that data is already correct.
        recompute_from = pending[0]
        stale = conn.execute(
            "SELECT DISTINCT date FROM daily_crop_telemetry WHERE date > ? ORDER BY date",
            (recompute_from.isoformat(),),
        ).fetchall()
        stale_days = [date.fromisoformat(str(r[0])) for r in stale]
        telemetry_days = sorted(set(pending) | set(stale_days))
        if stale_days:
            notes.append(f"recomputed GDD for {len(stale_days)} later day(s) invalidated by backfill")

        # One request per source spanning the whole pending window, rather
        # than one request per day — both APIs accept a date range, so a
        # 10-day backfill costs the same 18 calls as a single day.
        window_start, window_end = pending[0], pending[-1]
        by_location, failures = await gather_province_weather(locations, window_start, window_end)
        for failure in failures:
            failed.append(str(failure))

        # Credit a source only if it actually answered for at least one
        # province — a blanket "both succeeded" would misreport a total
        # outage of one upstream as a healthy run, since the other
        # source alone is still enough to write a (degraded) row.
        failed_sources = {f.source for f in failures}
        for source in (SOURCE_OPEN_METEO, SOURCE_NASA_POWER):
            answered_everywhere = source not in failed_sources
            partial = sum(1 for f in failures if f.source == source) < len(locations)
            if by_location and (answered_everywhere or partial):
                succeeded.append(source)

        weather_rows = 0
        telemetry_rows = 0

        for day in pending:
            for loc in locations:
                frame = by_location.get(loc.location_id)
                if frame is None or day not in frame.index:
                    continue
                row = frame.loc[day]
                write_daily_weather(conn, loc, day, row)
                weather_rows += 1

            conn.commit()

            # Deficit needs the day's own rainfall already persisted, so
            # it runs as a second pass over the same day rather than
            # inline with the insert above.
            for loc in locations:
                deficit = rainfall_deficit_30d(conn, loc.location_id, day)
                if deficit is not None:
                    conn.execute(
                        "UPDATE daily_weather SET rainfall_deficit_30d = ? WHERE location_id = ? AND date = ?",
                        (deficit, loc.location_id, day.isoformat()),
                    )

            conn.commit()

        # Telemetry runs after every weather row for the window is
        # committed, so accumulated_gdd() sees a complete history rather
        # than whatever happened to be inserted before it in the loop.
        for day in telemetry_days:
            stored = {
                row["location_id"]: row
                for row in conn.execute(
                    """SELECT location_id, rainfall_mm, temp_min_c, temp_max_c, evapotranspiration_mm
                       FROM daily_weather WHERE date = ?""",
                    (day.isoformat(),),
                ).fetchall()
            }
            for crop in crops:
                weather = stored.get(crop.location_id)
                if weather is None:
                    continue
                write_crop_telemetry(
                    conn, crop, day, weather, coefficients.get(crop.crop_name), ndvi_service
                )
                telemetry_rows += 1
            conn.commit()


        # Economic indicators: one fetch covering the whole window
        # rather than per day. Sources differ per field and per date
        # (see economic.py), so provenance is recorded per row.
        econ_rows, econ_failures = collect_economic(pending)
        for failure in econ_failures:
            failed.append(str(failure))
        econ_written = 0
        for day, econ in econ_rows.items():
            if not econ.is_empty():
                write_economic(conn, day, econ)
                econ_written += 1
        conn.commit()
        if econ_written:
            succeeded.append("economic")
            notes.append(f"wrote {econ_written} daily_economic rows")
        else:
            notes.append("no daily_economic rows (weekend/holiday span, or all sources failed)")

        notes.append(f"wrote {weather_rows} daily_weather + {telemetry_rows} daily_crop_telemetry rows")
        write_collection_log(conn, target, succeeded, [f for f in failed if f], notes)
        print(f"[agritrack] {target}: {weather_rows} weather rows, {telemetry_rows} telemetry rows")
        if failed:
            print(f"[agritrack] {len(failed)} source failure(s): {failed[0]}")
        return 0
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="AgriTrack daily data collector")
    parser.add_argument("--date", help="Target date (YYYY-MM-DD). Defaults to today minus the upstream publication lag.")
    parser.add_argument("--backfill-from", help="Collect every day from this date through the target date.")
    parser.add_argument("--db", help="Override the SQLite path (defaults to Udaan's app data dir).")
    args = parser.parse_args()

    target = date.fromisoformat(args.date) if args.date else date.today() - timedelta(days=COLLECTION_LAG_DAYS)
    backfill_from = date.fromisoformat(args.backfill_from) if args.backfill_from else None
    db_path = args.db or resolve_db_path()

    return asyncio.run(run(target, backfill_from, db_path))


if __name__ == "__main__":
    raise SystemExit(main())
