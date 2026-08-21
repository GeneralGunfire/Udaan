# AI Workstation

A personal, cross-platform desktop app that houses a Claude Code frontend,
local AI model orchestration, a model router/dashboard, a task queue, a
schedule app, and various custom tools — organized under four top-level
categories: **School**, **Work**, **Creativity**, **General**.

> Status: **scaffolding only.** No feature logic, no Claude Code SDK
> integration, no local model orchestration, no MCP tooling yet. This repo
> currently renders an empty shell with the four categories stubbed out.

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
  integrations/      # Future home for Claude Code SDK, local model runners,
                     # MCP tool connectors — isolated per-integration,
                     # exposing narrow typed interfaces to features/
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

## What's not built yet

Intentionally out of scope for this pass — tracked here so it's not
forgotten, not because it's undecided:

- Claude Code SDK/CLI integration (spawning, streaming output, session state)
- Local model orchestration (llama.cpp, model router/dashboard)
- Task queue and schedule app
- MCP tool connectors
- Any real feature logic inside School / Work / Creativity / General
- Mobile companion app and its remote API
- Background image system / asset pipeline
- Tauri capabilities/permissions hardening (currently default-generated)
