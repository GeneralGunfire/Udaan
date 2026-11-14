//! Sandboxed file tools for General Chat's agentic tool-calling loop.
//!
//! Every command here operates ONLY inside one dedicated directory
//! (`{app_data_dir}/agent-workspace/`) — never Documents, Desktop, or any
//! other user directory. This is a deliberate, narrow first version: the
//! containment can't come from Tauri's `fs:` capability manifest (File
//! Explorer and the audio/asset libraries already prove that custom Rust
//! commands using raw `std::fs` bypass that entirely), so every command
//! below resolves its path argument through `resolve_in_workspace` before
//! touching disk. That function is the single security-critical piece of
//! this module — see its own doc comment and the test module below.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const WORKSPACE_DIR_NAME: &str = "agent-workspace";

/// Returns (creating if necessary) the one directory the agentic loop's
/// file tools may ever touch.
pub fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let root = data_dir.join(WORKSPACE_DIR_NAME);
  std::fs::create_dir_all(&root).map_err(|e| format!("Failed to create agent workspace: {e}"))?;
  Ok(root)
}

/// Resolves a model-supplied relative path against the workspace root and
/// verifies the result is actually inside it, rejecting anything that
/// would escape — `../../` traversal, an absolute path (including a
/// Windows drive-letter path or a UNC path like `\\server\share`), or a
/// symlink inside the workspace that points outside it.
///
/// Two path arguments come back on success:
/// - `existing`: the canonicalized real path, when the target already
///   exists on disk (canonicalization requires the path to exist, so this
///   is `None` for a not-yet-created file/directory).
/// - `target`: the path to actually operate on — for a non-existent
///   target (e.g. a file about to be created by `agent_write_file`), this
///   is the canonicalized *parent* directory joined back with the
///   requested file name, so a symlinked parent is still caught.
///
/// Containment is enforced by canonicalizing (which resolves `..` and
/// symlinks) and then checking the result has the canonicalized workspace
/// root as a prefix — never by comparing un-resolved strings, which is
/// exactly what traversal/symlink attacks defeat.
#[derive(Debug)]
pub struct ResolvedPath {
  /// The path to actually pass to `std::fs` calls.
  pub target: PathBuf,
  /// Whether `target` already exists on disk.
  pub exists: bool,
}

pub fn resolve_in_workspace(root: &Path, relative_path: &str) -> Result<ResolvedPath, String> {
  if relative_path.trim().is_empty() {
    return Err("Path must not be empty".to_string());
  }

  let requested = Path::new(relative_path);

  // Reject absolute paths outright (covers `C:\...`, `/...`, and — since
  // Rust's `Path::is_absolute` on Windows also treats a bare `\` or a
  // drive-relative `C:foo` as needing rejection via the has_root/prefix
  // checks below — most drive-letter and rooted forms). A relative path
  // from the model must never be allowed to opt itself out of being
  // joined under `root` in the first place.
  if requested.is_absolute() {
    return Err(format!("Absolute paths are not allowed: {relative_path}"));
  }
  // `Path::is_absolute` on Windows returns false for a drive-relative path
  // like `C:foo` (no root component) and for a UNC-ish `\\server\share`
  // is actually absolute already and caught above — but a bare-rooted
  // path like `\Windows` (root without a drive prefix) is also not
  // `is_absolute()` on Windows, since it has no prefix component. Guard
  // that explicitly: any component starting with `\` or containing a `:`
  // is rejected, since neither can appear in a legitimate relative path.
  let raw = relative_path.replace('/', "\\");
  if raw.starts_with('\\') || raw.contains(':') {
    return Err(format!("Path escapes the workspace: {relative_path}"));
  }

  // Reject `..` components before ever touching disk — belt-and-braces
  // alongside the canonicalize-then-prefix-check below, and gives a
  // clearer error message for the common case.
  for component in requested.components() {
    if matches!(component, std::path::Component::ParentDir) {
      return Err(format!("Path must not contain '..': {relative_path}"));
    }
  }

  let canonical_root = root
    .canonicalize()
    .map_err(|e| format!("Failed to resolve workspace root: {e}"))?;

  let joined = canonical_root.join(requested);

  // If the target already exists, canonicalize it directly — this is the
  // step that actually resolves any symlink sitting at or inside the
  // target and proves where it really points.
  if let Ok(canonical_target) = joined.canonicalize() {
    if !canonical_target.starts_with(&canonical_root) {
      return Err(format!("Path escapes the workspace: {relative_path}"));
    }
    return Ok(ResolvedPath { target: canonical_target, exists: true });
  }

  // Target doesn't exist yet (e.g. a file about to be written). Walk up
  // to the nearest existing ancestor, canonicalize *that* (resolving any
  // symlink along the way), and confirm it's still inside the workspace —
  // then re-join the non-existent remainder back onto the resolved
  // ancestor. This stops a symlinked intermediate directory from being
  // used to escape the workspace for a not-yet-created file.
  let mut existing_ancestor = joined.as_path();
  let mut remainder: Vec<&std::ffi::OsStr> = Vec::new();
  loop {
    match existing_ancestor.parent() {
      Some(parent) => {
        remainder.push(
          existing_ancestor
            .file_name()
            .ok_or_else(|| format!("Invalid path: {relative_path}"))?,
        );
        if parent.exists() {
          existing_ancestor = parent;
          break;
        }
        existing_ancestor = parent;
      }
      None => return Err(format!("Path escapes the workspace: {relative_path}")),
    }
  }

  let canonical_ancestor = existing_ancestor
    .canonicalize()
    .map_err(|e| format!("Failed to resolve path: {e}"))?;
  if !canonical_ancestor.starts_with(&canonical_root) {
    return Err(format!("Path escapes the workspace: {relative_path}"));
  }

  let mut resolved = canonical_ancestor;
  for part in remainder.into_iter().rev() {
    resolved.push(part);
  }

  // Final check on the fully-reassembled path — belt-and-braces in case
  // any remainder component was itself `..` (already rejected above, but
  // this keeps the invariant enforced at the single choke point rather
  // than relying solely on the earlier component scan).
  if !resolved.starts_with(&canonical_root) {
    return Err(format!("Path escapes the workspace: {relative_path}"));
  }

  Ok(ResolvedPath { target: resolved, exists: false })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentFileEntry {
  pub name: String,
  pub is_dir: bool,
  pub size_bytes: u64,
}

/// Returns the workspace's absolute path, so the UI can show the user
/// exactly where to drop files in via normal Windows Explorer.
#[tauri::command(async)]
pub fn agent_workspace_path(app: AppHandle) -> Result<String, String> {
  Ok(workspace_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn agent_read_file(app: AppHandle, relative_path: String) -> Result<String, String> {
  let root = workspace_root(&app)?;
  let resolved = resolve_in_workspace(&root, &relative_path)?;
  if !resolved.exists {
    return Err(format!("File not found: {relative_path}"));
  }
  std::fs::read_to_string(&resolved.target)
    .map_err(|e| format!("Failed to read \"{relative_path}\": {e}"))
}

#[tauri::command(async)]
pub fn agent_write_file(app: AppHandle, relative_path: String, content: String) -> Result<(), String> {
  let root = workspace_root(&app)?;
  let resolved = resolve_in_workspace(&root, &relative_path)?;
  if let Some(parent) = resolved.target.parent() {
    std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
  }
  std::fs::write(&resolved.target, content).map_err(|e| format!("Failed to write \"{relative_path}\": {e}"))
}

#[tauri::command(async)]
pub fn agent_list_directory(app: AppHandle, relative_path: String) -> Result<Vec<AgentFileEntry>, String> {
  let root = workspace_root(&app)?;
  // An empty path means "the workspace root itself" — list_dir's own
  // resolve_in_workspace rejects an empty string, so special-case it here
  // rather than loosening the shared helper's validation for every caller.
  let dir = if relative_path.trim().is_empty() {
    root.clone()
  } else {
    let resolved = resolve_in_workspace(&root, &relative_path)?;
    if !resolved.exists {
      return Err(format!("Directory not found: {relative_path}"));
    }
    resolved.target
  };
  if !dir.is_dir() {
    return Err(format!("Not a directory: {relative_path}"));
  }
  let read_dir = std::fs::read_dir(&dir).map_err(|e| format!("Failed to list \"{relative_path}\": {e}"))?;
  let mut entries = Vec::new();
  for entry in read_dir {
    let entry = entry.map_err(|e| e.to_string())?;
    let metadata = entry.metadata().map_err(|e| e.to_string())?;
    entries.push(AgentFileEntry {
      name: entry.file_name().to_string_lossy().to_string(),
      is_dir: metadata.is_dir(),
      size_bytes: if metadata.is_dir() { 0 } else { metadata.len() },
    });
  }
  entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  Ok(entries)
}

/// Copies a file the user picked (via a native "Add file to workspace"
/// dialog, an unrestricted picker — the same pattern Document Reader
/// already uses) into the workspace under its own file name. `source_path`
/// is NOT run through `resolve_in_workspace` — it's an absolute path
/// chosen by the user via a native dialog, not a model-supplied relative
/// path, so the containment boundary that matters here is the
/// *destination* (must land inside the workspace), which this still
/// enforces via the same helper.
#[tauri::command(async)]
pub fn agent_workspace_add_file(app: AppHandle, source_path: String) -> Result<String, String> {
  let root = workspace_root(&app)?;
  let source = PathBuf::from(&source_path);
  let file_name = source
    .file_name()
    .ok_or_else(|| format!("Invalid source path: {source_path}"))?
    .to_string_lossy()
    .to_string();
  let resolved = resolve_in_workspace(&root, &file_name)?;
  std::fs::copy(&source, &resolved.target).map_err(|e| format!("Failed to add \"{file_name}\" to workspace: {e}"))?;
  Ok(file_name)
}

#[tauri::command(async)]
pub fn agent_delete_file(app: AppHandle, relative_path: String) -> Result<(), String> {
  let root = workspace_root(&app)?;
  let resolved = resolve_in_workspace(&root, &relative_path)?;
  if !resolved.exists {
    return Err(format!("File not found: {relative_path}"));
  }
  if resolved.target.is_dir() {
    return Err(format!(
      "\"{relative_path}\" is a directory — recursive directory deletion is not supported by this tool"
    ));
  }
  std::fs::remove_file(&resolved.target).map_err(|e| format!("Failed to delete \"{relative_path}\": {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn make_root() -> tempfile_like::TempRoot {
    tempfile_like::TempRoot::new()
  }

  /// Minimal temp-directory helper (the crate doesn't already depend on
  /// `tempfile`) — creates a unique directory under the OS temp dir and
  /// removes it (and everything under it) on drop.
  mod tempfile_like {
    use std::path::PathBuf;

    pub struct TempRoot {
      pub path: PathBuf,
    }

    impl TempRoot {
      pub fn new() -> Self {
        let mut path = std::env::temp_dir();
        path.push(format!("udaan_agent_workspace_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
      }
    }

    impl Drop for TempRoot {
      fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
      }
    }
  }

  #[test]
  fn allows_simple_relative_path() {
    let tmp = make_root();
    let resolved = resolve_in_workspace(&tmp.path, "notes.txt").unwrap();
    assert!(!resolved.exists);
    assert_eq!(resolved.target, tmp.path.canonicalize().unwrap().join("notes.txt"));
  }

  #[test]
  fn allows_nested_relative_path_creating_dirs_later() {
    let tmp = make_root();
    let resolved = resolve_in_workspace(&tmp.path, "sub/dir/file.txt").unwrap();
    assert!(!resolved.exists);
    assert!(resolved.target.ends_with("sub/dir/file.txt") || resolved.target.ends_with("sub\\dir\\file.txt"));
  }

  #[test]
  fn allows_existing_nested_file() {
    let tmp = make_root();
    std::fs::create_dir_all(tmp.path.join("sub")).unwrap();
    std::fs::write(tmp.path.join("sub/file.txt"), "hi").unwrap();
    let resolved = resolve_in_workspace(&tmp.path, "sub/file.txt").unwrap();
    assert!(resolved.exists);
  }

  #[test]
  fn rejects_parent_dir_traversal() {
    let tmp = make_root();
    let err = resolve_in_workspace(&tmp.path, "../escape.txt").unwrap_err();
    assert!(err.contains(".."), "error should mention the traversal: {err}");
  }

  #[test]
  fn rejects_nested_parent_dir_traversal() {
    let tmp = make_root();
    let err = resolve_in_workspace(&tmp.path, "sub/../../escape.txt").unwrap_err();
    assert!(err.contains(".."), "error should mention the traversal: {err}");
  }

  #[test]
  fn rejects_deeply_nested_traversal_past_root() {
    let tmp = make_root();
    let err = resolve_in_workspace(&tmp.path, "a/b/c/../../../../../../escape.txt").unwrap_err();
    assert!(err.contains(".."), "error should mention the traversal: {err}");
  }

  #[test]
  fn rejects_windows_absolute_path() {
    let tmp = make_root();
    let err = resolve_in_workspace(&tmp.path, "C:\\Windows\\System32\\evil.txt").unwrap_err();
    assert!(err.contains("Absolute") || err.contains("escapes"), "got: {err}");
  }

  #[test]
  fn rejects_unc_path() {
    let tmp = make_root();
    let err = resolve_in_workspace(&tmp.path, "\\\\server\\share\\file.txt").unwrap_err();
    assert!(err.contains("Absolute") || err.contains("escapes"), "got: {err}");
  }

  #[test]
  fn rejects_forward_slash_absolute_path() {
    let tmp = make_root();
    let err = resolve_in_workspace(&tmp.path, "/etc/passwd").unwrap_err();
    assert!(err.contains("Absolute") || err.contains("escapes"), "got: {err}");
  }

  #[test]
  fn rejects_drive_relative_path() {
    let tmp = make_root();
    // `C:foo` has no root component so Rust's `is_absolute()` returns
    // false for it on Windows, but it's still an attempt to address a
    // different drive's current directory — must be rejected by the
    // explicit `:` check, not silently treated as a workspace-relative
    // literal folder named "C:foo".
    let err = resolve_in_workspace(&tmp.path, "C:foo\\bar.txt").unwrap_err();
    assert!(err.contains("Absolute") || err.contains("escapes"), "got: {err}");
  }

  #[test]
  fn rejects_empty_path() {
    let tmp = make_root();
    let err = resolve_in_workspace(&tmp.path, "").unwrap_err();
    assert!(err.contains("empty"), "got: {err}");
  }

  #[test]
  fn rejects_whitespace_only_path() {
    let tmp = make_root();
    let err = resolve_in_workspace(&tmp.path, "   ").unwrap_err();
    assert!(err.contains("empty"), "got: {err}");
  }

  #[cfg(unix)]
  #[test]
  fn rejects_symlink_escape_to_existing_target() {
    let tmp = make_root();
    let outside = tempfile_like::TempRoot::new();
    std::fs::write(outside.path.join("secret.txt"), "top secret").unwrap();
    std::os::unix::fs::symlink(&outside.path, tmp.path.join("escape_link")).unwrap();

    let err = resolve_in_workspace(&tmp.path, "escape_link/secret.txt").unwrap_err();
    assert!(err.contains("escapes"), "got: {err}");
  }

  #[cfg(windows)]
  #[test]
  fn rejects_symlink_escape_to_existing_target_if_creatable() {
    // Creating a real symlink on Windows requires either Developer Mode or
    // administrator privileges (SeCreateSymbolicLinkPrivilege) — CI/dev
    // machines vary, so this test skips itself (rather than failing
    // spuriously) when symlink creation isn't permitted, but still proves
    // the containment logic when it IS creatable, which is the case that
    // actually matters for the security property.
    let tmp = make_root();
    let outside = tempfile_like::TempRoot::new();
    std::fs::write(outside.path.join("secret.txt"), "top secret").unwrap();

    match std::os::windows::fs::symlink_dir(&outside.path, tmp.path.join("escape_link")) {
      Ok(()) => {
        let err = resolve_in_workspace(&tmp.path, "escape_link\\secret.txt").unwrap_err();
        assert!(err.contains("escapes"), "got: {err}");
      }
      Err(_) => {
        eprintln!("skipping: symlink_dir requires Developer Mode or admin on this machine");
      }
    }
  }

  #[test]
  fn write_then_read_round_trip_via_commands_logic() {
    let tmp = make_root();
    let resolved = resolve_in_workspace(&tmp.path, "notes.txt").unwrap();
    std::fs::write(&resolved.target, "hello agent").unwrap();
    let resolved_again = resolve_in_workspace(&tmp.path, "notes.txt").unwrap();
    assert!(resolved_again.exists);
    let content = std::fs::read_to_string(&resolved_again.target).unwrap();
    assert_eq!(content, "hello agent");
  }

  #[test]
  fn nested_write_creates_parent_dirs_and_stays_contained() {
    let tmp = make_root();
    let resolved = resolve_in_workspace(&tmp.path, "reports/2026/summary.txt").unwrap();
    assert!(!resolved.exists);
    std::fs::create_dir_all(resolved.target.parent().unwrap()).unwrap();
    std::fs::write(&resolved.target, "data").unwrap();
    let canonical_root = tmp.path.canonicalize().unwrap();
    assert!(resolved.target.starts_with(&canonical_root));
  }
}

#[cfg(test)]
mod e2e_simulation {
  use super::*;

  /// Exercises the exact write->read round trip an agentic tool-calling
  /// turn performs, using the real resolve_in_workspace + std::fs calls
  /// (not the #[tauri::command] wrappers, which need a live AppHandle) —
  /// proves the underlying logic behind agent_write_file/agent_read_file
  /// works end to end for the real "create notes.txt, read it back" task.
  #[test]
  fn real_write_then_read_notes_txt_task() {
    let mut root = std::env::temp_dir();
    root.push(format!("udaan_agent_e2e_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();

    let write_resolved = resolve_in_workspace(&root, "notes.txt").unwrap();
    std::fs::write(&write_resolved.target, "2026-06-26").unwrap();

    let read_resolved = resolve_in_workspace(&root, "notes.txt").unwrap();
    assert!(read_resolved.exists);
    let content = std::fs::read_to_string(&read_resolved.target).unwrap();
    assert_eq!(content, "2026-06-26");

    let _ = std::fs::remove_dir_all(&root);
  }
}

#[cfg(test)]
mod e2e_traversal_via_tool_dispatch {
  use super::*;

  /// Simulates a live tool call whose arguments contain a traversal
  /// attempt — proves resolve_in_workspace rejects it with a clear error
  /// rather than a crash or silent bypass, exactly as it would be invoked
  /// from agent_read_file/agent_write_file with model-supplied JSON args.
  #[test]
  fn live_tool_call_traversal_attempt_is_rejected_not_crashed() {
    let mut root = std::env::temp_dir();
    root.push(format!("udaan_agent_e2e_traversal_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();

    // Exactly the shape a malicious/confused model's tool_call arguments
    // would take: relative_path pointing outside the workspace.
    let attack_paths = [
      "../../../etc/passwd",
      r"..\..\Windows\System32\config\SAM",
      r"C:\Windows\System32\drivers\etc\hosts",
    ];

    for attack in attack_paths {
      let result = resolve_in_workspace(&root, attack);
      assert!(result.is_err(), "expected rejection for {attack}, got {result:?}");
    }

    let _ = std::fs::remove_dir_all(&root);
  }
}
