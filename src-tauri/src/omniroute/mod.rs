mod process;

pub use process::OmniRouteProcess;

use tauri::State;
use tokio::process::Command;

/// Port OmniRoute's HTTP server listens on — matches `OMNIROUTE_URL` in
/// `src/integrations/omniroute/client.ts`.
const OMNIROUTE_PORT: u16 = 20128;

/// Path to the pidfile OmniRoute's own `serve --daemon` mode writes for
/// the real, detached server process (`~/.omniroute/server/.pid`, a plain
/// decimal PID) when it does write one. NOT reliable on its own — directly
/// confirmed empty/absent while a genuinely running, reachable OmniRoute
/// instance still had its server process alive (the daemon apparently
/// doesn't always write or keep this file across versions/restarts), so
/// `find_daemon_pid` below only tries this first and falls back to
/// resolving the PID by the port OmniRoute actually listens on.
fn pidfile_path() -> Option<std::path::PathBuf> {
  Some(dirs::home_dir()?.join(".omniroute").join("server").join(".pid"))
}

fn read_pidfile() -> Option<u32> {
  let contents = std::fs::read_to_string(pidfile_path()?).ok()?;
  contents.trim().parse().ok()
}

/// Finds the PID of whatever process is actually listening on OmniRoute's
/// port — the general, version-independent way to identify the real daemon
/// process regardless of whether it wrote a pidfile this run. Uses
/// `netstat -ano` (built into Windows, no extra dependency) rather than a
/// raw syscall/crate, since this only needs to run on the rare Stop-without-
/// a-tracked-PID path, not anything performance-sensitive.
#[cfg(target_os = "windows")]
fn find_pid_by_port(port: u16) -> Option<u32> {
  let output = crate::engine::process::hidden("netstat").args(["-ano", "-p", "TCP"]).output().ok()?;
  let text = String::from_utf8_lossy(&output.stdout);
  let needle = format!(":{port}");
  for line in text.lines() {
    let cols: Vec<&str> = line.split_whitespace().collect();
    // "  TCP    0.0.0.0:20128    0.0.0.0:0    LISTENING    16784"
    if cols.len() >= 5 && cols[0] == "TCP" && cols[1].ends_with(&needle) && cols[3] == "LISTENING" {
      if let Ok(pid) = cols[4].parse() {
        return Some(pid);
      }
    }
  }
  None
}

#[cfg(not(target_os = "windows"))]
fn find_pid_by_port(port: u16) -> Option<u32> {
  // `lsof -ti tcp:PORT -sTCP:LISTEN` prints just the PID(s), one per line.
  let output = crate::engine::process::hidden("lsof")
    .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
    .output()
    .ok()?;
  String::from_utf8_lossy(&output.stdout).lines().next()?.trim().parse().ok()
}

/// The real daemon PID, tried in order of reliability: OmniRoute's own
/// pidfile first (fastest, no subprocess), then whatever process actually
/// holds OmniRoute's port open — the fallback that works even when the
/// pidfile is missing/stale, which is the common case in practice.
fn find_daemon_pid() -> Option<u32> {
  read_pidfile().or_else(|| find_pid_by_port(OMNIROUTE_PORT))
}

#[cfg(target_os = "windows")]
pub(crate) fn kill_pid(pid: u32) {
  // `taskkill /F` by PID — necessary (unlike a process this app holds a
  // real `tokio::process::Child` handle for, spawned directly) because the
  // daemon PID here comes from OmniRoute's
  // own pidfile, not from a `Child` this process ever spawned: `--daemon`
  // mode forks the real server into its own detached process and the
  // wrapper CLI we `spawn()`'d exits immediately, so there is no `Child`
  // handle to kill through by the time Stop is ever called.
  let _ = crate::engine::process::hidden("taskkill")
    .args(["/PID", &pid.to_string(), "/F"])
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status();
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn kill_pid(pid: u32) {
  let _ = crate::engine::process::hidden("kill").arg("-9").arg(pid.to_string()).status();
}

#[tauri::command]
pub async fn omniroute_start(state: State<'_, OmniRouteProcess>) -> Result<(), String> {
  {
    let guard = state.0.lock().unwrap();
    if guard.is_some() {
      return Ok(()); // already running one we started
    }
  }

  // `--daemon` forks the real server as its OWN detached background
  // process and prints its PID, then the wrapper CLI we spawn here exits
  // itself almost immediately (verified directly against the installed
  // CLI) — that quick exit is the daemon starting up successfully, not a
  // crash or a port conflict. An earlier version of this command treated
  // any exit within 600ms as failure, which meant a normal, successful
  // daemon start was unconditionally reported as an error every time —
  // the real bug behind "click Start, it goes off."
  //
  // `omniroute` on Windows is an npm-global `.cmd` shim, not a real .exe
  // (confirmed by inspection: AppData\Roaming\npm\omniroute.cmd). Windows'
  // `CreateProcess` — what `std`/`tokio::process::Command` call directly —
  // does NOT resolve or execute .cmd/.bat files the way a shell does, so
  // `Command::new("omniroute")` was silently failing to ever spawn
  // anything on Windows even though the exact same command works fine
  // typed into a real terminal (which performs that resolution itself).
  // Same fix `claude_code::exe::resolve` already applies for the `claude`
  // CLI, inlined here rather than reaching across modules for two lines.
  let omniroute_cmd = if cfg!(windows) { "omniroute.cmd".to_string() } else { "omniroute".to_string() };
  let status = crate::engine::process::hidden_async(omniroute_cmd)
    .arg("serve")
    .arg("--daemon")
    .arg("--no-open")
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status()
    .await
    .map_err(|e| format!("Could not start \"omniroute serve\": {e}. Is OmniRoute installed (npm install -g omniroute) and on PATH?"))?;

  if !status.success() {
    return Err(format!("\"omniroute serve --daemon\" exited with a failure status ({status})."));
  }

  // The daemon may write its own pidfile as part of starting up, but
  // isn't guaranteed to (see find_daemon_pid's doc comment) — give it a
  // brief moment to come up, then resolve its real PID either way (pidfile
  // if present, otherwise by the port it's now listening on) before
  // considering this a successful start.
  tokio::time::sleep(std::time::Duration::from_millis(400)).await;
  let Some(pid) = find_daemon_pid() else {
    return Err("OmniRoute's daemon started but its process couldn't be found (no pidfile, and nothing listening on its port yet) — cannot confirm it's actually running.".to_string());
  };

  *state.0.lock().unwrap() = Some(pid);
  Ok(())
}

#[tauri::command]
pub async fn omniroute_stop(state: State<'_, OmniRouteProcess>) -> Result<(), String> {
  // Prefer the PID this app itself tracked from starting the daemon, but
  // fall back to resolving the real daemon PID (pidfile, then port lookup)
  // when Udaan didn't start it — so stopping from here works whether Udaan
  // launched it, a separate terminal did, or another tool did.
  let tracked_pid = state.0.lock().unwrap().take();
  let pid = match tracked_pid {
    Some(pid) => pid,
    None => find_daemon_pid()
      .ok_or_else(|| "OmniRoute doesn't appear to be running — no pidfile, and nothing is listening on its port.".to_string())?,
  };
  kill_pid(pid);
  let _ = std::fs::remove_file(pidfile_path().unwrap_or_default());
  Ok(())
}

/// True only if *this app* started the currently-tracked daemon — not a
/// general "is OmniRoute running" check (that's `isReachable()` on the
/// frontend, via the HTTP API, which also covers an externally-started
/// instance).
#[tauri::command]
pub async fn omniroute_started_by_app(state: State<'_, OmniRouteProcess>) -> Result<bool, String> {
  Ok(state.0.lock().unwrap().is_some())
}
