//! Starting background processes without a console window.
//!
//! A console program started from a GUI app opens a visible console window unless told not to, so a
//! background `ipconfig`, `netstat`, the Claude CLI or a text-to-speech engine would flash a black
//! window on the user's screen every time it ran. Everything the shell runs in the background starts
//! through here, so the window is hidden by default and nobody has to remember the flag.

use std::ffi::OsStr;
use std::os::windows::process::CommandExt;

/// `CREATE_NO_WINDOW`: the process gets no console window.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A command that runs with no console window.
pub fn hidden<S: AsRef<OsStr>>(program: S) -> std::process::Command {
  let mut c = std::process::Command::new(program);
  c.creation_flags(CREATE_NO_WINDOW);
  c
}

/// The same for an async command.
pub fn hidden_async<S: AsRef<OsStr>>(program: S) -> tokio::process::Command {
  let mut c = tokio::process::Command::new(program);
  c.creation_flags(CREATE_NO_WINDOW);
  c
}
