# Integrations

Future home for connectors between the app shell and external/local
processes — Claude Code SDK/CLI, local model runners (llama.cpp, Ollama,
etc.), MCP tool servers, and any scrapers or third-party APIs.

Nothing lives here yet. When integrations are added, keep the same
principle as `features/`: each integration is isolated in its own
subfolder (e.g. `integrations/claude-code/`, `integrations/llama-cpp/`)
with a narrow, typed interface exposed to `features/` — features should
never reach into Tauri commands or subprocess APIs directly.
