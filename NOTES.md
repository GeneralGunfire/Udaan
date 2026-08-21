# NOTES

Running log of judgment calls, ambiguities, and anything deliberately left
unfinished during autonomous feature work. Newest entries at the bottom of
each dated section; new sessions get a new dated section — never overwrite
prior entries.

## 2026-08-21 (session 2) — DJ Board, Image Editor, School Knowledge Base,
Video Editor foundation

### Concurrent session on the same repo

Partway through Section 1, `git status` and file contents changed under me
multiple times with no command from me, and the reflog showed a `reset:
moving to HEAD` I didn't run — 13 separate `claude.exe` processes were
running. Stopped and asked; user confirmed this is expected (parallel
sessions on purpose). Worked around it defensively for the rest of the
session: always re-`Read` a file immediately before editing it rather than
trusting an earlier read, and where `Cargo.toml` / `capabilities/
default.json` / `src-tauri/src/lib.rs` had my edits and the other
session's edits genuinely interleaved in the same small hunks (not
separable at the file level), committed them together rather than trying
to hand-split a working file into two broken ones. Everything the other
session touched that I didn't need (splash screen, `main.tsx`, general-chat
polish, WallpaperPicker tweaks, `local_model`/whisper changes, `webview_
permissions.rs` mic-capture code) was left completely alone across every
commit — never staged, never edited, never reverted.

### Declined: downloading the user's YouTube Music library

Partway through Section 1 the user pasted their ~319-song YouTube Music
"Liked" library and asked me to source real audio files for it — first via
"find a way," then explicitly "get the songs from somewhere else" after I
declined. Refused both times: downloading commercially-released music you
don't own a copy of is copyright infringement regardless of source or
whether the app is public, and the task's own brief explicitly ruled out
"any download/fetch-from-web functionality of any kind" for this feature.
Did not build a downloader in any form, disguised or otherwise. Offered
(and the user accepted, declining the wishlist-panel option) to keep the
DJ Board to a real local-folder scanner only — it plays whatever audio
files the user legitimately has, nothing more.

### 1. DJ Board

Real Web Audio graph per deck: `AudioBufferSourceNode` playback, 3-band EQ
(low/mid/high shelving + peaking `BiquadFilterNode`s), a dedicated bass
control (separate low-shelf centered at 100Hz), per-deck gain, and an
equal-power crossfader in a `MixerEngine`. All genuine DSP, not mocked —
these are cheap native Web Audio nodes, no reason to fake them.

Effects rack (reverb/delay/filter/flanger) is explicitly mock: UI + state
only, no audio node graph, clearly labeled "Mock DSP" in the panel itself
and TODO'd in `lib/audioEngine.ts`. Per the task brief, the real DSP
choice needs the user's direct input given hardware constraints — convo-
lution reverb and feedback delay lines are meaningfully more expensive
than the EQ chain, so it wasn't my call to make silently.

Tempo/pitch (the horizontal tempo fader) is also mock — real time-stretch
needs a phase vocoder or WSOLA; naive `playbackRate` would shift pitch too,
which real DJ software avoids. TODO'd in `useDjBoard.ts`.

Track source: local folder only, via new Tauri `dialog` + `fs` plugins
(`src-tauri/src/audio_library/mod.rs` — non-recursive scan, by design, so
the library stays predictable). No bundled/sample audio shipped — there
was no existing `public/music/` folder or any audio files anywhere in the
repo to point at, so this is a from-scratch local browser, not a wire-up
of pre-existing content.

**Rust dependency snag, fixed**: adding `tauri-plugin-dialog`/`tauri-
plugin-fs` initially broke the build with an unrelated pre-existing file
(`webview_permissions.rs`, from the concurrent session) failing to
compile against a duplicate `windows` crate version. Traced it, confirmed
it wasn't my code at fault, and the concurrent session fixed its own file
before I needed to touch it further — final state compiles clean.

**Not tested interactively**: no real browser/WebView available in this
environment to click through the UI. Verified instead via: clean `tsc -b`,
clean `pnpm build`, clean `cargo check --lib`, and the Vite dev server
serving the app shell over HTTP without errors. The tap-tempo BPM wiring
had a real bug (computed BPM was written to a fresh per-render object and
never reached the callback) — caught and fixed before committing, but
that's exactly the kind of thing a live click-through would have caught
faster. Flagging so the user knows to smoke-test the actual controls
before relying on this.

### 2. Image Editor

Real Canvas 2D pipeline in `lib/imageOps.ts`: crop and resize via
`drawImage`, brightness/contrast/saturation via genuine per-pixel math
over `ImageData` (not a CSS-filter preview trick — the exported file
actually reflects the adjustment). Verified the pixel math standalone
(brightness push-to-white/black, luminance-preserving desaturation,
contrast pivot around 128) against known values before committing.

No prior-session asset library existed to reuse (task said "use the asset
library if it exists" — it didn't), so built a shared one from scratch
(`src-tauri/src/asset_library/`, `src/integrations/asset-library/`) that
both this and the Video Editor's clip library now use. Same non-recursive
single-folder scan pattern as the DJ Board's audio library, plus a
`write_file` command for real export via the native save dialog.

Batch operations (`lib/batchOps.ts`) apply the same adjustment/resize
settings across every checked image in the Assets panel, writing to a
separate output folder with a configurable filename suffix — never
overwrites the originals.

Tested against the repo's real `screenshot.png` (468KB): confirmed it
reads via the Rust `asset_library_read_file` command path and the pixel-
adjustment formulas produce correct output for known inputs. Did not
manually click-test crop-by-drag or the save dialog for the same reason
as the DJ Board (no live browser in this environment) — recommend a
real smoke test of the crop-drag interaction and the save dialog before
relying on it.

### 3. School Knowledge Base + Study Generator

Three original markdown reference docs under `src/features/school/
knowledge-base/` (tone guide by grade band, structure templates per
document type, a writing-style guide banning generic AI-patterned
phrasing) — all written fresh for this task, not derived from or copied
from any external source. `lib/promptBuilder.ts` concatenates all three
into every Study Generator call via Vite `?raw` imports; verified the
grounded prompt is ~130x longer than a bare prompt and demonstrably
contains the specific guidance text (elementary sentence-length rules,
the transitional-phrase ban list), so every generation call is genuinely
grounded, not just nominally pointed at the files.

Backend choice: defaults to Claude Code (headless, same `submitTask`/
event-stream pattern as General Chat) rather than the local Ollama model.
Judgment call — `qwen2.5:1.5b` is sized for short, fast replies per its
own doc comment in `integrations/local-model/client.ts`; long-form
academic writing that's actually good needs more capability than that.
Local model is kept as an explicit, user-selectable "faster, lower
quality" option rather than removed, since it's still genuinely useful
for quick drafts.

**Deferred, not guessed at**: the task also asked for "a local fonts/
templates library for academic documents... freely-licensed sources
only." Did not build this — picking specific font files or document
templates and asserting their license is clean is exactly the kind of
claim that needs verification I can't responsibly fake (checking an
actual license file, not just assuming a name like "Open Sans" is safe).
Flagging as skipped rather than shipping something with an unverified
licensing claim baked into a personal app.

**Not tested**: no way to actually invoke Claude Code or Ollama from
inside this environment to see real generated output. Verified the
prompt-construction logic (what's provably different with vs. without the
knowledge base) rather than the generation itself. Recommend the user run
one real generation before trusting the output quality.

### 4. Video Editor foundation

UI shell only, exactly as scoped — timeline (mock 60s-per-clip durations,
draggable playhead, click-to-select/remove), preview pane (static
placeholder frame, no real decode), clip library (reuses the Image
Editor's asset library, filtered to video extensions), export panel
(format/resolution selects, Export button permanently disabled with a
tooltip explaining why). Every point where real processing plugs in is
TODO'd and points back here.

**Needs the user's direct input before it can be finished**: real video
decode/encode (almost certainly an ffmpeg sidecar process invoked from
Rust, given this machine's hardware constraints mentioned in the task
brief) was explicitly out of scope this session and needs a deliberate
engine choice, not a guess.

### Rust build state

`cargo check --lib` is clean as of the last commit in this session (one
pre-existing, unrelated dead-code warning in `claude_code/store.rs`, not
touched this session). New Tauri plugins added: `tauri-plugin-dialog`,
`tauri-plugin-fs` (both v2), used by the DJ Board's audio library and the
shared asset library. Capabilities updated (`dialog:allow-open`, `dialog:
allow-save`, `fs:default`).

### Nothing else was skipped as unsafe

No destructive operations, no data loss risk, nothing outside `c:\Udaan`.
Every checkpoint commit used explicit `git add <specific files>` to keep
the concurrent session's unrelated work out, per the standing rule —
except where Rust config files had both sessions' edits genuinely
interleaved (see "Concurrent session" above), which were committed as-is
since splitting them would have left one or both broken.

### Summary of commits this session

1. `Add DJ Board: real dual-deck Web Audio engine, mock effects rack`
2. `Add Image Editor: real canvas crop/resize/adjustments + batch export`
3. `Add School knowledge base + wire it into Study Generator prompts`
4. `Add Video Editor foundation: UI shell only, no real processing`

See `git log --oneline` for hashes.

## 2026-08-21 — General-category feature build (Model Dashboard, Account,
Integrations, System Health, Notifications) + audit fixups

### Pre-existing uncommitted changes (not mine, left untouched)

At the start of this session, `git status` showed uncommitted local edits
predating this work: `filestructure.txt` (modified), `scratch-chat-shot.cjs`
(deleted), and UI polish to `src/features/general-chat/components/
ChatMessage.tsx` and `Composer.tsx` (motion/gradient tweaks, none of it in
scope for this task list). These were not part of any numbered feature and
touching general-chat logic beyond what was explicitly asked was out of
scope. I left them exactly as I found them — never staged, never committed,
never reverted — across every commit in this session. Each commit below
used explicit `git add <specific files>` rather than `git add -A`/`-u` to
guarantee these stayed out. They remain in the working tree as
uncommitted changes for the user to handle.

### 1. Model Dashboard

Added `listRunningModels()` to `src/integrations/local-model/client.ts`
(GET `/api/ps`) and a `configuredChatModel()` getter for the fallback
display case. No judgment calls of note — followed the spec directly.
Router stats placeholder styled with a dashed border and muted/tertiary
text specifically so it can't be mistaken for real data at a glance.

### 2. Account

Single localStorage key (`udaan.account.profile`) holding `{ name,
preferences }` as JSON. Chose one freeform `preferences` textarea rather
than a structured preferences schema — there's no consumer for structured
prefs yet anywhere in the codebase, so a schema would be speculative.
Easy to split into fields later once something actually reads them.

### 3. Integrations status

For the `schedule` row, per the task's own suggestion, labeled it "Local
data" rather than forcing a connected/error binary — it's an in-memory
module with no daemon, so "error" would never be a meaningful state for
it. Documented inline in `checkSchedule()`. For `weather`, used a GET
against Open-Meteo's geocoding endpoint (`?name=London&count=1`) as the
lightweight live check since Open-Meteo has no dedicated health/ping
endpoint — geocoding is cheap and exercises the same base infrastructure
the real weather widget depends on.

### 4. System Health

**Disk scope**: exposed *all* mounted disks (via `sysinfo::Disks`), not
just the drive the Tauri app-data dir lives on. Rationale documented
inline in `src-tauri/src/system_health/mod.rs`: on a personal desktop,
users care about "is my D: drive full" just as much as the app's own
drive, and there are typically only 1-3 disks so showing all of them
costs little UI space. This was an explicit "your call" in the task
brief.

**Rust plumbing surprise**: adding `tokio::time::timeout` (needed for the
Claude CLI version-check timeout) required also adding tokio's `"time"`
feature to `Cargo.toml` — it wasn't enabled by the existing feature list
(`process, io-util, rt-multi-thread, sync`). Caught by `cargo check`,
fixed immediately, re-verified clean.

**CLI check placement**: put `claude_code_check_cli` inside the existing
`claude_code` module (using its private `exe::resolve()` helper) rather
than creating a new top-level module, since it's fundamentally a
Claude-Code-CLI concern and needed access to the same Windows `.cmd`
resolution as the existing task runner.

### 5. Notifications

Chose the "simpler and safer" option the brief offered: a plain
module-level singleton (`src/features/notifications/lib/
notificationStore.ts`) holding an in-memory array + a `Set` of listener
callbacks, started lazily on first subscribe. `useNotifications()` (full
list, for the view) and `useUnreadNotificationCount()` (count only, for
the Sidebar badge) both read the same singleton via a shared `subscribe()`
function, so the badge stays live whether or not the Notifications view
is mounted, without any extra architecture (no context provider, no
external state library).

Removed `PLACEHOLDER_BADGES.notifications` entirely from
`src/app/placeholderData.ts` (rather than leaving it as unused dead code)
since the Sidebar no longer reads it — `taskQueue` was left untouched, as
instructed.

Notification identity is deliberately loose: `${taskId}-${status}-
${Date.now()}` as the id, with a same-task-same-status dedupe guard in
`handleEvent()`. This assumes a given task won't legitimately reach
"done" twice — true for the current one-shot task model.

### 6. Audit fixups

- **ModeSessionPanel**: re-verified via grep that it's imported and
  rendered in `Composer.tsx` (`<ModeSessionPanel mode={activeMode}
  latencyMs={lastLatencyMs} />`). No code change made. Confirmed stale
  audit item, closed.
- **WorkView.tsx**: reworded the stub paragraph to stop implying Work
  will build its own task-queue tooling; it now points at General → Task
  Queue explicitly. No other change to the file — no real Work feature
  logic was added, per the hard rule against touching Work feature logic.
- **ScheduleView "unplanned" filter**: chose to *implement* the concept
  (the brief's preferred path) rather than remove the chip. Added
  `unplanned?: boolean` to `ScheduleEvent` in `scheduleStore.ts`, plus two
  sample unplanned events (`evt-7`, `evt-8`) so the filter isn't
  permanently empty for a different reason. Rewired the filter branch in
  `ScheduleView.tsx` so `'planned'` now excludes unplanned events (it
  previously showed everything, which was itself a second latent bug —
  'planned' and 'all' rendered identically) and `'unplanned'` shows only
  events with `unplanned: true`. Left the "Free" empty-state label as-is
  for the unplanned tab; it reads naturally either way ("no unplanned
  items" or "free time").
- **READMEs**: rewrote both root `README.md` and
  `src/integrations/README.md` from "scaffolding only" / "nothing lives
  here yet" to reflect what's actually built. While drafting this I
  checked whether the wallpaper system (`AmbientBackground.tsx`,
  `useWallpaper`, `app/wallpapers.ts`) was real before citing it, since it
  wasn't in the explicit "confirmed working" list in my task brief —
  confirmed it's a real, working, user-selectable, persisted wallpaper
  system, so it's now listed under "What's built" rather than omitted or
  hedged. Kept School/Work/Creativity explicitly listed as still
  placeholder-only, and kept schedule persistence, MCP tooling, router
  telemetry, and the mobile companion honestly listed as not-yet-built —
  none of that changed in this session.

### Nothing was skipped as unsafe

No item in the numbered list triggered the "genuinely unsafe" bar (data
loss risk, destructive change outside `c:\Udaan`). Every commit below
built cleanly on both gates (`pnpm build` and, for the Rust-touching
commit, `cargo check --lib` from `src-tauri`).

### Summary of commits this session

1. `Add Model Dashboard view with real Ollama + Claude Code task status`
2. `Add local Account/profile view (no auth, localStorage-backed)`
3. `Add live Integrations status view for claude-code/local-model/weather/schedule`
4. `Add System Health view with real disk/RAM/Ollama/Claude-CLI checks`
5. `Wire real notifications from Claude Code task completions, replace hardcoded badge count`
6. `Fix stale audit items: WorkView copy, ScheduleView unplanned filter, README accuracy`

See `git log --oneline` for hashes.
