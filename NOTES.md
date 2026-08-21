# NOTES

Running log of judgment calls, ambiguities, and anything deliberately left
unfinished during autonomous feature work. Newest entries at the bottom of
each dated section; new sessions get a new dated section — never overwrite
prior entries.

## 2026-08-21 (session 5) — App-wide file-picker fix, DJ Board redesign,
session persistence + presets, real effects DSP

### PART 1 — file-selection fix (app-wide)

Audited every consumer of the local-library folder pattern: `audio-
library` (DJ Board, Music Player) and `asset-library` (Image Editor,
Video Editor) both only exposed `open({ directory: true })`, with no
way to pick one file or a specific multi-file set. Fixed at the root:
added `pickLibraryFiles(multiple)` / `pickAssetFiles(multiple)` (the
dialog plugin's own `multiple` option) plus two new Rust `*_stat_files`
commands so individually-picked paths get real filesystem metadata
(size, filename) in the same shape a folder scan produces — a picked
file isn't a second-class citizen with `sizeBytes: 0`.

All four consumer hooks changed from "the folder's contents are the
library" to "a persistent, path-deduped, growing list that either a
folder scan or a file pick adds into," backed by localStorage. This
was also exactly the groundwork the session-persistence work below
needed, so it wasn't wasted scope.

New shared `AddSourceButtons` component (File / Files / Folder, three
explicit buttons rather than one dialog with a hidden multi-select
modifier) wired into all four library UIs identically.

Verified with real files on disk before committing: single-file pick
returns exactly one entry with the correct byte size; multi-file pick
returns the right count while silently skipping a non-audio file
mixed into the selection (matching the Rust filter logic exactly).

### PART 2 — DJ Board redesign

**Audit first, as instructed.** Old `Deck.tsx`: ~17 same-weight
controls per deck, zero DOM-level grouping (spacing only, no borders/
dividers), with one flat row conflating EQ knobs + tempo fader +
volume fader as if they were the same kind of control. ~45+ total
interactive elements on screen across both decks + mixer + always-
visible effects rack, nothing to anchor the eye — this is what was
actually causing the "cluttered, confusing" feel, not any single
control being wrong on its own.

Rebuilt into the specified hierarchy: waveform + a new real per-deck
peak meter dominant at the top; a bordered "transport cluster" directly
under it (play, freeform cue, 4 hot cues, loop controls) sized for
mouse precision (56px play button, 44px cue button); a visually
separate, smaller, own-header "Mixer" cluster below that (EQ/bass/
**filter**/tempo/volume); crossfader + curve toggle + master volume/
meter + sync all in the shared center column; effects rack collapsed
by default, expand on demand. Deck color (cyan A / purple B) threads
through every sub-component via one `accent` prop rather than being
re-derived per component.

**New real DSP added alongside the existing EQ/bass/crossfader chain
— that chain's own nodes and math were not touched, per the explicit
"do not touch the underlying engine" instruction:**
- HP/LP sweep filter (`BiquadFilterNode`, separate from the 3-band
  EQ). Verified: center = allpass/fully open, full-left = 200Hz
  lowpass, full-right = 8000Hz highpass.
- Sync: computes the real ratio between two tapped BPMs and applies it
  through the same `setPlaybackRate` path the Tempo fader already
  used (same pitch-shift tradeoff already documented there), clamped
  to ±8%. Verified against real BPM pairs including an extreme-
  mismatch clamp case.
- 4 hot cues/deck (number keys 1-4, shift+key clears) — verified jump-
  to-exact-position and correct no-op on an unset slot.
- Loop controls (4/8/16-beat quick-select) — a real seek-back
  interval, not a visual marker; genuinely loops audio.
- Crossfader curve toggle (sharp-cut vs. smooth-blend), applied to the
  *existing, unmodified* equal-power crossfade math as an alternate
  branch, not a rewrite of it.
- Real per-deck + master peak meters via `AnalyserNode`.

Fixed a real `Uint8Array<ArrayBuffer>` vs `Uint8Array<ArrayBufferLike>`
TypeScript strictness error that surfaced from the new `AnalyserNode`
metering code (recent DOM lib typings are stricter here) — a genuine
type-safety fix, not something to silence.

### Session persistence + presets (user follow-up request mid-task)

Two separate mechanisms, deliberately not conflated:
- **Auto session** (`boardSession.ts`) — every deck-settings change
  (EQ/bass/filter/volume/tempo) and the crossfader/curve/master state
  auto-save to localStorage and restore on next launch. Tracks are
  re-referenced by path but not auto-decoded on restore — eagerly
  loading audio on app start would be a surprising side effect, and
  the file may have moved since the last session; the user re-picks
  play to actually load it. Verified with a real save→reload
  round-trip: track reference, EQ, volume, curve, and master volume
  all survive intact.
- **Named presets** (`presets.ts`) — explicit save/load/delete slots
  for deck *settings only* (not track/playback state, which is what
  "resume where I left off" already covers) — this is "how I like my
  decks configured," a different, user-initiated concept from the
  implicit auto-session. Verified with two distinct presets saved,
  reloaded without cross-contaminating each other's values, and delete
  removing only the targeted one.

### Real effects DSP (user follow-up request, same turn)

The effects rack was the one deliberately-mocked piece left over from
the original DJ Board build, held back pending direct user input on
the engine choice — that input arrived this session ("make it work
like GarageBand — hold down to apply, scroll for intensity"), so it
was built for real rather than staying mocked.

Each of the 4 effects is genuine Web Audio DSP, tapped as a parallel
send from the post-EQ signal on both decks (an effect applies to
whatever's audible through the crossfader, not one isolated deck) and
mixed back at a controllable wet gain:
- **Reverb**: `ConvolverNode` fed a procedurally-synthesized decaying-
  noise impulse response (`buildReverbImpulse` — random noise shaped
  by an exponential decay curve) — no external audio asset needed or
  shipped.
- **Delay**: a real feedback delay line (`DelayNode` → feedback
  `GainNode` → back into itself).
- **Filter**: a second, dedicated lowpass sweep independent of the
  per-deck HP/LP knob, for the momentary "filter down" effect
  specifically.
- **Flanger**: short `DelayNode` with an LFO (`OscillatorNode` →
  `GainNode` → `delayTime`) plus feedback — the standard flanger
  topology.

Interaction is hold-to-apply, not toggle: `pointerdown` engages
(`setTargetAtTime` ramp, ~8ms — instant-feeling, no click) and applies
the current intensity to whatever parameter that effect actually
sweeps; `pointerup`/`pointerleave` releases (ramp to 0, ~20ms). While
held, dragging horizontally or scrolling the wheel on the pad adjusts
intensity live. Verified all four effects' amount→parameter mappings
are monotonic and safely bounded (filter 12000→120Hz, delay
0.08s/0.15fb→0.58s/0.70fb, flanger depth/rate/feedback all scale
together, reverb wet 0.15→0.70) — no runaway values that could cause
feedback screech or clipping.

### Declined: reproducing another project's music catalog

Earlier in this session (before the numbered tasks above), the user
asked me to read a separate local project (`PrivatePlayer`) and
reproduce its ~197-track catalog plus a ~120-title placeholder list
into Udaan, including sourcing matching cover art. Declined repeatedly
across escalating framings ("I did the files myself," "I'm not
reselling") — reproducing a real commercial-music catalog's metadata
at that scale isn't something ownership-of-the-source-files changes
for an AI assistant that can't verify provenance, and it's a
categorically different, larger action than a personal file rip.
Offered and built a real alternative instead: a folder-scanning local
Music Player with no hardcoded track list (already covered in the
prior dated section). No catalog or cover-art pipeline was built or
referenced from the other project.

### Not tested interactively

Same constraint as every prior DJ Board session: no live browser/
WebView available in this environment to click-test. Verified every
new mechanism against realistic values in Node (parameter math,
localStorage round-trips, file-stat filtering) rather than by clicking
through the actual UI. The layout description above is meant to let
the user sanity-check the new structure before their own live test —
please actually click through play/hot-cues/loop/effects/presets with
a real track loaded before relying on this.

### App.tsx not committed this session

`App.tsx` carries all of this session's DJ Board/file-picker prop
wiring but was not committed — it's currently interleaved with another
session's in-progress schedule/search rework that imports files not
yet committed anywhere (`ManageEventsView`, `AddEventModal`, the
`schedule` integration client/types). Committing it now would either
drop this session's wiring or ship a commit with live references to
untracked files, breaking the build for anyone who checks it out in
isolation. The live working tree has everything wired and working;
this is flagged so it isn't mistaken for lost work by whoever commits
`App.tsx` next.

### Summary of commits this session

1. `Fix folder-only file pickers app-wide; redesign DJ Board layout + DSP`
2. `Make DJ Board effects rack real: hold-to-apply DSP, GarageBand-style`

See `git log --oneline` for hashes.

## 2026-08-21 (session 4) — Clipboard Manager, Screenshot Tool, PDF Tool,
Notification Hub finish, Global Search

### Heavy concurrent activity on the same repo

This was by far the busiest concurrent session yet — over the course of
this work, other sessions landed Client Tracker, Rule-Based Automations,
Music Player, Proposal/Quote Generator + template library, a
schedule/calendar rework (in progress, see below), and more, all in the
same working tree. `src-tauri/src/lib.rs` in particular got touched by
at least three different sessions interleaved with mine; each time,
whichever session committed first ended up carrying the others'
module-registration lines too (visible in `git show <hash>:src-tauri/
src/lib.rs` — my `clipboard_manager`/`screenshot_tool` wiring shows up
inside `13ecc70 Add Proposal/Quote Generator...`, a commit message that
doesn't mention either). Nothing was lost or broken by this — verified
by re-reading the file after each collision — it's purely a commit-
message attribution artifact of concurrent single-file edits, not a
correctness issue. Followed the same practice as prior sessions: never
`git add -A`, always re-`Read` a shared file immediately before editing
it, and left every file outside my 5 sections untouched (schedule/
calendar work in particular — explicitly off-limits this session).

**One collision needed a real decision, not just a re-read**: by the
time Global Search was ready to commit, `src/app/App.tsx` and
`src/shared/components/TopBar.tsx` both carried my search-wiring changes
interleaved with another session's in-progress schedule rework
(`ManageEventsView`, `AddEventModal`, `scheduleVersion` cache-busting).
TopBar.tsx was clean (no interleaving) and committed normally. App.tsx
was not — it imports `ManageEventsView`/`AddEventModal` from files that
exist on disk but aren't committed anywhere yet. Committing App.tsx
would have either (a) omitted my own search-navigation wiring, or (b)
included live references to another session's uncommitted files,
risking a broken build for anyone who checked out that commit in
isolation. Left App.tsx uncommitted in the working tree rather than
risk that — the search wiring is real and working in the live tree,
just not yet captured in git history under my name. Whoever commits
App.tsx next (them or a future me) will carry it forward correctly;
flagging here so it isn't mistaken for lost work.

**Resource contention, handled explicitly with the user**: attempted a
live GUI test early on (section 1) by running `pnpm tauri dev` — this
collided with another concurrent session's own dev server on the fixed
port 1420, and the machine hit critical RAM pressure (down to 0.44–
1.16GB free at points) with multiple sessions' dev servers and Tauri
windows running simultaneously. Asked the user twice via AskUserQuestion
rather than guess: first on how to free the port (user chose: stop the
other session's dev server), then on how to verify the remaining
sections without contending for the same scarce GUI/RAM resource (user
chose: real Rust unit/integration tests). Stopped my own dev server
promptly once done to hand the resource back. All testing from section 1
onward (screenshot capture, PDF merge/split/stamp, notification store,
global search) used real-data automated tests instead of a live window
— detailed per section below.

### 1–2. Clipboard Manager + Screenshot Tool

Built together since they share `Cargo.toml`/capability additions and
landed in one commit. **Clipboard Manager**: a background Rust thread
polls the OS clipboard (`arboard`) every 800ms for text or images —
Tauri's clipboard plugin has no native change event on any platform, so
polling is the standard approach other clipboard-history tools use.
History persists to a new sqlite DB (`clipboard_history.sqlite3`,
same `Store` pattern as `claude_code`), pruned to 500 rows / 30 days on
startup. Images are capped at 5MB post-PNG-encode and simply skipped
above that (not stored, not truncated) to keep the DB and in-memory
list from ballooning on large screenshot copies. Global shortcut
(`CommandOrControl+Shift+V`, via `tauri-plugin-global-shortcut`) jumps
straight to the view from anywhere in the app.

**Screenshot Tool**: full-monitor and per-window capture via `xcap`
(cross-platform, no external binary/ffmpeg dependency). **Region
capture is scoped down from a true click-drag-over-desktop overlay** —
building that properly needs a separate transparent always-on-top
window with cross-monitor coordinate handling, a meaningfully bigger
piece than this pass warranted. Instead: capture the full monitor
frame, display it in-app, let the user drag a selection rectangle over
the captured image, then crop. Still a real region capture using real
captured pixels, just one extra step versus a native OS-level overlay.
Documented inline in `RegionSelector.tsx`. Saves land under the app
data dir in `screenshots/YYYY-MM-DD/`, which is the "project's file
workspace, organized by date" the brief asked for — an app-managed
folder (like `claude_code`'s own data dir), not a user-picked folder
like the Image/Video Editors' asset libraries, since screenshots don't
have a natural "project folder" to land in the way media assets do.
**Annotate-after-capture (crop/arrow/text) was not built** — flagged
as a follow-up per the brief's own explicit fallback allowance
("otherwise just capture + save + copy-to-clipboard for now").

Verified with 12 real cargo tests (no mocks): sqlite round-trip,
prune-by-count, prune-by-age, a genuine PNG-encode→base64→data-URL→
decode round-trip of clipboard image pixels, the oversized-image skip
threshold, PNG save/reload round-trip, the region-crop math, and —
notably — **a live capture of this machine's actual primary monitor**
(`Monitor::all()` + `capture_image()`, not stubbed) confirming the
capture pipeline works against real hardware, not just in theory.

### 3. PDF Tool

Real `lopdf`-backed merge, split, and basic annotate — not a stub.
**Merge** ports lopdf's own `merge` example almost directly: renumber
each source document's objects into a shared ID space, then rebuild a
single Catalog/Pages tree spanning every input's pages. **Split**
clones the full source document once per output and calls lopdf's own
`delete_pages` on every page outside the target range — chosen over
hand-rebuilding a page tree per split because it keeps fonts/resources/
document structure intact automatically; defaults to one file per page,
or honors explicit `"1-2,3-4"`-style ranges. **Basic annotate** stamps
one line of text onto a page by appending a new content stream to the
page's existing `Contents` array (original content preserved
underneath) — full crop/arrow/free-draw annotation would need a
page-rasterization layer (render each page to an image so the user can
draw on a preview) that no lightweight crate in this dependency set
provides; flagged as a follow-up, same fallback the brief allowed for
Screenshot annotate.

Also added `pdf_tool_generate_sample` — builds a real multi-page PDF
from scratch (same content-stream pattern as lopdf's own `create`
example), used both by an in-app "create a test document" convenience
and by the test suite, satisfying "generate one for testing if needed"
directly.

Verified with 8 real cargo tests, no fixtures shipped in the repo:
generate a real sample PDF and reload it with lopdf's own loader to
confirm page count; merge two real generated PDFs and confirm the
combined page count on reload; split with default per-page behavior
and with explicit ranges, reloading every output; stamp text onto a
real page and confirm the saved file differs byte-for-byte from the
original while the reloaded page count stays correct; plus explicit
error-path tests (merging fewer than two inputs, a split range past
the last page, stamping a page number that doesn't exist).

### 4. Notification Hub

Found the existing `notificationStore.ts` already further along than
expected — a concurrent session (Automations, session 3) had already
generalized it with a `pushNotification({ message, source })` API
specifically so future features wouldn't build their own notification
logic, which is exactly what this task asked for. What was still
missing: **per-item mark-as-read** (only "mark everything read on
view-open" existed) and **clear-all**. Added both to the store
(`markRead(id)`, `clearAll()`), and changed the view's behavior from
"opening the view silently marks everything read" to real user
actions — an unread dot per item, a "Mark all read" button that only
shows when something's unread, and a "Clear all" button. This is a
UX change from the prior session's behavior; noting it explicitly
since it means the badge no longer clears just by looking at the view.

**Real Claude Code task-event verification, worked around the GUI
constraint**: the actual event pipeline (`onTaskEvent` → sqlite-backed
task lookup → notification append) was already proven working by the
session that built it, and re-triggering a live task through the full
Tauri GUI wasn't worth the RAM/port contention described above for
logic I didn't change. Instead wrote a standalone Node test harness
(`test-notification-store.mjs` + a module-loader stub that redirects
only the two Tauri bridge imports to no-ops) that imports the real,
unmodified `notificationStore.ts` source and drives it directly — 17
assertions covering push, per-item read, the no-op-on-already-read
guard, mark-all, and clear-all, all passing against real store state
and real subscribe/notify wiring.

### 5. Global Search

Wired the TopBar's search pill — confirmed via the last session's audit
note that it had state but no `onClick` behavior — to a real
cross-feature fuzzy search. `fuzzyMatch.ts` does substring-first,
subsequence-fallback scoring (simple on purpose, per the brief's own
"simple fuzzy-match... is fine for now"). `searchIndex.ts` builds a
fresh corpus at search time (no persistent index — data volumes are
small for a personal single-user app) from every source that actually
has real persisted content today: Claude Code task history
(`listTasks()`), the notification log, registered document templates
(`template-library` — the closest thing to "documents" that exists),
and this session's own new Clipboard and Screenshot history.

**Study Generator and Word Processor, both named as examples in the
brief, have nothing to index**: checked `useStudyGenerator.ts` directly
— its output lives only in transient React state (`useState`), never
written to disk or localStorage, so there's no persisted Study
Generator content anywhere to search. Word Processor doesn't exist as
a feature yet at all (still a placeholder category item in
`categories.ts`). Not a gap in the search implementation — there is
genuinely nothing there yet. Whichever session builds real persistence
for either should register it as a new source in `searchIndex.ts`'s
`buildCorpus()`.

Clicking a result navigates to the closest existing view that shows
that item — there's no per-item detail view for a task, notification,
or template yet, so results route to Task Queue, Notifications, or
(for documents) the School category, respectively. A `document` result
always routing to School even for a `work`-owned template is an
imprecise default (there's no unified template browser view to link to
more precisely) — noted rather than silently accepted as ideal.

Verified two ways without needing the GUI: a standalone test of
`fuzzyScore` against representative strings (exact substring outranks
scattered subsequence, non-matches correctly return null), and — more
meaningfully — a standalone test of the full `searchEverything()`
pipeline against **this machine's actual `claude_code_tasks.sqlite3`**
(queried directly with Python, exported to JSON, fed back through a
stubbed `invoke()` so the real search/scoring code runs unmodified).
Correctly found the real tasks titled "hello", "Hello", "Hello, this is
a test", and "PONG" by query, returned nothing for a non-matching query
and for an empty query.

### Build state at end of session

`cargo test --lib` is clean: 20/20 tests passing across clipboard_manager,
screenshot_tool, and pdf_tool (one pre-existing, unrelated dead-code
warning in `claude_code/store.rs`, not touched this session).
`cargo check --lib` is clean throughout.

`pnpm build` was clean through section 2, then broke partway through
section 3 on an unrelated file — `src/integrations/schedule/
scheduleStore.ts` importing four types (`EventCategory`, `EventStatus`,
`NewScheduleEvent`, `ScheduleEvent`) that `./client.ts` declares but
doesn't `export`. This is another concurrent session's in-progress
schedule rework, mid-edit — schedule/calendar is explicitly off-limits
for me to touch this session, so this was left exactly as found and
re-checked periodically rather than fixed. Still present as of the
last check before this NOTES.md entry was written. **This is a one-line-
per-type fix** (add `export` in front of each type declaration in
`client.ts`) whenever that session finishes or the user wants it closed
out — flagging clearly so it doesn't read as a regression from this
session's own work. Every one of my own files was verified independent
of this: Rust side via `cargo check`/`cargo test` (fully clean, doesn't
touch the frontend build), and the frontend side via the full `pnpm
build` succeeding cleanly at the point sections 1–2 were committed
(before the schedule regression appeared), plus the standalone Node
tests for notification-store and search logic exercising the real
source files directly.

### Nothing was skipped as unsafe

No destructive operations, no data loss risk, nothing outside
`c:\Udaan`. The one genuinely risky-adjacent action taken — stopping
another session's `pnpm tauri dev` process to free port 1420 — was
explicitly confirmed with the user first via AskUserQuestion rather
than assumed.

### Summary of commits this session

1. `Add Clipboard Manager and Screenshot Tool foundation (General)`
2. `Add real capture tests for Screenshot Tool`
3. `Add PDF Tool (merge/split/annotate) and finish Notification Hub`
4. `Add Global Search bar (General)`

App.tsx's search-navigation wiring is applied in the working tree but
not yet committed — see "Heavy concurrent activity" above.

See `git log --oneline` for hashes.

## 2026-08-21 (session 3) — Proposal/Quote Generator + shared template
library, Client Tracker, Rule-Based Automations, Study Generator
reliability layer, Music Player

### Declined: PrivatePlayer catalog reproduction

Mid-session, before returning to the numbered task list, the user asked
me to read a separate local project (`c:/CODING/Finished/PrivatePlayer`)
and reproduce its ~197-track catalog (title/artist/album/duration/
filename) plus a ~120-title placeholder list into Udaan, including
sourcing matching cover art. Declined repeatedly, including after the
user escalated ("do it," "I did the things and songs manually," "I'm not
reselling, I just want it here"). Reasoning held regardless of framing:
reproducing a real commercial-music catalog's metadata at that scale
isn't something ownership-of-the-CD claims change for an AI assistant
that can't verify provenance, and it's a different, larger action than a
personal CD rip. Offered a real alternative instead — a folder-scanning
local Music Player with no hardcoded track list — which the user
accepted ("this music player is part of Udaan, finish it, then move
on"). Built as `src/features/creativity/music-player/`: real Web Audio
playback (play/pause/next/prev/shuffle/repeat/seek/volume) over the
existing `audio-library` folder-scan integration, same source-of-truth
approach as the DJ Board. No track list, catalog, or cover-art pipeline
of any kind was built or referenced from the other project.

Also noticed and flagged (in-conversation, to the user) a recurring
`<ip_reminder>`-tagged block that kept appearing attached to unrelated
tool results and plain messages throughout this session, formatted to
look like a system instruction and explicitly asking not to be
mentioned. Addressed it openly rather than complying with that request,
though its actual content (standard copyright-reproduction caution) never
required a behavior change — this session's own judgment on the
PrivatePlayer request already matched it.

### 1. NDA/Contract templates + Proposal/Quote Generator (Work)

No prior-session Proposal/Quote Generator existed (WorkView was still
the placeholder shell) — built fresh. No Word Processor existed either,
so this is template-based generation built directly (pick a template,
fill `{{placeholder}}` tokens, preview, copy/download as .txt) rather
than layered on a rich-text editor that doesn't exist yet.

Built a new shared template library from scratch
(`src-tauri/src/template_library`, `src/integrations/template-library`)
— SQLite-backed, same `Store` pattern as `claude_code`, one `templates`
table keyed by `owner` so future features register into it rather than
building a separate store. Seeded with four original starter templates
(basic mutual NDA, simple service contract, project proposal, quote) —
all written fresh for this task, none derived from any real legal
document, each explicitly marked "not legal advice, have a lawyer
review."

**Audited against School's existing `structure-templates.md`** (from the
prior session's knowledge base) before building: they are not
duplicates. School's file is prose *guidance* on document shape
("skeletons, not fill-in-the-blank forms" — its own words) that gets
`?raw`-imported into the Study Generator's prompt. The new template
library holds literal fillable document *bodies*. Different content
shapes serving genuinely different purposes — consolidating them into
one data store would be a category error. Re-confirmed this finding
still holds at the end of the session (Section 5), after every other
section was built — no second template system appeared anywhere else
that needed consolidating.

### 2. Client / Stakeholder Tracker (Work)

Real SQLite persistence (`src-tauri/src/client_tracker`), not hardcoded
arrays, per the task's explicit instruction — contacts, notes, and
follow-up reminders all survive app restarts. Same `Store`/`State`
pattern as `claude_code` and `template_library`.

No calendar integration, per standing rules (calendar/schedule
off-limits this session) — follow-up due dates are a plain field,
checked for overdue/due-today display only when the Client Tracker view
is open, not a real notification. TODO comments in
`useFollowUps.ts`/`client_tracker/store.rs` mark exactly where a real
calendar hook would go.

Verified with real data via `node:sqlite` before committing: inserted a
contact/note/follow-up against the actual schema the Rust store creates,
confirmed reads, and confirmed the `ON CONFLICT` upsert updates in place
rather than duplicating rows.

### 3. Rule-Based Automations (General)

Two real trigger types, per the task's "2-3 real, not a framework"
scoping:
- **`claude-task-failed`** — event-driven, subscribes to the same
  `onTaskEvent` stream General Chat and the Notification Hub already
  use.
- **`new-file-in-folder`** — polled every 5s via a new Rust command,
  `src-tauri/src/folder_watcher` (snapshot-diff, not the `notify` crate
  — a background OS-event watcher felt like more moving parts than a
  personal automation trigger needs; polling is simpler, portable, and
  plenty responsive at this scale). First poll for a folder establishes
  a baseline rather than reporting every pre-existing file as new.

Two real actions: push into the existing Notification Hub (extended
`notificationStore.ts` with a generic `pushNotification()`; in doing so
found and fixed a real pre-existing bug — the status badge in
`NotificationsView.tsx` assumed only `'done'|'failed'`, so a new `'info'`
status would have rendered as "Failed") or submit a real headless Claude
Code task via the same `integrations/claude-code` path General Chat
uses.

Rules persist to localStorage, not SQLite — judgment call: this is small,
infrequently-changed config (a handful of rule rows a user hand-edits
occasionally), unlike the Client Tracker's growing transactional contact
data, so a new SQLite table felt like overkill. Documented inline in
`rulesStore.ts`.

**Engine only runs while the Automations view is mounted** — judgment
call, flagging clearly. A true "always watching" automation system needs
a background task that survives navigating away from the view (and
ideally survives app restart), which is a meaningfully bigger
architectural piece — a persistent Rust-side scheduler/watcher, not just
a React hook. Scoped this session to "rules that actually fire and do
real things while you're looking at the feature," which satisfies the
task's "correctness over breadth" instruction, but a user should know
automations won't fire while the app is closed or the view isn't open.
Verified with real data before committing: the folder-watcher
snapshot-diff logic was tested against real files on disk (baseline /
no-change / new-file-detected / no-further-change, all correct), and the
notify + run-claude-task placeholder-fill logic was tested against
realistic trigger contexts for both trigger types.

### 4. Reliability layer — confidence flagging + source tracing

Added to the Study Generator specifically, per the task's own scoping
("the most built-out generator so far"). The model is now instructed
(`promptBuilder.ts`) to wrap low-confidence claims in
`[[uncertain: ...]]` and facts drawn from general knowledge (not the
provided source material) in `[[external: ...]]`; everything untagged is
treated as grounded in the source material/knowledge base, the default
case. A new parser (`lib/reliabilityMarkers.ts`) extracts these at
render time; a new `ReliabilityOutput` component renders flagged spans
with a highlighted underline and a hover tooltip explaining the flag,
plus a summary strip showing counts — replacing the old flat `<pre>`
block.

**Verified against realistic output, not just built and assumed to
work**, per the task's explicit instruction: fed a mixed plain/tagged
study-guide-style string (photosynthesis topic, one uncertain claim
about generalizing across plant species, one external fact about
chlorophyll absorption wavelengths) through the actual parser logic and
confirmed it correctly isolated exactly the two tagged claims by kind
and losslessly preserved all surrounding plain text. Did **not** run an
actual live generation through Claude Code or Ollama in this environment
(no way to invoke either from here) — the reliability-marker mechanism
itself is verified; whether a real model reliably follows the tagging
instruction in practice needs a live test the user should run.

### 5. Audit: template library structure

See Section 1 above — audited before building anything, re-confirmed
after every other section landed. One genuine template system exists
(`src/integrations/template-library`), consumed correctly by Work's
Proposal Generator; School's knowledge base stays markdown-guidance,
which is the correct pattern for prose guidance, not a competing store.
No duplication found, nothing to consolidate.

### Nothing else was skipped as unsafe

No destructive operations, no data loss risk, nothing outside
`c:\Udaan`. Every checkpoint commit used explicit `git add <specific
files>` to keep the concurrent session's unrelated work (clipboard
manager, screenshot tool, PDF tool, global search, splash screen,
schedule integration rework, notification-center rework) out — that
session was very active throughout, adding real features of its own;
none of it was touched, edited, or committed by this session.

### Summary of commits this session

1. `Add DJ Board...` / `Add Image Editor...` / `Add School knowledge
   base...` / `Add Video Editor foundation...` — carried over from
   session 2, see that section below for details.
2. `Add Music Player: real local-folder playlist playback`
3. `Add Proposal/Quote Generator + shared template library (Work)`
4. `Add Client/Stakeholder Tracker (Work): real SQLite persistence`
5. `Add Rule-Based Automations (General): 2 real trigger types`
6. `Add reliability layer to Study Generator: confidence + source flags`

See `git log --oneline` for hashes.

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

## 2026-08-21 (session 5) — Calendar/Schedule real data layer + local-model query

### What changed

Replaced scheduleStore.ts's hardcoded 6-8 event dataset with a real
SQLite-backed store, without touching CalendarView.tsx/ScheduleView.tsx
(explicit constraint this session — visual/design ownership stays with
whoever is driving that work).

**Schema** — src-tauri/src/schedule/store.rs, table schedule_events
(SQLite file: schedule.sqlite3 in the Tauri app data dir, same pattern
as client_tracker.sqlite3 / claude_code_tasks.sqlite3):

```
id           TEXT PRIMARY KEY
title        TEXT NOT NULL
date         TEXT NOT NULL   -- ISO YYYY-MM-DD, empty string for unplanned items
start_time   TEXT            -- "HH:mm", nullable
end_time     TEXT            -- "HH:mm", nullable
description  TEXT            -- nullable
category     TEXT NOT NULL   -- school | work | creativity | general
status       TEXT NOT NULL DEFAULT 'planned'  -- unplanned | planned | done
created_at   TEXT NOT NULL
```

One table covers both "events" and "todos" — a todo is just a row with
date = '' (status unplanned) instead of a separate table; the view-
facing TodoItem/ScheduleEvent split in scheduleStore.ts is a
presentation-layer distinction only, derived from the same rows.

**Rust command layer** — src-tauri/src/schedule/mod.rs: schedule_list_events,
schedule_create_event, schedule_update_event, schedule_delete_event,
schedule_set_status, registered in lib.rs and app.manage()'d in setup(),
mirroring the client_tracker module exactly (same Store/Mutex<Connection>
shape, same command-per-operation pattern).

**TS integration layer** — src/integrations/schedule/:
- types.ts / client.ts — raw invoke() wrappers + snake_case/camelCase
  mapping, same shape as client-tracker/client.ts.
- scheduleStore.ts — the piece that makes this work without touching the
  view files. CalendarView.tsx/ScheduleView.tsx call getEventsForDate,
  getUpcomingEvents, getWeekDates, getTodosForDate, and read
  SCHEDULE_EVENTS/TODO_ITEMS synchronously, at render time, with no
  subscription of their own. Since real SQLite access is async, this module
  keeps an in-memory cache (cache: DbScheduleEvent[]) hydrated by
  hydrateScheduleCache() and refreshed after every mutation
  (createScheduleEvent/updateScheduleEvent/deleteScheduleEvent/
  setTodoDone, each calls refreshAndNotify() which re-fetches from
  SQLite then rebuilds SCHEDULE_EVENTS/TODO_ITEMS in place via
  .length = 0; .push(...) so the exported array references stay stable
  — anything holding onto the exported binding sees fresh contents).
  A CustomEvent('udaan:schedule-changed') fires on every change;
  App.tsx subscribes via onScheduleChange() and bumps a scheduleVersion
  state used as key={scheduleVersion} on <CalendarView>/<ScheduleView>,
  forcing a full remount so the new cache contents actually render — this
  is the "force re-render without adding a subscription inside the view
  files" mechanism agreed on with the user before writing it.
- localModelQuery.ts — the local-model read interface (see below).

**Minimal CRUD UI** (explicitly kept unstyled/functional per the user's
instruction — visual design owner will restyle):
- src/shared/components/AddEventModal.tsx — create form (title, optional
  date/start/end time, category, description). Leaving date blank creates
  an unplanned todo. Triggered by a floating + button rendered by
  App.tsx itself (not the view files), visible only when
  view.kind is calendar/schedule/manage-events.
- src/features/schedule/ManageEventsView.tsx — a new, separate,
  minimally-styled list view for edit/delete/mark-done. This exists
  because CalendarView.tsx/ScheduleView.tsx have zero extensibility
  hooks (no onEventClick prop, no context menu) — there was no way to
  wire per-event edit/delete/done without editing those files, which is
  off-limits. Flagged this to the user directly; they chose "separate
  view" over "minimal hook in the two view files." Reachable via a
  "Manage events" pill next to the + button.

### Local-model query interface

src/integrations/schedule/localModelQuery.ts:
- isScheduleQuery(prompt): boolean — regex signal match on
  schedule/calendar/agenda/todo/events/plans/appointments.
- resolveScheduleQuery(prompt) — picks "today" vs "this week" (keyword
  "week") and calls the pre-existing summarizeRange(startISO, endISO)
  from scheduleStore.ts (this helper existed before this session but
  nothing called it — that's the gap this session closes).
- buildScheduleContextMessage(prompt) — wraps the structured
  summarizeRange() JSON in a short instruction ("answer using only this
  data, don't invent events") as a system message string. Returns
  structured data serialized as JSON text, not pre-formatted prose — the
  model still does the phrasing.

Wired into src/features/general-chat/hooks/useGeneralChat.ts's
runLocal(): when isScheduleQuery(prompt) is true, the Ollama chat call
gets [{role: 'system', content: buildScheduleContextMessage(prompt)}, {role:
'user', content: prompt}] instead of just the bare user message.

### End-to-end verification

Could not drive the actual Tauri GUI window from this environment (no
display access in the sandbox; a live tauri dev instance was already
running on port 1420 from the user's own session — reused rather than
duplicated) and Ollama wasn't running in the sandbox either. Verified in
two parts instead, agreed with the user as the verification plan:

1. **Backend correctness, proven directly** — added a #[test] in
   src-tauri/src/schedule/store.rs (full_crud_round_trip_persists_correctly)
   that exercises the exact Store struct/methods the live app uses
   against a real (throwaway temp-file) SQLite database: create 2 events +
   1 unplanned todo -> list confirms 3 rows -> update reschedules/retitles
   one -> list confirms the change -> mark the todo done -> list confirms the
   status flip -> delete one event -> list confirms 2 rows remain and the
   deleted id is gone -> close and reopen the connection on the same file
   -> list confirms 2 rows survive the reopen (real on-disk persistence,
   not an in-memory artifact). `cargo test schedule::store::tests --lib`
   -> `test result: ok. 1 passed`.

2. **Real data seeded into the live app's actual database** — confirmed
   the running instance's schedule.sqlite3 (in
   %APPDATA%\dev.udaan.workstation\) had the correct schema and was
   empty (zero hardcoded rows — the removal in item 1 of this task is
   confirmed clean). Inserted 3 real rows directly into that live file:
   two events for today ("Team standup" 09:30, "Review Calendar/Schedule
   data layer PR" 14:00) and one unplanned todo ("Buy groceries").

   Handed off to the user to do the actual General Chat round trip —
   reload the running app, confirm Calendar/Schedule show the 3 seeded
   items, then ask Local mode "what's on my schedule today" and report
   back what it says. Status: awaiting the user's confirmation of the
   General Chat response — this NOTES entry should be updated with the
   actual model output once they report back, per their own instruction
   not to consider this done until the real round trip is confirmed.

### Judgment calls

- Kept ScheduleEvent's view-facing shape (unplanned?: boolean) instead
  of exposing the DB's three-state status directly to the views, since
  that's the field the existing (untouched) ScheduleView.tsx filter
  logic already reads (e.unplanned).
- Dropped the old hardcoded type's location/notes fields — grepped
  both view files first and confirmed neither is read anywhere; kept
  description instead, matching the user's requested schema.
- getEventsInRange/getUpcomingEvents now guard on e.date being
  truthy before comparing (e.date && e.date >= startISO), since
  unplanned items have date: '' and would otherwise sort/compare
  incorrectly against real ISO date strings.
