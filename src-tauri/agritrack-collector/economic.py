"""Economic indicators for `daily_economic`.

Three fields, three different shapes of problem:

* **ZAR/USD** — SARB publishes it as JSON, keyless, but only ever for
  "now". Frankfurter (ECB reference rates) covers any past date, so the
  daily path uses SARB and the backfill path uses Frankfurter.
* **CPI inflation** — monthly, not daily. SARB republishes Stats SA's
  headline figure as JSON. It is written only against dates inside the
  month it actually describes, never carried forward.
* **SAFEX maize** — no API exists at any price we'd pay. The one free
  daily source is a JSE-member brokerage's settlement table, which is
  scraped here: it is a real `<table>`, carries ~23 sessions of history
  (so backfill works), and is parsed strictly enough that a layout
  change fails loudly rather than silently returning a wrong number.

See ECONOMIC_SOURCES.md for the full investigation, including the
sources rejected and why.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import httpx

SARB_HOME_RATES = "https://custom.resbank.co.za/SarbWebApi/WebIndicators/HomePageRates"
FRANKFURTER_RANGE = "https://api.frankfurter.dev/v1/{start}..{end}"
SAFEX_SETTLEMENTS = "https://derivative.co.za/safex-prices.html"

SOURCE_SARB = "sarb"
SOURCE_FRANKFURTER = "frankfurter"
SOURCE_SAFEX = "safex:derivative.co.za"

# A browser UA: derivative.co.za is a normal marketing site and some
# hosts refuse obviously-scripted agents. Nothing here is behind a
# login or a paywall.
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Udaan-AgriTrack/1.0)"}
TIMEOUT = httpx.Timeout(45.0, connect=20.0)

#: Sanity bounds. ZAR/USD has traded roughly 5-25 over the last few
#: decades; white maize has ranged roughly R1000-R8000/t. These exist to
#: catch a parser that has started reading the wrong column, not to
#: second-guess the market.
ZAR_USD_RANGE = (5.0, 40.0)
MAIZE_RANGE = (500.0, 15000.0)
CPI_RANGE = (-5.0, 60.0)

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


@dataclass
class EconomicRow:
    """One day's economic indicators, with per-field provenance.

    `sources` maps each populated field to where it came from, so a row
    assembled from SARB plus a scrape is never mistaken for one that
    came wholly from the central bank.
    """

    zar_usd_rate: float | None = None
    inflation_rate: float | None = None
    maize_price_safex: float | None = None
    sources: dict[str, str] | None = None

    def data_source(self) -> str:
        if not self.sources:
            return "none"
        return ", ".join(f"{k}={v}" for k, v in sorted(self.sources.items()))

    def is_empty(self) -> bool:
        return (
            self.zar_usd_rate is None
            and self.inflation_rate is None
            and self.maize_price_safex is None
        )


class EconomicFailure(Exception):
    """One economic source failed. Recorded, never fatal to a run."""

    def __init__(self, source: str, detail: str):
        super().__init__(f"{source}: {detail}")
        self.source = source
        self.detail = detail


def _in_range(value: float, bounds: tuple[float, float]) -> bool:
    return bounds[0] <= value <= bounds[1]


# --------------------------------------------------------------------------
# SARB
# --------------------------------------------------------------------------


def fetch_sarb(client: httpx.Client) -> tuple[dict[str, Any], date | None, date | None]:
    """Current ZAR/USD and headline CPI from the Reserve Bank.

    Returns (values, fx_date, cpi_date). The two dates differ — FX is
    daily and CPI is monthly — and both matter, because a value is only
    written against the date it actually describes.
    """
    try:
        resp = client.get(SARB_HOME_RATES, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise EconomicFailure(SOURCE_SARB, f"{type(exc).__name__}: {exc}") from exc

    if not isinstance(payload, list):
        raise EconomicFailure(SOURCE_SARB, "expected a JSON array")

    values: dict[str, Any] = {}
    fx_date: date | None = None
    cpi_date: date | None = None

    for row in payload:
        name = str(row.get("Name", ""))
        raw = row.get("Value")
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue

        observed: date | None = None
        try:
            observed = date.fromisoformat(str(row.get("Date", ""))[:10])
        except ValueError:
            observed = None

        if name == "Rand per US Dollar" and _in_range(value, ZAR_USD_RANGE):
            values["zar_usd_rate"] = value
            fx_date = observed
        elif name == "CPI" and _in_range(value, CPI_RANGE):
            values["inflation_rate"] = value
            cpi_date = observed

    if not values:
        raise EconomicFailure(SOURCE_SARB, "response carried neither ZAR/USD nor CPI")
    return values, fx_date, cpi_date


# --------------------------------------------------------------------------
# Frankfurter (historical FX)
# --------------------------------------------------------------------------


def fetch_frankfurter_range(
    client: httpx.Client, start: date, end: date
) -> dict[date, float]:
    """ZAR per USD for every trading day in a range.

    Weekends and holidays are simply absent from the response, the same
    way they're absent from the market.
    """
    url = FRANKFURTER_RANGE.format(start=start.isoformat(), end=end.isoformat())
    try:
        resp = client.get(
            url, params={"base": "USD", "symbols": "ZAR"}, headers=HEADERS, timeout=TIMEOUT
        )
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise EconomicFailure(SOURCE_FRANKFURTER, f"{type(exc).__name__}: {exc}") from exc

    out: dict[date, float] = {}
    for day, rates in (payload.get("rates") or {}).items():
        zar = rates.get("ZAR")
        if zar is None:
            continue
        try:
            value = float(zar)
            observed = date.fromisoformat(day)
        except (TypeError, ValueError):
            continue
        if _in_range(value, ZAR_USD_RANGE):
            out[observed] = value
    return out


# --------------------------------------------------------------------------
# SAFEX settlements (scraped)
# --------------------------------------------------------------------------


def _parse_session_date(cell: str) -> date | None:
    """'Fri 4 Sep 2026' -> date(2026, 9, 4)."""
    match = re.search(r"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", cell)
    if not match:
        return None
    day, month_name, year = match.groups()
    month = MONTHS.get(month_name.lower()[:3])
    if not month:
        return None
    try:
        return date(int(year), month, int(day))
    except ValueError:
        return None


def _parse_price(cell: str) -> float | None:
    """'R 4 002▲ +80' -> 4002.0

    Takes only the leading 'R <number>' and deliberately ignores the
    trailing change figure — reading that as the price is exactly the
    failure mode a looser regex would produce.
    """
    text = html.unescape(cell)
    match = re.match(r"\s*R\s*([\d\s,]+)", text)
    if not match:
        return None
    digits = re.sub(r"[\s,]", "", match.group(1))
    if not digits.isdigit():
        return None
    return float(digits)


def fetch_safex_maize(client: httpx.Client) -> dict[date, float]:
    """White maize settlement price (rand/tonne) per session date.

    Scrapes the settlement table at derivative.co.za, which publishes
    roughly a month of sessions — enough that a backfill of missed days
    finds real prices rather than gaps.

    Strict by design: the white-maize column is located by its header
    text rather than by a fixed index, and anything that doesn't parse
    cleanly is skipped rather than guessed at. If the page is
    restructured this returns nothing and the caller logs a failure —
    the one outcome worse than no price is a confidently wrong one.
    """
    try:
        resp = client.get(SAFEX_SETTLEMENTS, headers=HEADERS, timeout=TIMEOUT)
        resp.raise_for_status()
        markup = resp.text
    except Exception as exc:  # noqa: BLE001
        raise EconomicFailure(SOURCE_SAFEX, f"{type(exc).__name__}: {exc}") from exc

    table_match = re.search(r"<table.*?</table>", markup, flags=re.S | re.I)
    if not table_match:
        raise EconomicFailure(SOURCE_SAFEX, "settlement table not found — page layout changed")

    rows = re.findall(r"<tr.*?</tr>", table_match.group(0), flags=re.S | re.I)

    def cells(row: str) -> list[str]:
        return [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", cell)).strip()
            for cell in re.findall(r"<t[dh].*?</t[dh]>", row, flags=re.S | re.I)
        ]

    # Locate the white-maize column by header rather than position, so a
    # reordered or newly-inserted contract column doesn't silently shift
    # us onto yellow maize.
    maize_col: int | None = None
    for row in rows:
        header = [c.lower() for c in cells(row)]
        if any("white maize" in c for c in header):
            maize_col = next(i for i, c in enumerate(header) if "white maize" in c)
            break

    if maize_col is None:
        raise EconomicFailure(SOURCE_SAFEX, "no 'White maize' column header — page layout changed")

    prices: dict[date, float] = {}
    for row in rows:
        row_cells = cells(row)
        if len(row_cells) <= maize_col:
            continue
        session = _parse_session_date(row_cells[0])
        if session is None:
            continue
        price = _parse_price(row_cells[maize_col])
        if price is not None and _in_range(price, MAIZE_RANGE):
            prices[session] = price

    if not prices:
        raise EconomicFailure(SOURCE_SAFEX, "table found but no rows parsed — page layout changed")
    return prices


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------


def collect_economic(
    days: list[date], today: date | None = None
) -> tuple[dict[date, EconomicRow], list[EconomicFailure]]:
    """Assemble one EconomicRow per requested day.

    Each source is fetched once for the whole span rather than per day,
    and each failure is collected rather than raised, so one dead source
    costs only its own fields.
    """
    if not days:
        return {}, []

    today = today or date.today()
    rows: dict[date, EconomicRow] = {d: EconomicRow(sources={}) for d in days}
    failures: list[EconomicFailure] = []
    start, end = min(days), max(days)

    with httpx.Client(follow_redirects=True) as client:
        # SARB first: it is the authoritative source for any day it can
        # actually speak to, which is only ever the current one.
        sarb_values: dict[str, Any] = {}
        fx_date = cpi_date = None
        try:
            sarb_values, fx_date, cpi_date = fetch_sarb(client)
        except EconomicFailure as exc:
            failures.append(exc)

        if fx_date and fx_date in rows and "zar_usd_rate" in sarb_values:
            rows[fx_date].zar_usd_rate = sarb_values["zar_usd_rate"]
            rows[fx_date].sources["zar_usd_rate"] = SOURCE_SARB  # type: ignore[index]

        # CPI is a monthly figure. Writing it against every collected
        # date would imply a daily observation that does not exist, so it
        # only lands on days inside the month it describes.
        if cpi_date and "inflation_rate" in sarb_values:
            for day in days:
                if day.year == cpi_date.year and day.month == cpi_date.month:
                    rows[day].inflation_rate = sarb_values["inflation_rate"]
                    rows[day].sources["inflation_rate"] = SOURCE_SARB  # type: ignore[index]

        # Frankfurter fills every FX day SARB could not.
        if any(r.zar_usd_rate is None for r in rows.values()):
            try:
                fx = fetch_frankfurter_range(client, start, end)
                for day, value in fx.items():
                    if day in rows and rows[day].zar_usd_rate is None:
                        rows[day].zar_usd_rate = value
                        rows[day].sources["zar_usd_rate"] = SOURCE_FRANKFURTER  # type: ignore[index]
            except EconomicFailure as exc:
                failures.append(exc)

        try:
            maize = fetch_safex_maize(client)
            for day, price in maize.items():
                if day in rows:
                    rows[day].maize_price_safex = price
                    rows[day].sources["maize_price_safex"] = SOURCE_SAFEX  # type: ignore[index]
        except EconomicFailure as exc:
            failures.append(exc)

    return rows, failures
