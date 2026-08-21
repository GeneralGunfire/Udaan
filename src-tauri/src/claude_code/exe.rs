/// Resolves the platform-appropriate name for a globally-installed Node CLI.
///
/// `std::process::Command` on Windows calls `CreateProcess` directly and does
/// NOT perform the `.cmd`/`.bat` extension resolution that `cmd.exe` does —
/// so `Command::new("claude")` fails even when `claude.cmd` is on PATH and
/// runs fine from a terminal. npm installs global CLIs as `.cmd` shims on
/// Windows, so we ask for that extension explicitly there and let Windows'
/// own PATH search (which *does* handle plain filenames without a shell)
/// find it.
pub fn resolve(name: &str) -> String {
  if cfg!(windows) {
    format!("{name}.cmd")
  } else {
    name.to_string()
  }
}
