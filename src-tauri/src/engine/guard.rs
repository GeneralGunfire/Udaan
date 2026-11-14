//! One place that remembers how to undo every change Udaan makes to the OS.
//!
//! Whoever hides Explorer's taskbar, installs a hook, or reserves screen space calls
//! [`register`] with the matching undo at the moment it makes the change, and [`release`]
//! when it undoes it normally. [`run_all`] runs whatever is still outstanding, newest
//! first, on exit and on a main-thread panic. Each undo runs at most once.

use std::sync::Mutex;

type Undo = Box<dyn FnOnce() + Send>;

static UNDOS: Mutex<Vec<(&'static str, Undo)>> = Mutex::new(Vec::new());

/// Registers `undo` under `name`. Registering the same name again replaces the old undo.
pub fn register(name: &'static str, undo: impl FnOnce() + Send + 'static) {
  if let Ok(mut all) = UNDOS.lock() {
    all.retain(|(n, _)| *n != name);
    all.push((name, Box::new(undo)));
  }
}

/// Runs and removes the undo registered under `name`, if any.
pub fn release(name: &'static str) {
  let undo = UNDOS.lock().ok().and_then(|mut all| {
    let i = all.iter().position(|(n, _)| *n == name)?;
    Some(all.remove(i).1)
  });
  if let Some(u) = undo {
    u();
  }
}

/// Forgets the undo registered under `name` without running it (the change was already
/// reverted by the normal path).
pub fn cancel(name: &'static str) {
  if let Ok(mut all) = UNDOS.lock() {
    all.retain(|(n, _)| *n != name);
  }
}

/// Runs every outstanding undo, newest first. Safe to call more than once.
pub fn run_all() {
  loop {
    let next = UNDOS.lock().ok().and_then(|mut all| all.pop());
    match next {
      Some((name, undo)) => {
        super::trace::line(&format!("guard: undoing '{name}'"));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(undo));
      }
      None => break,
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicU32, Ordering};
  use std::sync::Arc;

  // The registry is process-global, so these tests must not interleave.
  static SERIAL: Mutex<()> = Mutex::new(());

  #[test]
  fn undoes_newest_first_once_and_release_removes() {
    let _s = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let order = Arc::new(Mutex::new(Vec::new()));
    let (a, b, c) = (order.clone(), order.clone(), order.clone());
    register("g-a", move || a.lock().unwrap().push("a"));
    register("g-b", move || b.lock().unwrap().push("b"));
    register("g-c", move || c.lock().unwrap().push("c"));
    release("g-b");
    run_all();
    run_all();
    assert_eq!(*order.lock().unwrap(), vec!["b", "c", "a"]);
  }

  #[test]
  fn a_panicking_undo_does_not_stop_the_rest() {
    let _s = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let ran = Arc::new(AtomicU32::new(0));
    let r = ran.clone();
    register("g-ok", move || {
      r.fetch_add(1, Ordering::SeqCst);
    });
    register("g-bad", || panic!("undo failed"));
    run_all();
    assert_eq!(ran.load(Ordering::SeqCst), 1);
  }
}
