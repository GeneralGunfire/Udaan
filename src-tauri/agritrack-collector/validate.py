"""Data-quality checks for the AgriTrack database.

Run on demand. Reads only — it never repairs anything, because a silent
auto-fix would hide the very problem it found.

    python validate.py                 # everything
    python validate.py --since 2026-08-01
    python validate.py --only gdd,gaps
    python validate.py --quiet         # exit code only, for scripting

Exit codes: 0 clean or info-only, 1 warnings, 2 errors. That makes it
usable as a scheduled canary alongside the collector, not just something
run by hand.

The checks encode what we already know about the pipeline: which
calculations must be monotonic, what South African weather can and
cannot do, and which fields are legitimately NULL versus quietly broken.
A check that fires on normal data is worse than no check, so each one
below is deliberately bounded by real agronomic or physical limits
rather than by tidiness.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from collector import COLLECTION_LAG_DAYS, connect, resolve_db_path
from ndvi import MAX_CARRY_FORWARD_DAYS

# --- Plausibility bounds -------------------------------------------------
# South African extremes, with headroom. The record low is about -20 C
# (Buffelsfontein) and the record high about 50 C (Vioolsdrif); anything
# outside these is a data error, not weather.
TEMP_MIN_C = -25.0
TEMP_MAX_C = 55.0
#: Highest recorded SA 24-hour rainfall is roughly 600 mm.
MAX_DAILY_RAINFALL_MM = 800.0
#: FAO reference ET rarely exceeds ~15 mm/day even in the Northern Cape.
MAX_ET_MM = 20.0
#: Clear-sky insolation at this latitude tops out near 35 MJ/m2/day.
MAX_SOLAR_MJ = 40.0
#: GWETROOT is a 0-1 fraction by definition.
SOIL_MOISTURE_RANGE = (0.0, 1.0)
#: NDVI is bounded by its own arithmetic.
NDVI_RANGE = (-1.0, 1.0)
#: Beyond this, a "current" collection has silently stopped running.
STALE_COLLECTION_DAYS = 3


@dataclass
class Finding:
    level: str  # "error" | "warn" | "info"
    check: str
    message: str
    detail: list[str] = field(default_factory=list)


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)

    def add(self, level: str, check: str, message: str, detail: list[str] | None = None) -> None:
        self.findings.append(Finding(level, check, message, detail or []))

    def worst(self) -> int:
        if any(f.level == "error" for f in self.findings):
            return 2
        if any(f.level == "warn" for f in self.findings):
            return 1
        return 0


def _rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return conn.execute(sql, params).fetchall()


def _since_clause(since: str | None, column: str) -> tuple[str, tuple]:
    return (f" AND {column} >= ?", (since,)) if since else ("", ())


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------


def check_weather_ranges(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """Physically impossible weather values."""
    clause, params = _since_clause(since, "w.date")

    bad = _rows(
        conn,
        f"""SELECT w.date, l.province, w.temp_min_c, w.temp_max_c, w.rainfall_mm,
                   w.humidity_pct, w.evapotranspiration_mm, w.solar_radiation,
                   w.soil_moisture_est
            FROM daily_weather w JOIN locations l USING(location_id)
            WHERE (w.rainfall_mm < 0 OR w.rainfall_mm > ?)
               OR (w.temp_min_c < ? OR w.temp_min_c > ?)
               OR (w.temp_max_c < ? OR w.temp_max_c > ?)
               OR (w.humidity_pct < 0 OR w.humidity_pct > 100)
               OR (w.evapotranspiration_mm < 0 OR w.evapotranspiration_mm > ?)
               OR (w.solar_radiation < 0 OR w.solar_radiation > ?)
               OR (w.soil_moisture_est < ? OR w.soil_moisture_est > ?)
               {clause}
            ORDER BY w.date DESC LIMIT 50""",
        (
            MAX_DAILY_RAINFALL_MM,
            TEMP_MIN_C, TEMP_MAX_C,
            TEMP_MIN_C, TEMP_MAX_C,
            MAX_ET_MM, MAX_SOLAR_MJ,
            *SOIL_MOISTURE_RANGE,
            *params,
        ),
    )
    if bad:
        report.add(
            "error",
            "weather-range",
            f"{len(bad)} daily_weather row(s) hold physically impossible values",
            [f"{r['date']} {r['province']}: "
             f"rain={r['rainfall_mm']} tmin={r['temp_min_c']} tmax={r['temp_max_c']} "
             f"rh={r['humidity_pct']} et={r['evapotranspiration_mm']} "
             f"solar={r['solar_radiation']} sm={r['soil_moisture_est']}"
             for r in bad[:10]],
        )

    # tmin above tmax is a column-swap signature, not an extreme reading.
    inverted = _rows(
        conn,
        f"""SELECT w.date, l.province, w.temp_min_c, w.temp_max_c
            FROM daily_weather w JOIN locations l USING(location_id)
            WHERE w.temp_min_c IS NOT NULL AND w.temp_max_c IS NOT NULL
              AND w.temp_min_c > w.temp_max_c {clause}
            ORDER BY w.date DESC LIMIT 50""",
        params,
    )
    if inverted:
        report.add(
            "error",
            "temp-inverted",
            f"{len(inverted)} row(s) have temp_min_c above temp_max_c — likely swapped columns",
            [f"{r['date']} {r['province']}: min={r['temp_min_c']} max={r['temp_max_c']}"
             for r in inverted[:10]],
        )


def check_gdd_monotonic(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """GDD is a running total since planting, so it can never fall.

    This is the check that caught a real bug once already: filling a
    backfill gap invalidates the GDD of every later day, because those
    were computed when the earlier days were missing.
    """
    clause, params = _since_clause(since, "t.date")
    rows = _rows(
        conn,
        f"""SELECT t.crop_id, c.crop_name, l.province, t.date, t.gdd_accumulated
            FROM daily_crop_telemetry t
            JOIN crops c USING(crop_id)
            JOIN locations l ON l.location_id = c.location_id
            WHERE t.gdd_accumulated IS NOT NULL {clause}
            ORDER BY t.crop_id, t.date""",
        params,
    )

    regressions: list[str] = []
    previous: dict[int, tuple[str, float]] = {}
    for r in rows:
        crop_id = r["crop_id"]
        value = float(r["gdd_accumulated"])
        prior = previous.get(crop_id)
        if prior is not None and value < prior[1] - 1e-6:
            regressions.append(
                f"{r['crop_name']} ({r['province']}): "
                f"{prior[0]} = {prior[1]:.2f} -> {r['date']} = {value:.2f}"
            )
        previous[crop_id] = (r["date"], value)

    if regressions:
        report.add(
            "error",
            "gdd-monotonic",
            f"{len(regressions)} case(s) where gdd_accumulated decreased day-over-day",
            regressions[:10],
        )


def check_gdd_plausible(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """A single day's GDD gain has a physical ceiling.

    With a mean temperature capped near 40 C and base temps of 0-15 C,
    one day can contribute at most ~40 degree-days. A larger jump means
    a gap was filled from the wrong history, not a hot afternoon.
    """
    clause, params = _since_clause(since, "t.date")
    rows = _rows(
        conn,
        f"""SELECT t.crop_id, c.crop_name, t.date, t.gdd_accumulated
            FROM daily_crop_telemetry t JOIN crops c USING(crop_id)
            WHERE t.gdd_accumulated IS NOT NULL {clause}
            ORDER BY t.crop_id, t.date""",
        params,
    )

    jumps: list[str] = []
    previous: dict[int, tuple[date, float, str]] = {}
    for r in rows:
        try:
            current = date.fromisoformat(str(r["date"]))
        except ValueError:
            continue
        value = float(r["gdd_accumulated"])
        prior = previous.get(r["crop_id"])
        if prior is not None:
            span = (current - prior[0]).days
            if 0 < span <= 2 and value - prior[1] > 45.0 * span:
                jumps.append(
                    f"{r['crop_name']}: {prior[2]} = {prior[1]:.1f} -> "
                    f"{r['date']} = {value:.1f} (+{value - prior[1]:.1f} in {span}d)"
                )
        previous[r["crop_id"]] = (current, value, str(r["date"]))

    if jumps:
        report.add(
            "warn",
            "gdd-jump",
            f"{len(jumps)} implausibly large single-day GDD increase(s)",
            jumps[:10],
        )


def check_collection_gaps(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """Dates missing from daily_weather, and whether collection has stalled."""
    row = conn.execute("SELECT MIN(date), MAX(date) FROM daily_weather").fetchone()
    if not row or row[0] is None:
        report.add("warn", "coverage", "daily_weather is empty — the collector has never written")
        return

    first = date.fromisoformat(str(since or row[0]))
    last = date.fromisoformat(str(row[1]))
    location_count = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]

    present = {
        str(r["date"]): r["n"]
        for r in _rows(
            conn,
            "SELECT date, COUNT(*) AS n FROM daily_weather WHERE date >= ? GROUP BY date",
            (first.isoformat(),),
        )
    }

    missing: list[str] = []
    partial: list[str] = []
    cursor = first
    while cursor <= last:
        key = cursor.isoformat()
        count = present.get(key, 0)
        if count == 0:
            missing.append(key)
        elif count < location_count:
            partial.append(f"{key} ({count}/{location_count} provinces)")
        cursor += timedelta(days=1)

    if missing:
        report.add(
            "warn",
            "gaps",
            f"{len(missing)} date(s) between {first} and {last} have no weather rows",
            missing[:14],
        )
    if partial:
        report.add(
            "warn",
            "partial-days",
            f"{len(partial)} date(s) cover only some provinces",
            partial[:10],
        )

    # Is collection still running? The upstream lag means "today" is
    # never expected; anything beyond that plus a grace window is a
    # scheduled task that has quietly stopped.
    expected = date.today() - timedelta(days=COLLECTION_LAG_DAYS)
    behind = (expected - last).days
    if behind > STALE_COLLECTION_DAYS:
        report.add(
            "error",
            "stale",
            f"Newest weather row is {last}, but {expected} was collectable "
            f"({behind} days behind) — is the scheduled task still running?",
        )


def check_collection_log(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """Runs that recorded failures, and runs that never happened."""
    clause, params = _since_clause(since, "run_date")

    failed = _rows(
        conn,
        f"""SELECT run_date, run_timestamp, sources_failed FROM collection_log
            WHERE sources_failed IS NOT NULL AND sources_failed != '' {clause}
            ORDER BY id DESC LIMIT 20""",
        params,
    )
    if failed:
        report.add(
            "warn",
            "run-failures",
            f"{len(failed)} collector run(s) recorded a source failure",
            [f"{r['run_date']}: {str(r['sources_failed'])[:110]}" for r in failed[:8]],
        )

    total = conn.execute("SELECT COUNT(*) FROM collection_log").fetchone()[0]
    if total == 0:
        report.add("warn", "no-runs", "collection_log is empty — no run has ever been recorded")


def check_economic(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """Economic rows that are present but implausible, or a source gone quiet."""
    clause, params = _since_clause(since, "date")

    bad = _rows(
        conn,
        f"""SELECT date, zar_usd_rate, inflation_rate, maize_price_safex
            FROM daily_economic
            WHERE (zar_usd_rate IS NOT NULL AND (zar_usd_rate < 5 OR zar_usd_rate > 40))
               OR (maize_price_safex IS NOT NULL AND (maize_price_safex < 500 OR maize_price_safex > 15000))
               OR (inflation_rate IS NOT NULL AND (inflation_rate < -5 OR inflation_rate > 60))
               {clause}
            ORDER BY date DESC LIMIT 20""",
        params,
    )
    if bad:
        report.add(
            "error",
            "economic-range",
            f"{len(bad)} daily_economic row(s) hold implausible values",
            [f"{r['date']}: usd={r['zar_usd_rate']} cpi={r['inflation_rate']} "
             f"maize={r['maize_price_safex']}" for r in bad[:10]],
        )

    # A scraped source failing is expected eventually; the point is to
    # notice when it does rather than to treat NULL as normal forever.
    recent = _rows(
        conn,
        """SELECT date, zar_usd_rate, maize_price_safex FROM daily_economic
           ORDER BY date DESC LIMIT 10""",
    )
    if recent:
        if all(r["maize_price_safex"] is None for r in recent):
            report.add(
                "warn",
                "maize-missing",
                "No maize price in the last 10 economic rows — the SAFEX scrape may have broken "
                "(see ECONOMIC_SOURCES.md §5)",
            )
        if all(r["zar_usd_rate"] is None for r in recent):
            report.add(
                "warn",
                "fx-missing",
                "No ZAR/USD rate in the last 10 economic rows — both SARB and Frankfurter failing?",
            )


def check_ndvi(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """NDVI range, staleness, and whether it is live at all.

    Silent until Earth Engine is configured — reporting "no NDVI" every
    run before credentials exist would be noise, and a check that cries
    wolf gets ignored when it matters.
    """
    populated = conn.execute(
        "SELECT COUNT(*) FROM daily_crop_telemetry WHERE ndvi_value IS NOT NULL"
    ).fetchone()[0]
    if populated == 0:
        report.add(
            "info",
            "ndvi-absent",
            "No NDVI values yet — expected until Earth Engine credentials are configured "
            "(see EARTH_ENGINE_SETUP.md)",
        )
        return

    clause, params = _since_clause(since, "t.date")

    out_of_range = _rows(
        conn,
        f"""SELECT t.date, c.crop_name, t.ndvi_value FROM daily_crop_telemetry t
            JOIN crops c USING(crop_id)
            WHERE t.ndvi_value IS NOT NULL
              AND (t.ndvi_value < ? OR t.ndvi_value > ?) {clause}
            ORDER BY t.date DESC LIMIT 20""",
        (*NDVI_RANGE, *params),
    )
    if out_of_range:
        report.add(
            "error",
            "ndvi-range",
            f"{len(out_of_range)} NDVI value(s) outside the valid -1..1 range",
            [f"{r['date']} {r['crop_name']}: {r['ndvi_value']}" for r in out_of_range[:10]],
        )

    stale = _rows(
        conn,
        f"""SELECT t.date, c.crop_name, l.province, t.ndvi_age_days
            FROM daily_crop_telemetry t
            JOIN crops c USING(crop_id)
            JOIN locations l ON l.location_id = c.location_id
            WHERE t.ndvi_age_days IS NOT NULL AND t.ndvi_age_days > ? {clause}
            ORDER BY t.date DESC LIMIT 30""",
        (MAX_CARRY_FORWARD_DAYS, *params),
    )
    if stale:
        report.add(
            "warn",
            "ndvi-stale",
            f"{len(stale)} row(s) carry NDVI older than the {MAX_CARRY_FORWARD_DAYS}-day "
            "carry-forward ceiling — persistent cloud, or the rotation is not reaching these crops",
            [f"{r['date']} {r['crop_name']} ({r['province']}): {r['ndvi_age_days']}d old"
             for r in stale[:10]],
        )

    # A value with no age is unfalsifiable: you cannot tell today's
    # reading from a month-old one.
    orphaned = conn.execute(
        "SELECT COUNT(*) FROM daily_crop_telemetry WHERE ndvi_value IS NOT NULL AND ndvi_age_days IS NULL"
    ).fetchone()[0]
    if orphaned:
        report.add(
            "error",
            "ndvi-ageless",
            f"{orphaned} NDVI value(s) stored without ndvi_age_days — cannot tell fresh from stale",
        )


def check_referential(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """Orphaned rows and missing reference data."""
    orphan_weather = conn.execute(
        """SELECT COUNT(*) FROM daily_weather w
           WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.location_id = w.location_id)"""
    ).fetchone()[0]
    if orphan_weather:
        report.add("error", "orphan-weather",
                   f"{orphan_weather} daily_weather row(s) reference a missing location")

    orphan_telemetry = conn.execute(
        """SELECT COUNT(*) FROM daily_crop_telemetry t
           WHERE NOT EXISTS (SELECT 1 FROM crops c WHERE c.crop_id = t.crop_id)"""
    ).fetchone()[0]
    if orphan_telemetry:
        report.add("error", "orphan-telemetry",
                   f"{orphan_telemetry} daily_crop_telemetry row(s) reference a missing crop")

    missing_kc = _rows(
        conn,
        """SELECT DISTINCT c.crop_name FROM crops c
           WHERE NOT EXISTS (
             SELECT 1 FROM crop_water_coefficients k WHERE k.crop_name = c.crop_name)""",
    )
    if missing_kc:
        report.add(
            "warn",
            "missing-kc",
            f"{len(missing_kc)} crop(s) have no FAO water coefficients — water_stress_gap "
            "falls back to Kc=1.0 for these",
            [r["crop_name"] for r in missing_kc],
        )

    no_normals = _rows(
        conn,
        """SELECT l.province FROM locations l
           WHERE NOT EXISTS (
             SELECT 1 FROM historical_climate_normals n WHERE n.location_id = l.location_id)""",
    )
    if no_normals:
        report.add(
            "warn",
            "missing-normals",
            f"{len(no_normals)} province(s) have no climate normals — rainfall_deficit_30d "
            "stays NULL for these",
            [r["province"] for r in no_normals],
        )


def check_duplicates(conn: sqlite3.Connection, report: Report, since: str | None) -> None:
    """The unique constraints should make these impossible; verify anyway."""
    for table, keys in (
        ("daily_weather", "location_id, date"),
        ("daily_crop_telemetry", "crop_id, date"),
        ("daily_economic", "date"),
    ):
        count = conn.execute(
            f"SELECT COUNT(*) FROM (SELECT {keys} FROM {table} GROUP BY {keys} HAVING COUNT(*) > 1)"
        ).fetchone()[0]
        if count:
            report.add("error", "duplicates",
                       f"{count} duplicated key(s) in {table} ({keys})")


CHECKS = {
    "weather": check_weather_ranges,
    "gdd": check_gdd_monotonic,
    "gddjump": check_gdd_plausible,
    "gaps": check_collection_gaps,
    "log": check_collection_log,
    "economic": check_economic,
    "ndvi": check_ndvi,
    "refs": check_referential,
    "dupes": check_duplicates,
}


def summarise(conn: sqlite3.Connection) -> list[str]:
    lines = []
    for table in ("locations", "crops", "daily_weather", "daily_crop_telemetry",
                  "daily_economic", "disease_bulletins", "collection_log",
                  "historical_climate_normals"):
        try:
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            lines.append(f"  {table:28} {count:>7}")
        except sqlite3.Error:
            lines.append(f"  {table:28} {'missing':>7}")
    span = conn.execute("SELECT MIN(date), MAX(date) FROM daily_weather").fetchone()
    if span and span[0]:
        lines.append(f"  {'weather date range':28} {span[0]} .. {span[1]}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description="AgriTrack data-quality checks")
    parser.add_argument("--since", help="Only inspect rows on or after this date (YYYY-MM-DD)")
    parser.add_argument("--only", help=f"Comma-separated subset of: {', '.join(CHECKS)}")
    parser.add_argument("--quiet", action="store_true", help="Print nothing; use the exit code")
    parser.add_argument("--db", help="Override the SQLite path")
    args = parser.parse_args()

    if args.since:
        try:
            date.fromisoformat(args.since)
        except ValueError:
            raise SystemExit("--since must be YYYY-MM-DD") from None

    selected = list(CHECKS)
    if args.only:
        selected = [name.strip() for name in args.only.split(",") if name.strip()]
        unknown = [name for name in selected if name not in CHECKS]
        if unknown:
            raise SystemExit(f"Unknown check(s): {', '.join(unknown)}. Valid: {', '.join(CHECKS)}")

    conn = connect(args.db or resolve_db_path())
    report = Report()
    try:
        for name in selected:
            try:
                CHECKS[name](conn, report, args.since)
            except sqlite3.Error as exc:
                report.add("error", name, f"check failed to run: {exc}")

        if args.quiet:
            return report.worst()

        print(f"AgriTrack validation — {datetime.now().isoformat(timespec='seconds')}")
        if args.since:
            print(f"Scope: rows since {args.since}")
        print("\nTable counts:")
        for line in summarise(conn):
            print(line)

        errors = [f for f in report.findings if f.level == "error"]
        warnings = [f for f in report.findings if f.level == "warn"]
        infos = [f for f in report.findings if f.level == "info"]

        print()
        if not report.findings:
            print("No issues found.")
        for finding in errors + warnings + infos:
            marker = {"error": "ERROR", "warn": "WARN ", "info": "info "}[finding.level]
            print(f"{marker} [{finding.check}] {finding.message}")
            for line in finding.detail:
                print(f"        {line}")

        print(
            f"\n{len(errors)} error(s), {len(warnings)} warning(s), {len(infos)} note(s)."
        )
        return report.worst()
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
