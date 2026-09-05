# Earth Engine setup (one-time)

Everything on the NDVI path is already written and wired. This document
is the only thing left: create a service account, download its key, and
drop the file in one place. **No code changes are needed afterwards** —
if you find yourself editing Python to make it work, something is wrong;
flag it.

Until this is done the collector runs normally and writes `NULL` NDVI,
logging `Earth Engine credentials not configured: …` in `collection_log`.

---

## 1. Register for Earth Engine

1. Go to <https://code.earthengine.google.com/register>
2. Sign in with your Google account.
3. Choose **Unpaid usage** → **Non-commercial / research**. (This is the
   free tier. It's ample: the rotation logic makes roughly 11 point
   queries a day.)
4. When asked to pick a Cloud project, choose **Create a new Cloud
   project**. Note the **project ID** it generates (something like
   `ee-yourname`) — you'll want it in step 4.

Approval is usually instant for non-commercial use, but can take up to a
day. You cannot proceed until the project shows as registered.

## 2. Enable the API

1. Go to <https://console.cloud.google.com/apis/library/earthengine.googleapis.com>
2. Make sure the project selector at the top shows the project from
   step 1.
3. Click **Enable**. (If it already says "Manage", it's enabled.)

## 3. Create the service account

1. Go to <https://console.cloud.google.com/iam-admin/serviceaccounts>
2. Confirm the project selector still shows your project.
3. **Create service account**.
   - Name: `agritrack-collector` (anything works; this is just a label)
   - Click **Create and continue**.
4. Grant it the role **Earth Engine Resource Viewer**.
   - Type "Earth Engine" in the role filter to find it.
   - Read-only is all this needs — it queries imagery, never writes.
5. Click **Continue**, then **Done**.

## 4. Register the service account with Earth Engine

This step is easy to miss and is the usual cause of a 403 later. A Cloud
service account is not automatically an Earth Engine user.

1. Go to <https://code.earthengine.google.com/register> again, or
   <https://developers.google.com/earth-engine/guides/service_account>
2. Register the service account's email address (it looks like
   `agritrack-collector@your-project.iam.gserviceaccount.com` — copy it
   from the service accounts list) against your Earth Engine project.

## 5. Download the key file

1. Back at <https://console.cloud.google.com/iam-admin/serviceaccounts>,
   click the service account you just made.
2. **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create**.
3. A `.json` file downloads. Treat it like a password.

## 6. Put the key where the code expects it

Rename the downloaded file to `earthengine-key.json` and place it here:

```
c:\Udaan\src-tauri\agritrack-collector\earthengine-key.json
```

That's it. `ndvi.py` looks for exactly that filename beside `collector.py`.

<details>
<summary>Alternative: keep the key elsewhere</summary>

Set the `AGRITRACK_EE_KEY` environment variable to the file's full path
instead. The env var takes priority over the default location. If the
key's own `project_id` isn't the Earth-Engine-registered project, also
set `AGRITRACK_EE_PROJECT` to the right project ID.

</details>

> The key file is gitignored. Don't commit it.

## 7. Verify

```bash
cd c:\Udaan\src-tauri\agritrack-collector
python collector.py --date 2026-08-28
```

Then check what landed:

```bash
python -c "import sqlite3,os; c=sqlite3.connect(os.path.join(os.environ['APPDATA'],'dev.udaan.workstation','agritrack.sqlite3')); print(c.execute('SELECT notes FROM collection_log ORDER BY id DESC LIMIT 1').fetchone()[0])"
```

**Success looks like:** a note reading
`Earth Engine ready (service account agritrack-collector@…)`, and
`earth-engine` listed in `sources_succeeded`.

Then confirm real values landed:

```sql
SELECT crop_id, date, ndvi_value, ndvi_age_days
FROM daily_crop_telemetry
WHERE ndvi_value IS NOT NULL ORDER BY date DESC LIMIT 20;
```

Expect NDVI roughly in the **0.1–0.9** range (bare soil low, dense
canopy high; negative means water or cloud) and `ndvi_age_days` between
0 and about 30.

**Only about a third of crops get a value on the first run.** That's the
rotation working as designed — see below. Run it three days running (or
backfill three consecutive days) to see all 33 covered.

---

## How the NDVI logic behaves

- **Source:** `COPERNICUS/S2_SR_HARMONIZED`, NDVI from `(B8 − B4) / (B8 + B4)`,
  averaged over a 150 m buffer around each crop's coordinate at 10 m scale.
- **Cloud filter:** scenes above 20% `CLOUDY_PIXEL_PERCENTAGE` are
  skipped; it searches back up to 30 days for a usable one.
- **Rotation:** the 33 crops are split into 3 groups by `crop_id % 3`,
  and one group is refreshed per day (chosen by the date's ordinal, so
  backfills are reproducible). Sentinel-2 only revisits every ~5 days,
  so querying every crop daily would mostly re-fetch the same scene.
- **Carry-forward:** on the two days out of three a crop isn't due — and
  whenever a live lookup fails — the last known value is reused with
  `ndvi_age_days` incremented accordingly, so a carried value never
  looks fresher than it is.
- **Staleness ceiling:** past 21 days the carried value is dropped and
  `NULL` is written instead. A three-week-old NDVI says nothing useful
  about today's canopy.

## If it doesn't work

| Symptom | Cause |
| --- | --- |
| `no service-account key found` | File isn't at the path in step 6, or is named differently. |
| `has no client_email` | You downloaded an OAuth client secret, not a service-account key. Redo step 5. |
| `initialisation failed: … 403` | Step 4 was skipped — the service account isn't registered with Earth Engine. |
| `initialisation failed: … not been used or is disabled` | Step 2 was skipped, or you enabled it on a different project. |
| Runs fine, but every `ndvi_value` is `NULL` | Persistent cloud, or the coordinates fall on water/bare ground. Widen `SCENE_SEARCH_DAYS` or raise `MAX_CLOUD_PCT` in `ndvi.py`. |
