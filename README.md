# Udaan

A personal Windows desktop workstation app: a chat assistant, a calendar,
a file explorer, a document reader, and a small creative studio, all built
as one native Tauri app with its own custom taskbar/shell experience.

> Status: General Chat, Calendar, File Explorer, Document Reader, and
> Studio are all real and working — see "What's built" below. There is no
> placeholder-category shell left in the app; every visible destination
> does something real.

## Architecture

### Stack: Tauri v2 + React + TypeScript + Vite + Tailwind CSS v4

| Concern                 | Choice                 | Why                                                                                                                                                                 |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                   | **Tauri v2** (Rust)    | Small binaries, low idle CPU/RAM vs. Electron, and a real native process layer for subprocess/window management (OmniRoute, Claude Code CLI, the custom taskbar).  |
| UI                      | **React + TypeScript** | Rich, custom, animated UI; TypeScript for compile-time safety across a growing native surface.                                                                     |
| Build tool              | **Vite**               | Fast HMR, first-class Tauri integration.                                                                                                                            |
| Styling / design tokens | **Tailwind CSS v4**    | Utility-first, maps cleanly onto a CSS-custom-property token system (see below); v4's `@theme` directive lets tokens double as Tailwind's config.                   |
| Package manager         | **pnpm**               | Fast, disk-efficient.                                                                                                                                               |

**Why not Electron:** Electron bundles a full Chromium + Node runtime per
app; for a workstation-class app that manages subprocesses and a custom
taskbar continuously in the background, that overhead is directly at odds
with "fast and smooth." Tauri uses the OS's native webview and a Rust
backend instead.

### App shell: two permanent tabs + full-screen overlays

The main window has exactly two permanently-mounted destinations, switched
via the sidebar (`src/shared/components/Sidebar.tsx`) and toggled with
CSS `hidden` rather than mount/unmount (`src/app/App.tsx`) — this avoids
re-fetching chat history or losing scroll position on every tab switch:

- **General Chat** (`src/features/general-chat/`) — the default view.
- **Calendar** (`src/features/calendar/`) — SQLite-backed events/todos.

Everything else — **Studio** (a small audio/instrument playground),
**File Explorer**, and **Document Reader** — is lazy-loaded and mounted
as a full-screen overlay on top of the two-tab panel, opened on demand
(e.g. from the Launchpad or a "open with" action) and unmounted when
closed. None of them has its own route/window; they're conditionally
rendered `absolute inset-0` layers inside `App.tsx`.

Udaan also runs its own custom taskbar (a separate always-on-top Tauri
window, `src/features/taskbar/`) that can replace the Windows taskbar
entirely, plus a Launchpad (Start-menu-style app grid) and an idle-
triggered clock screensaver.

### AI backend: OmniRoute only, no accounts

General Chat's sole AI backend is **OmniRoute**, a local multi-provider
proxy reachable at `http://localhost:20128`, running against its no-auth
free-tier backends (`opencode`, `felo-web`) — no provider account, paid
API key, or OAuth login is connected to it, by deliberate constraint.
Ollama-based local chat (and the voice input that ran through the same
runtime) was fully removed in an earlier pass; there is no local-model
chat path left in the app today.

### Folder structure

```
src/
  app/              # App shell: root component (App.tsx), sidebar-view state, apps registry
  apps/             # Studio (audio/instrument playground) — its own overlay app
  features/         # One folder per feature, isolated from its siblings
    general-chat/   # Default tab — OmniRoute chat, SQLite session history
    calendar/       # Default tab — SQLite events/todos
    file-explorer/  # Full-screen overlay, opened on demand
    document-reader/# Full-screen overlay — renders .txt/.md/.docx/.pdf
    taskbar/        # Separate always-on-top window
    screensaver/     # Idle-triggered clock overlay
    splash/         # Startup splash screen
  shared/           # Cross-cutting, reusable code
    components/     # Design-system components (Sidebar, TopBar, Launchpad, ...)
    hooks/
    lib/
  integrations/     # Typed, narrow wrappers around Tauri commands: omniroute,
                     # schedule, weather (Open-Meteo), general-chat persistence,
                     # file-explorer, document-reader, installed-apps, etc.
  styles/
    tokens.css       # Design tokens as CSS custom properties (source of truth)
    theme.css        # Tailwind v4 @theme mapping + global base styles

src-tauri/          # Rust backend (Tauri). One module per feature under
                     # src/ (general_chat, file_explorer, document_reader,
                     # schedule, omniroute, taskbar, ...), each owning its
                     # own SQLite store where it needs persistence.
```

**Rule of thumb:** `features/*` modules should never import from each
other, and should never reach into `src-tauri` directly — everything
native goes through `integrations/`, which exposes a typed, narrow
interface. This keeps each feature swappable/removable and keeps the
native surface area auditable in one place.

### Persistence: SQLite throughout, not in-memory

Every feature that needs to remember something across restarts owns a
SQLite database file under the app's data directory (`app_data_dir()`),
opened via a shared `configure_connection()` helper (`src-tauri/src/db.rs`)
that sets WAL mode and a busy timeout. General Chat, Calendar/Schedule,
Document Reader (recent files + reading position), Claude Code task
history, and the template library all persist this way — there is no
feature left relying on in-memory-only or localStorage-only state for
data that should survive a restart.

### Design tokens

Dark-mode-first, glassmorphic. Tokens live in
[`src/styles/tokens.css`](src/styles/tokens.css) as CSS custom properties
(colors, spacing, radius, blur, typography, shadows, motion), then get
mapped into Tailwind's `@theme` in
[`src/styles/theme.css`](src/styles/theme.css) so both plain CSS and
Tailwind utilities read from the same source of truth.

Background images (wallpapers) are user-selectable via a wallpaper
picker, persisted, and rendered full-bleed behind the glass UI
(`src/shared/components/AmbientBackground.tsx`).

### Tooling

- **Linting:** [oxlint](https://oxc.rs) — fast, zero-config Rust-based linter with React/TS rule sets.
- **Formatting:** Prettier + `prettier-plugin-tailwindcss` (sorts utility classes automatically).
- **CI:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint, format-check, and a frontend build on every push/PR. It does **not** build the Tauri/Rust binary — that needs a platform matrix and system dependencies (WebView2, MSVC Build Tools, etc.).

## Getting started

Prerequisites: [pnpm](https://pnpm.io), [Rust](https://rustup.rs), Tauri's
platform prerequisites (on Windows: MSVC C++ Build Tools + WebView2 — see
[Tauri's setup guide](https://v2.tauri.app/start/prerequisites/)), and
OmniRoute running locally at `localhost:20128` for General Chat to work.

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

- **General Chat** (`src/features/general-chat/`, `src-tauri/src/general_chat/`) — chat over OmniRoute, SQLite-backed session history, tool-calling support for Schedule actions, and a small cross-session key-fact memory store.
- **Calendar** (`src/features/calendar/`, `src-tauri/src/schedule/`) — SQLite-backed events/todos, shared with General Chat's schedule-assistant queries via one `schedule_events` table.
- **File Explorer** (`src/features/file-explorer/`, `src-tauri/src/file_explorer/`) — directory browsing, search, file operations (copy/move/rename/delete-to-trash/restore), previews and thumbnails, "open with," drag-drop.
- **Document Reader** (`src/features/document-reader/`, `src-tauri/src/document_reader/`) — renders `.txt`/`.md`/`.docx`/`.pdf`, remembers recent files and reading position, includes local neural TTS (Piper) playback.
- **Studio** (`src/apps/studio/`) — an audio/instrument playground (piano, drums, guitar, and other sampled instruments) via Tone.js.
- **Udaan taskbar + Launchpad** (`src/features/taskbar/`, `src/shared/components/Launchpad.tsx`) — a custom always-on-top taskbar that can replace the Windows taskbar, plus a Start-menu-style app launcher for installed Windows apps.
- **Weather** (`src/integrations/weather/`) — live Open-Meteo forecast, no API key required.
- **Wallpaper system** (`src/shared/components/AmbientBackground.tsx`, `src/shared/hooks/useWallpaper.ts`) — user-selectable background art, persisted, rendered behind the glass UI.
- **Screensaver** (`src/features/screensaver/`) — idle-triggered and manually-triggered full-screen clock.

## What's not built yet

Intentionally out of scope so far — tracked here so it's not forgotten:

- An agentic tool-calling loop in General Chat (file read/write, run commands) is in active development, sandboxed to a dedicated workspace directory — see the most recent session report for status.
- Shell/command execution as an agent tool — deferred behind file-tool hardening, needs its own security-focused design pass.
- MCP tool connectors.
- A mobile companion app and its remote API.
