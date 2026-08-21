# Integrations

Connectors between the app shell and external/local processes. Each
integration is isolated in its own subfolder with a narrow, typed
interface exposed to `features/` — features should never reach into Tauri
commands or subprocess APIs directly.

All four integrations below are real and working, not stubs:

- **`claude-code/`** — wraps the Rust-side Claude Code CLI runner
  (`src-tauri/src/claude_code/`): submit a headless task, list/get task
  history, subscribe to live stdout/stderr/status events, open a task's
  working directory in VS Code, and check the `claude` CLI itself is
  installed and resolvable (`checkCli()` → `claude --version`).
- **`local-model/`** — chat completion against a local Ollama daemon
  (`isReachable()`, `chat()`, `listRunningModels()` via Ollama's
  `/api/ps`) and speech-to-text via a bundled faster-whisper script,
  invoked through Rust commands (`transcribe()` / `transcribeBytes()`).
- **`schedule/`** — a typed in-memory event/todo data module
  (`scheduleStore.ts`) shared by the Calendar and Schedule features and
  meant to be queryable by a local-model "what's on my schedule" request.
  Real query logic, but **no persistence yet** — data resets on reload.
- **`weather/`** — live current conditions + hourly forecast from
  Open-Meteo (no API key required).

There's also **`system-health/`**, added alongside the other four for the
System Health view — wraps a Rust `sysinfo`-backed command
(`system_health_stats`) for real RAM and per-disk usage.

Not yet built: MCP tool connectors, and any scrapers/third-party APIs
beyond weather.
