"""Sentinel-2 NDVI retrieval via Google Earth Engine.

Kept separate from collector.py because it is the one part of the
pipeline with an external credential dependency. Everything here is
written to fail *closed and quietly*: if Earth Engine credentials are
absent or invalid, `NdviService.available` is False, every lookup
returns a carried-forward value (or None), and the collector logs a
single clear line rather than crashing a run that would otherwise
collect weather perfectly well.

See EARTH_ENGINE_SETUP.md for the one-time credential setup. No code
change is needed once the key file is in place — this module discovers
it at import time on the next run.

Cost model
----------
Earth Engine's free tier is generous but not unlimited, and a
`getRegion`/`reduceRegion` call per crop per day (33 crops x 365 days)
is both wasteful and slow: Sentinel-2 revisits the same point every
~5 days, so most of those calls would return a scene we already have.
Instead crops are split into three groups that rotate day-by-day, so
each crop is genuinely refreshed every third day and the other two days
carry forward the last known value with an honest `ndvi_age_days`.
"""

from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

# Earth Engine's client library is a hard import, but an optional
# dependency in practice — a machine that never sets up credentials
# should still run the collector. Absence is treated the same as
# "not configured".
try:  # pragma: no cover - import-time capability probe
    import ee  # type: ignore

    _EE_IMPORTED = True
    _EE_IMPORT_ERROR = ""
except Exception as exc:  # noqa: BLE001
    ee = None  # type: ignore
    _EE_IMPORTED = False
    _EE_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

#: Environment variable holding the path to a service-account JSON key.
ENV_KEY_PATH = "AGRITRACK_EE_KEY"
#: Environment variable naming the Cloud project, when the key file's own
#: `project_id` is not the Earth-Engine-registered one.
ENV_PROJECT = "AGRITRACK_EE_PROJECT"

#: Fallback key location, checked when ENV_KEY_PATH is unset. Sits beside
#: this script so the setup doc can give one unambiguous "put it here".
DEFAULT_KEY_FILENAME = "earthengine-key.json"

#: Sentinel-2 surface reflectance, the harmonised collection (consistent
#: across the 2022 processing-baseline change).
S2_COLLECTION = "COPERNICUS/S2_SR_HARMONIZED"

#: Radius in metres around a crop's point sampled for NDVI. Chosen to sit
#: comfortably inside a single field at Sentinel-2's 10 m resolution —
#: ~150 m covers roughly 7 hectares, enough pixels to average out noise
#: without straying into a neighbouring land use.
BUFFER_METRES = 150

#: Scenes cloudier than this over the buffer are skipped entirely.
MAX_CLOUD_PCT = 20

#: How far back to look for a usable scene. Sentinel-2's revisit is ~5
#: days, so 30 covers several chances even through a cloudy fortnight.
SCENE_SEARCH_DAYS = 30

#: Crops are partitioned into this many rotation groups; one group is
#: refreshed per day. See module docstring.
ROTATION_GROUPS = 3

#: Beyond this age a carried-forward NDVI is no longer meaningful and is
#: reported as None rather than a stale number.
MAX_CARRY_FORWARD_DAYS = 21


@dataclass(frozen=True)
class NdviReading:
    """One crop-day's NDVI, with the age of the underlying scene.

    `age_days` is the gap between the scene's acquisition date and the
    date being collected — 0 means a scene from that same day, 6 means
    the freshest usable imagery is nearly a week old. It is never None
    when `value` is not None, since an NDVI without its age is
    unfalsifiable.
    """

    value: float | None
    age_days: int | None
    source: str


NO_READING = NdviReading(None, None, "unavailable")


# --------------------------------------------------------------------------
# Service
# --------------------------------------------------------------------------


class NdviService:
    """Earth Engine access, or a clean no-op if it isn't configured.

    Construct once per run. `available` tells the caller whether real
    lookups are possible; `status` is the human-readable reason, which
    the collector writes into `collection_log` so an unconfigured
    machine says so explicitly rather than silently producing nulls.
    """

    def __init__(self, key_path: str | None = None, project: str | None = None):
        self.available = False
        self.status = ""
        self._project = project or os.environ.get(ENV_PROJECT) or None
        self._key_path = key_path or self._discover_key_path()
        self._initialise()

    # -- setup -------------------------------------------------------------

    @staticmethod
    def _discover_key_path() -> str | None:
        """Env var first, then the documented default beside this script."""
        env_path = os.environ.get(ENV_KEY_PATH)
        if env_path:
            return env_path
        beside = os.path.join(os.path.dirname(os.path.abspath(__file__)), DEFAULT_KEY_FILENAME)
        return beside if os.path.exists(beside) else None

    def _initialise(self) -> None:
        if not _EE_IMPORTED:
            self.status = (
                f"Earth Engine credentials not configured: earthengine-api unavailable ({_EE_IMPORT_ERROR}). "
                "Run `pip install -r requirements.txt`."
            )
            return

        if not self._key_path:
            self.status = (
                "Earth Engine credentials not configured: no service-account key found. "
                f"Set {ENV_KEY_PATH} or place {DEFAULT_KEY_FILENAME} beside collector.py — "
                "see EARTH_ENGINE_SETUP.md."
            )
            return

        if not os.path.exists(self._key_path):
            self.status = (
                f"Earth Engine credentials not configured: key file not found at {self._key_path} — "
                "see EARTH_ENGINE_SETUP.md."
            )
            return

        try:
            with open(self._key_path, "r", encoding="utf-8") as handle:
                key_data = json.load(handle)
            service_account = key_data.get("client_email")
            if not service_account:
                self.status = (
                    f"Earth Engine credentials not configured: {self._key_path} has no client_email — "
                    "it may not be a service-account key."
                )
                return
            project = self._project or key_data.get("project_id")

            credentials = ee.ServiceAccountCredentials(service_account, self._key_path)
            ee.Initialize(credentials, project=project)
            self.available = True
            self.status = f"Earth Engine ready (service account {service_account})"
        except Exception as exc:  # noqa: BLE001 - reported, never fatal
            self.status = (
                f"Earth Engine credentials present but initialisation failed: {type(exc).__name__}: {exc}"
            )

    # -- rotation ----------------------------------------------------------

    @staticmethod
    def rotation_group(crop_id: int) -> int:
        return crop_id % ROTATION_GROUPS

    @staticmethod
    def group_for_date(target: date) -> int:
        """Which rotation group is refreshed on a given date.

        Keyed off the ordinal date rather than a counter in the database,
        so a backfill of an arbitrary past day picks the same group it
        would have picked had the run happened on the day itself — the
        rotation stays reproducible rather than depending on run order.
        """
        return target.toordinal() % ROTATION_GROUPS

    def is_due(self, crop_id: int, target: date) -> bool:
        return self.rotation_group(crop_id) == self.group_for_date(target)

    # -- query -------------------------------------------------------------

    def fetch(self, latitude: float, longitude: float, target: date) -> NdviReading:
        """Most recent low-cloud Sentinel-2 NDVI at a point, on or before `target`.

        Returns NO_READING rather than raising: a single crop's failed
        lookup degrades that crop's row to a carried-forward value, and
        must never abort the run.
        """
        if not self.available:
            return NO_READING

        try:
            point = ee.Geometry.Point([longitude, latitude])
            region = point.buffer(BUFFER_METRES)
            start = target - timedelta(days=SCENE_SEARCH_DAYS)

            collection = (
                ee.ImageCollection(S2_COLLECTION)
                .filterBounds(region)
                # end is exclusive, so +1 day to make `target` itself eligible
                .filterDate(start.isoformat(), (target + timedelta(days=1)).isoformat())
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", MAX_CLOUD_PCT))
                .sort("system:time_start", False)
            )

            image = ee.Image(collection.first())
            # An empty collection yields an image with no bands; asking for
            # its NDVI would throw server-side, so branch in EE rather than
            # round-tripping a count first.
            band_count = image.bandNames().size().getInfo()
            if not band_count:
                return NO_READING

            # NDVI = (NIR - Red) / (NIR + Red); Sentinel-2 B8 is NIR, B4 Red.
            ndvi = image.normalizedDifference(["B8", "B4"]).rename("ndvi")
            reduced = ndvi.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=region,
                scale=10,
                maxPixels=1e9,
            )

            payload = ee.Dictionary(
                {
                    "ndvi": reduced.get("ndvi"),
                    "acquired": image.date().format("YYYY-MM-dd"),
                }
            ).getInfo()

            value = payload.get("ndvi")
            acquired_raw = payload.get("acquired")
            if value is None or acquired_raw is None:
                return NO_READING

            acquired = datetime.strptime(acquired_raw, "%Y-%m-%d").date()
            age = (target - acquired).days
            return NdviReading(round(float(value), 4), max(0, age), f"sentinel-2:{acquired.isoformat()}")
        except Exception:  # noqa: BLE001 - one crop's failure, not the run's
            return NO_READING


# --------------------------------------------------------------------------
# Carry-forward
# --------------------------------------------------------------------------


def last_known_ndvi(
    conn: sqlite3.Connection, crop_id: int, target: date
) -> NdviReading:
    """The most recent stored NDVI for a crop, aged forward to `target`.

    Used on the two days out of three when a crop isn't due for a fresh
    scene, and whenever a live lookup fails. The stored `ndvi_age_days`
    is the age at the time *that* row was written, so the age reported
    here is that plus the days elapsed since — otherwise a value would
    appear to stay permanently fresh as it was carried forward.

    Returns NO_READING past MAX_CARRY_FORWARD_DAYS: a month-old NDVI
    says nothing useful about today's canopy, and a null is more honest
    than a stale number the map would render as current.
    """
    row = conn.execute(
        """SELECT date, ndvi_value, ndvi_age_days
           FROM daily_crop_telemetry
           WHERE crop_id = ? AND date <= ? AND ndvi_value IS NOT NULL
           ORDER BY date DESC LIMIT 1""",
        (crop_id, target.isoformat()),
    ).fetchone()

    if row is None or row["ndvi_value"] is None:
        return NO_READING

    try:
        stored_date = date.fromisoformat(str(row["date"]))
    except ValueError:
        return NO_READING

    elapsed = (target - stored_date).days
    base_age = int(row["ndvi_age_days"] or 0)
    age = base_age + elapsed
    if age > MAX_CARRY_FORWARD_DAYS:
        return NO_READING

    return NdviReading(float(row["ndvi_value"]), age, "carried-forward")


def resolve_ndvi(
    service: NdviService,
    conn: sqlite3.Connection,
    crop_id: int,
    latitude: float | None,
    longitude: float | None,
    target: date,
) -> NdviReading:
    """The single entry point the collector calls per crop-day.

    Fresh scene when the crop is due and Earth Engine is configured;
    otherwise the last known value, aged. A due-day lookup that comes
    back empty also falls back to carry-forward rather than punching a
    hole in an otherwise continuous series.
    """
    if service.available and latitude is not None and longitude is not None and service.is_due(crop_id, target):
        reading = service.fetch(latitude, longitude, target)
        if reading.value is not None:
            return reading

    return last_known_ndvi(conn, crop_id, target)
