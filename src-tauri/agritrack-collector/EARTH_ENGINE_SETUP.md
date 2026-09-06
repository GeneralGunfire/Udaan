# Earth Engine setup

**Time needed:** about 15 minutes, most of it waiting on Google.
**What you get:** real NDVI (crop greenness) values in AgriTrack.
**What you need:** a Google account. No credit card, no billing setup.

All the code is already written and wired in. This document is the only
thing left to do: create a Google Cloud project, enable one API, make a
service account, download its key file, and drop that file in one
specific folder. **No code changes are needed afterwards.** If you find
yourself editing Python to make this work, something has gone wrong —
stop and flag it.

Until this is done everything else runs normally. The collector writes
`NULL` for NDVI and logs `Earth Engine credentials not configured: …`
in `collection_log`, and the map's Crop health layer stays greyed out
saying "no data yet". Nothing else is blocked.

> **Jargon, once:** a **Cloud project** is just a container Google uses
> to group things and track usage. A **service account** is a robot user
> that belongs to that project — the collector logs in as it, so the
> script can run unattended without your personal Google password. The
> **key file** is that robot's password, as a `.json` file.

---

## Step 1 — Create the project and enable Earth Engine

1. Go to **<https://console.cloud.google.com/earth-engine>**
   Sign in with your Google account if asked.

2. If this is your first Cloud project, Google will walk you through
   creating one. Accept the defaults. **Write down the project ID** it
   gives you — it looks like `ee-yourname` or `agritrack-451207`, and
   it is *not* the same as the display name you type.

3. On that Earth Engine page, look for a button to **enable the Earth
   Engine API** and click it. If it already says *Manage* or *API
   enabled*, that's done — move on.

4. You'll be asked to **register the project**. Choose the
   **noncommercial / unpaid** option, then fill in the short
   questionnaire about what you're using it for.

   Free-text answers are fine — something like *"Personal research
   project tracking crop conditions across South African provinces"* is
   exactly the kind of thing it's asking for. There are no wrong answers
   and no pricing plan to pick.

5. Click through to finish registering.

**How you know it worked:** the Earth Engine page shows your project as
registered, with no prompts left to complete. Access is usually granted
immediately; occasionally the questionnaire takes a little longer to
clear. You can't proceed to Step 3 until it does.

> If you land on a page asking you to set up **billing**, you've slipped
> onto the commercial track. Go back to
> <https://console.cloud.google.com/earth-engine> and look for the
> noncommercial or unpaid option. Our usage — about 11 satellite point
> lookups per day — sits far inside the free tier.

## Step 2 — Create the service account

1. Go to **<https://console.cloud.google.com/iam-admin/serviceaccounts>**

2. **Check the project selector** in the blue bar at the top of the
   page. It must show the project from Step 1. If it doesn't, click it
   and pick the right one. *This is the single most common mistake* —
   everything below will appear to work while being created in the wrong
   project.

3. Click **+ CREATE SERVICE ACCOUNT** near the top.

4. **Service account name:** type `agritrack-collector`.
   The ID field fills itself in. Click **CREATE AND CONTINUE**.

5. You'll see **"Grant this service account access to project"** with a
   **Select a role** dropdown. Click it and type `Earth Engine` in the
   filter box, then choose **Earth Engine Resource Viewer**.

   Read-only is deliberate and sufficient — the collector only reads
   satellite imagery, and never writes anything to Google.

6. Click **CONTINUE**, then **DONE**. You can skip the "Grant users
   access" step entirely.

You do **not** need to separately register this service account with
Earth Engine. Registering the *project* in Step 1 covers every service
account inside it. (Older guides on the web still describe a separate
service-account registration step — it no longer applies.)

## Step 3 — Download the key file

1. Still on the service accounts list, **click the service account you
   just created** (`agritrack-collector@…`).

2. Open the **KEYS** tab.

3. Click **ADD KEY** → **Create new key**.

4. Choose **JSON** (it's the default), then click **CREATE**.

5. A `.json` file downloads immediately — usually to your Downloads
   folder, with a long name like
   `agritrack-451207-a1b2c3d4e5f6.json`.

> **Treat this file like a password.** Anyone holding it can use your
> Earth Engine quota. It only ever lives on your PC — it's already in
> `.gitignore`, so it will never be committed.

## Step 4 — Put the key where the code expects it

Rename the downloaded file to exactly **`earthengine-key.json`** and move
it to:

```
C:\Udaan\src-tauri\agritrack-collector\earthengine-key.json
```

That is the same folder as `collector.py`. Nothing else to configure —
`ndvi.py` looks for exactly that filename in exactly that folder, and
picks it up on the next run.

<details>
<summary>If you'd rather keep the key somewhere else</summary>

Set the `AGRITRACK_EE_KEY` environment variable to the file's full path;
it takes priority over the default location. If the key's own
`project_id` isn't the Earth-Engine-registered project, also set
`AGRITRACK_EE_PROJECT` to the right project ID.

</details>

## Step 5 — Check it worked

Open a terminal in the collector folder and run:

```
cd C:\Udaan\src-tauri\agritrack-collector
python collector.py
```

Then check what it recorded:

```
python validate.py
```

**Success looks like:** `validate.py` no longer prints the
`[ndvi-absent]` note. To see the detail directly:

```
python -c "import sqlite3,os; c=sqlite3.connect(os.path.join(os.environ['APPDATA'],'dev.udaan.workstation','agritrack.sqlite3')); print(c.execute('SELECT notes FROM collection_log ORDER BY id DESC LIMIT 1').fetchone()[0])"
```

You want a line reading **`Earth Engine ready (service account
agritrack-collector@…)`**, and `earth-engine` listed among the
succeeded sources.

Then look at the actual values:

```
python -c "import sqlite3,os; c=sqlite3.connect(os.path.join(os.environ['APPDATA'],'dev.udaan.workstation','agritrack.sqlite3')); [print(r) for r in c.execute('SELECT crop_id,date,ndvi_value,ndvi_age_days FROM daily_crop_telemetry WHERE ndvi_value IS NOT NULL ORDER BY date DESC LIMIT 20')]"
```

Expect NDVI roughly between **0.1 and 0.9** — bare soil low, dense
canopy high — and `ndvi_age_days` between 0 and about 30.

### Only about a third of crops will have a value. That's correct.

Sentinel-2 only passes over the same point every ~5 days, so querying
all 33 crops daily would mostly re-fetch imagery we already have. The
crops are split into three groups and one group is refreshed per day.
To fill all 33, either wait three days, or backfill three at once:

```
python collector.py --backfill-from 2026-08-28
```

Finally, open AgriTrack in Udaan and switch to the map: **Crop health
(NDVI)** should now be selectable instead of greyed out.

---

## If something goes wrong

Run `python collector.py` and read the `collection_log` note — the
message names the problem directly.

| Message contains | What happened | Fix |
| --- | --- | --- |
| `no service-account key found` | The file isn't where Step 4 says, or is named differently | Check for `earthengine-key.json` — exactly that name, no `(1)` suffix, in the collector folder |
| `has no client_email` | You downloaded the wrong kind of key (an OAuth client secret, not a service-account key) | Redo Step 3, making sure you're on the service account's **KEYS** tab |
| `403` or `permission denied` | The role from Step 2.5 didn't stick, or the account is in a different project | Re-check the project selector, then confirm the service account has **Earth Engine Resource Viewer** |
| `API ... not been used` or `is disabled` | Step 1.3 was missed, or was done on a different project | Go back to <https://console.cloud.google.com/earth-engine> with the right project selected |
| `not registered` | Step 1.4's questionnaire wasn't completed | Return to the Earth Engine page and finish registration |

**Runs fine, but every `ndvi_value` is still `NULL`:** not a credentials
problem. It means no low-cloud Sentinel-2 scene was found — persistent
cloud, or coordinates that fall on water or bare ground. If it persists
for more than a week, raise `MAX_CLOUD_PCT` or `SCENE_SEARCH_DAYS` in
`ndvi.py`.

---

## What the NDVI code actually does

Useful context if you're interpreting the numbers later.

- **Source:** Sentinel-2 surface reflectance
  (`COPERNICUS/S2_SR_HARMONIZED`), NDVI computed as
  `(B8 − B4) / (B8 + B4)` — near-infrared minus red over their sum.
  Healthy vegetation reflects strongly in near-infrared and absorbs red,
  so higher means greener.
- **Sampling:** averaged over a 150 m radius around each crop's own
  coordinate at 10 m resolution — roughly 7 hectares, enough pixels to
  average out noise without straying into neighbouring land.
- **Cloud filter:** scenes above 20% cloud are skipped; it searches back
  up to 30 days for a usable one.
- **Rotation:** 33 crops in 3 groups by `crop_id % 3`, one group
  refreshed per day, chosen by the date's ordinal so backfills stay
  reproducible.
- **Carry-forward:** on the two days in three a crop isn't due — and
  whenever a lookup fails — the last known value is reused with
  `ndvi_age_days` incremented, so a carried value never looks fresher
  than it is.
- **Staleness ceiling:** past 21 days the carried value is dropped and
  `NULL` written instead. A three-week-old NDVI says nothing useful
  about today's canopy.
- **Cost:** roughly 11 point queries a day, far inside the free
  noncommercial quota.
