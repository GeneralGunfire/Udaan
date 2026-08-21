use std::path::Path;
use std::process::Command;

/// Opens `dir` in VS Code. Fixed argv shape only: `code <dir>`, no shell
/// interpretation, no user-controlled flags. Rejects anything that isn't an
/// existing directory so this can't be used to launch arbitrary commands or
/// touch paths that don't exist.
pub fn open_in_vscode(dir: &str) -> Result<(), String> {
  let path = Path::new(dir);
  if !path.is_dir() {
    return Err("Not a directory".into());
  }

  Command::new(super::exe::resolve("code"))
    .arg(path)
    .spawn()
    .map(|_| ())
    .map_err(|e| format!("Failed to launch VS Code: {e}"))
}
