# AI Workstation

A personal, cross-platform desktop app that houses a Claude Code frontend,
local AI model orchestration, a model router/dashboard, a task queue, a
schedule app, and various custom tools — organized under four top-level
categories: **School**, **Work**, **Creativity**, **General**.

> Status: **General category is real and working.** Claude Code CLI
> integration (spawn, stream, persist), local model orchestration (Ollama
> chat + faster-whisper transcription), a working task queue (Sessions),
> a schedule/calendar app, live model/system/integration dashboards, a
> local account profile, and real notifications are all built and wired
> up — see "What's built" below. School, Work, and Creativity are still
> placeholder shells with no feature logic; MCP tooling and the mobile
> companion app are not started.

## Architecture decisions

### Stack: Tauri v2 + React + TypeScript + Vite + Tailwind CSS v4

| Concern                 | Choice                 | Why                                                                                                                                                                 |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                   | **Tauri v2** (Rust)    | Small binaries, low idle CPU/RAM vs. Electron, and a real native process layer for spawning/managing Claude Code, llama.cpp, and other local subprocesses reliably. |
| UI                      | **React + TypeScript** | Mainstream ecosystem for building a rich, custom, animated UI; TypeScript for compile-time safety as the app grows across four independent modules.                 |
| Build tool              | **Vite**               | Fast HMR, first-class Tauri integration.                                                                                                                            |
| Styling / design tokens | **Tailwind CSS v4**    | Utility-first, maps cleanly onto a CSS-custom-property token system (see below); v4's `@theme` directive lets tokens double as Tailwind's config.                   |
| Package manager         | **pnpm**               | Fast, disk-efficient; workspace-ready if any part of this ever needs to split into separate packages.                                                               |

**Why not Electron:** Electron bundles a full Chromium + Node runtime per
app; for a workstation-class app meant to run local model inference and
manage subprocesses continuously in the background, that overhead is
directly at odds with "fast and smooth." Tauri uses the OS's native
webview and a Rust backend, which is both lighter and better suited to
process supervision.

**Mobile companion (future):** the plan is a Rust-backed local HTTP/WebSocket
API exposed by the Tauri backend, which a separate mobile client (React
Native, or Tauri's own mobile target) talks to remotely. Not built yet —
noted here so the eventual API layer isn't designed as an afterthought.

### Folder structure

```
src/
  app/              # App shell: root component, category registry, routing-level state
  features/         # One folder per top-level category, fully isolated
    school/
    work/
    creativity/
    general/
  shared/           # Cross-cutting, reusable code
    components/     # Design-system components (GlassPanel, Sidebar, ...)
    hooks/
    lib/
  integrations/      # Claude Code CLI, local model (Ollama/whisper), weather
                     # (Open-Meteo), schedule data, and system-health —
                     # isolated per-integration, exposing narrow typed
                     # interfaces to features/. All real, not stubs.
  styles/
    tokens.css       # Design tokens as CSS custom properties (source of truth)
    theme.css        # Tailwind v4 @theme mapping + global base styles

src-tauri/          # Rust backend (Tauri). Subprocess management, local
                     # filesystem access, and future native APIs live here.
```

**Rule of thumb:** `features/*` modules should never import from each
other, and should never reach into `src-tauri` or subprocess APIs
directly — everything native goes through `integrations/`, which exposes
a typed, narrow interface. This keeps each category swappable/removable
and keeps the native surface area auditable in one place.

### Design tokens

Dark-mode-first, glassmorphic. Tokens live in
[`src/styles/tokens.css`](src/styles/tokens.css) as CSS custom properties
(colors, spacing, radius, blur, typography, shadows, motion), then get
mapped into Tailwind's `@theme` in
[`src/styles/theme.css`](src/styles/theme.css) so both plain CSS and
Tailwind utilities read from the same source of truth.

Each of the four categories has its own accent color
(`--color-accent-school`, `--color-accent-work`,
`--color-accent-creativity`, `--color-accent-general`) used sparingly for
wayfinding (e.g. the sidebar's active-item indicator), not as a full
theme swap.

Background images (abstract art) are expected to be supplied later and
layered behind the glass surfaces per-window; the glass tokens
(`--color-glass-*`, `--blur-panel`, `--blur-sidebar`) are tuned to sit on
top of a busy image without becoming unreadable.

### Tooling

- **Linting:** [oxlint](https://oxc.rs) (already Vite's default in this
  template) — fast, zero-config Rust-based linter with React/TS rule sets.
- **Formatting:** Prettier + `prettier-plugin-tailwindcss` (sorts utility
  classes automatically).
- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs
  lint, format-check, and a frontend build on every push/PR. It does
  **not** yet build the Tauri/Rust binary — that needs a platform matrix
  and system dependencies (WebView2, MSVC Build Tools, etc.) and will be
  added once there's an actual native surface worth gating on.

## Getting started

Prerequisites: [pnpm](https://pnpm.io), [Rust](https://rustup.rs), and
Tauri's platform prerequisites (on Windows: MSVC C++ Build Tools +
WebView2 — see [Tauri's setup guide](https://v2.tauri.app/start/prerequisites/)).

```bash
pnpm install       # install JS/TS dependencies
pnpm dev           # run the Vite dev server only (web preview, no native shell)
pnpm tauri dev     # run the full desktop app (native window, hot reload)
pnpm build          # type-check + build the frontend
pnpm tauri build    # build the installable desktop binary
pnpm lint           # lint
pnpm format         # format
```

## What's built

Real, working, not mock data (all under the **General** category, plus
supporting `integrations/`):

- **Claude Code integration** (`src/integrations/claude-code/`,
  `src-tauri/src/claude_code/`) — submits headless `claude` CLI runs,
  streams stdout/stderr live over a Tauri event, persists task history to
  SQLite, opens a task's working directory in VS Code, and can check the
  CLI itself is installed/resolvable (`claude --version`).
- **Task Queue** (General → Task Queue, `src/features/sessions/`) — the
  real UI for the above: submit tasks, watch live output, browse history.
- **Local model integration** (`src/integrations/local-model/`) — chat
  completion via a local Ollama daemon (`qwen2.5:1.5b` by default) and
  speech-to-text via a bundled faster-whisper (`transcribe.py`), reachable
  from Rust commands for zero-network transcription.
- **General Chat router** (`src/features/general-chat/`) — routes each
  message to either the local model or a Claude Code task based on a mode
  heuristic, with a live session panel and streaming message bubbles.
  This wiring is complete; there is no per-request telemetry/aggregation
  yet (see the Model Dashboard's "Router stats" placeholder).
- **Model Dashboard** (General → Model Dashboard) — live Ollama
  reachability + loaded-model info, live Claude Code task counts by
  status.
- **System Health** (General → System Health) — real RAM/disk usage via a
  Rust `sysinfo`-backed command, plus live Ollama and Claude CLI checks.
- **Integrations status** (General → Integrations) — a live
  connected/error check per integration, run on demand.
- **Account** (General → Account) — a local-only profile (name +
  preference notes) in localStorage. No auth, no account server, no
  sync — this is a single-user local app by design.
- **Notifications** (General → Notification) — real entries generated
  from Claude Code task completions, with a live unread-count badge.
- **Schedule / Calendar** (`src/integrations/schedule/`,
  `src/features/schedule/`, `src/features/calendar/`) — a real UI over a
  typed in-memory event/todo data module. **No persistence yet** — data
  resets on reload; this is placeholder *data*, not placeholder logic.
- **Weather** (`src/integrations/weather/`) — live Open-Meteo forecast,
  no API key required.
- **Wallpaper system** (`src/shared/components/AmbientBackground.tsx`,
  `src/shared/hooks/useWallpaper.ts`, `src/app/wallpapers.ts`) — real,
  working: user-selectable background art (WallpaperPicker), persisted
  choice, rendered full-bleed behind the glass UI.

## What's not built yet

Intentionally out of scope so far — tracked here so it's not forgotten,
not because it's undecided:

- Any real feature logic inside School / Work / Creativity (still
  placeholder shells — General is the only category with working
  features so far)
- Schedule/Calendar persistence (currently in-memory, resets on reload)
- MCP tool connectors
- Router-level telemetry/aggregation (per-request routing already works;
  there's just no stats view over it yet)
- Mobile companion app and its remote API
- Tauri capabilities/permissions hardening (currently default-generated)
