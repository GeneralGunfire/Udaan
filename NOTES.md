# NOTES

Running log of judgment calls, ambiguities, and anything deliberately left
unfinished during autonomous feature work. Newest entries at the bottom of
each dated section; new sessions get a new dated section — never overwrite
prior entries.

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
