# `daily_economic` source investigation

Written 2026-09-06. Nothing here is wired in yet — this is the evidence
and a recommendation, per the standing rule that this table gets real
sources or explicit NULLs, never a guess.

Every endpoint below was called live during the investigation; the
responses quoted are real, not from documentation.

**Short version:** two of the three fields have a genuinely free,
keyless, official source and should be wired in. The third (SAFEX maize)
does not, and should stay NULL.

| Field | Verdict | Source |
| --- | --- | --- |
| `zar_usd_rate` | ✅ Wire it | SARB API (official) + Frankfurter (backfill) |
| `inflation_rate` | ✅ Wire it | SARB API (official, carries Stats SA's CPI) |
| `maize_price_safex` | ❌ Leave NULL | No free API exists; see below |

---

## 1. SARB — the significant find

The South African Reserve Bank **does** run a public JSON API, separate
from the statistical releases on their main site. It is undocumented in
the sense that the `/Help` pages now 404, but the data endpoints are
live, keyless, and return clean JSON.

Base: `https://custom.resbank.co.za/SarbWebApi/WebIndicators/`

Endpoints confirmed working (HTTP 200, `application/json`):

| Endpoint | Items | Contains |
| --- | --- | --- |
| `HomePageRates` | 13 | **CPI, PPI, ZAR/USD**, policy & prime rate, NEER |
| `CurrentMarketRates` | 24 | Money-market rates, bond yields, FX |
| `HistoricalExchangeRatesDaily` | 34 | FX, but only the latest 2 dates |
| `HistoricalExchangeRatesMonthly` | 3 | Monthly FX |
| `CPDRates` | 2 | Corporation for Public Deposits rates |

`HomePageRates` alone covers both fields we need. Live response
(2026-09-06):

```
Inflation rates   CPI                          4.3       2026-07-31
Inflation rates   PPI                          5.7115    2026-07-31
Exchange rates    Rand per US Dollar          15.9713    2026-09-04
Exchange rates    Rand per British Pound      21.6163    2026-09-04
Exchange rates    Rand per Euro               18.5618    2026-09-04
Interest rates    SARB Policy Rate             7.0       2026-09-04
Interest rates    Prime lending rate          10.5       2026-09-04
```

Each row is shaped:

```json
{
  "Name": "Rand per US Dollar",
  "SectionId": "HERRER",
  "SectionName": "Exchange rates",
  "TimeseriesCode": "EXCX135D",
  "Date": "2026-09-04",
  "Value": 15.9713,
  "UpDown": -1,
  "FormatNumber": "0.0000",
  "FormatDate": "yyyy-MM-dd"
}
```

- **Key required:** No. No signup, no token, no rate-limit headers seen.
- **Cost:** Free. It is the central bank publishing its own figures.
- **Authority:** As official as it gets. The CPI value here *is* Stats
  SA's published CPI — SARB republishes it, which conveniently solves
  the Stats SA problem below.

### The one real limitation

**There is no historical range query.** Despite the name,
`HistoricalExchangeRatesDaily` returned only 2 distinct dates
(2026-09-03, 2026-09-04) and exactly one USD row. I probed six plausible
timeseries route shapes using the `TimeseriesCode` (`EXCX135D`) — e.g.
`TimeseriesData/{code}`, `.../{code}/{from}/{to}`,
`EconFinDataForSA/GetTimeseriesObservations/...` — and all six returned
404.

So SARB gives us *today's* values only. For a collector that runs daily
that is fine going forward, but it cannot backfill a missed week, which
is a capability the weather path already has and we shouldn't quietly
lose here.

## 2. Frankfurter — for the backfill gap

`https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=ZAR`

Live response for a real range:

```json
{
  "amount": 1.0, "base": "USD",
  "start_date": "2026-08-20", "end_date": "2026-08-28",
  "rates": {
    "2026-08-20": {"ZAR": 16.174},
    "2026-08-21": {"ZAR": 16.0044},
    "2026-08-24": {"ZAR": 16.0029},
    "2026-08-25": {"ZAR": 15.9878},
    "2026-08-26": {"ZAR": 15.916},
    "2026-08-27": {"ZAR": 15.9858},
    "2026-08-28": {"ZAR": 16.0018}
  }
}
```

- **Key required:** No. No signup.
- **Cost:** Free, open source, no stated request cap.
- **Data origin:** European Central Bank reference rates.
- **Range queries:** Yes — the whole point. Weekends are simply absent,
  matching the weather path's own gap handling.

Note the values differ slightly from SARB's (16.0018 vs SARB's own
figure): ECB reference rates and SARB's weighted interbank mid rate are
genuinely different measurements, not an error. Whichever is used should
be recorded in `data_source` so the two are never silently mixed in
analysis.

## 3. Stats SA — no API

Stats SA publishes CPI as **PDF statistical releases** (P0141) plus
downloadable time-series files. There is no REST API. I found no
official endpoint, and the third-party "Stats SA APIs" that surface in
search are Apify scrapers, not official.

**This does not matter**, because SARB's `HomePageRates` already carries
the headline CPI figure (4.3% for July 2026), sourced from Stats SA and
served as JSON. We get the official number without touching a PDF.

## 4. exchangerate-api.com — checked as requested

- **Open Access tier** (`https://open.er-api.com/v6/latest/USD`):
  keyless, works — returned `ZAR = 15.963832` live.
- **Key required:** Not for open access; the documented free tier with
  1,500 requests/month does require signup.
- **Update frequency:** Once daily.
- **Historical data:** **Not on the free tier.** Current rates only.
- **Attribution:** Required — must display "Rates By Exchange Rate API"
  linked to their site.
- **Terms:** No commercial redistribution.

**Not recommended.** It is strictly worse than Frankfurter here: no
history, an attribution obligation we'd have to honour in the UI, and no
authority advantage over the central bank's own number.

## 5. SAFEX / maize — no free source

This is the field that fails the test.

What exists:

- **JSE/SAFEX official** — grain futures pricing is licensed commercial
  market data.
- **Barchart** — carries SAFEX white maize (`HW*0`) and offers an API,
  but the API is a commercial product; the free web view is 10–15 min
  delayed and is a webpage, not a feed.
- **Applied Derivatives** (`derivative.co.za/safex-prices.html`) — a JSE
  member brokerage publishing daily settlement prices free to the
  public. The page is live and genuinely carries the data; fetched
  2026-09-06 it read:

  > Latest settlement — Fri 4 Sep 2026 · Sep 26 contract. white maize at
  > R 4 002/t (+80); yellow maize at R 4 019/t (+76); wheat at
  > R 6 075/t (−45); sunflower at R 10 124/t (−176); soya at
  > R 8 540/t (−242).

  But this is **an HTML page, not an API**. Consuming it means scraping.
- **SAGIS** — the official grain information service, free, but publishes
  weekly/monthly *bulletins* (deliveries, stocks, import parity) rather
  than a daily settlement price feed, and offers no API.

### Recommendation: leave `maize_price_safex` NULL

Not because nothing is reachable, but because the only daily source is a
brokerage's marketing page. Scraping it would mean a fragile parser
against markup that can change without notice, silently producing either
stale or wrong prices in a table we've committed to keeping honest — and
it sits uncomfortably close to the project's own "no scraping" rule.

If you later decide you want it, the least-bad option is a **manual
weekly entry**, the same posture we took for `disease_bulletins`. Say the
word and I'll extend the bulletin entry tool to cover it.

---

## Recommended implementation

Wire two fields, leave one NULL, and always record which source a row
came from.

1. **Daily path** — call SARB `HomePageRates` once per run. Take
   `Rand per US Dollar` → `zar_usd_rate` and `CPI` → `inflation_rate`.
   Write `data_source = "sarb"`.
2. **Backfill path** — when the collector is filling a date SARB can no
   longer serve, call Frankfurter for the range and write
   `data_source = "frankfurter"`. Leave `inflation_rate` NULL for those
   days rather than carrying a stale monthly figure across dates it
   doesn't belong to — CPI is monthly, so it should only be written
   against the month SARB reports it for.
3. **`maize_price_safex`** — stays NULL, with the reason recorded in
   `collection_log` notes exactly as it is now.
4. **CSP** — `custom.resbank.co.za` and `api.frankfurter.dev` are only
   called from the Python collector, not the webview, so no CSP change
   is needed.

One caveat worth stating plainly: SARB's API has no published contract
and its own help pages 404, so it could change without warning. The
collector should treat a failure there the way it already treats a
NASA POWER failure — log it, write NULL, carry on — rather than assuming
it will always answer.

## Sources

- SARB Web API: <https://custom.resbank.co.za/SarbWebApi/WebIndicators/HomePageRates>
- SARB statistics landing: <https://www.resbank.co.za/en/home/what-we-do/statistics>
- Frankfurter: <https://api.frankfurter.dev/v1/2026-08-20..2026-08-28?base=USD&symbols=ZAR>
- ExchangeRate-API free tier terms: <https://www.exchangerate-api.com/docs/free>
- Stats SA CPI releases: <https://www.statssa.gov.za/?cat=33>
- Applied Derivatives SAFEX settlements: <https://derivative.co.za/safex-prices.html>
- Barchart SAFEX white maize: <https://www.barchart.com/futures/quotes/HW*0/futures-prices>
- SAGIS: <https://www.sagis.org.za/>
