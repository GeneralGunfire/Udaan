//! Supervised background services.
//!
//! Every long-running thread in the shell goes through [`spawn`]. The body runs inside
//! `catch_unwind`; if it panics the panic is logged and recorded, and (for services that
//! should survive) the body is run again after a backoff delay. The body is `FnMut`, so
//! state it owns, such as a channel receiver, is still there after a restart.
//!
//! A service that keeps crashing is given up on rather than restarted forever: more than
//! [`MAX_RESTARTS`] panics inside [`WINDOW`] marks it `failed` and stops, so a bug can
//! never turn into a busy loop that burns the CPU.

use super::trace;
use serde::Serialize;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_RESTARTS: usize = 12;
const WINDOW: Duration = Duration::from_secs(300);
const HEALTHY_AFTER: Duration = Duration::from_secs(60);
const FIRST_DELAY: Duration = Duration::from_millis(250);
const MAX_DELAY: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, PartialEq)]
pub enum Restart {
  /// Run once; a panic is recorded but the service is not restarted.
  Never,
  /// Restart after a panic, with exponential backoff.
  OnPanic,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHealth {
  pub name: String,
  /// running | restarting | stopped | failed
  pub state: &'static str,
  pub restarts: u32,
  pub last_panic: Option<String>,
}

static HEALTH: Mutex<Vec<ServiceHealth>> = Mutex::new(Vec::new());

fn update(name: &str, f: impl FnOnce(&mut ServiceHealth)) {
  if let Ok(mut all) = HEALTH.lock() {
    if let Some(h) = all.iter_mut().find(|h| h.name == name) {
      f(h);
    }
  }
}

pub fn health() -> Vec<ServiceHealth> {
  HEALTH.lock().map(|h| h.clone()).unwrap_or_default()
}

fn panic_message(p: &Box<dyn std::any::Any + Send>) -> String {
  if let Some(s) = p.downcast_ref::<&str>() {
    (*s).to_string()
  } else if let Some(s) = p.downcast_ref::<String>() {
    s.clone()
  } else {
    "non-string panic".to_string()
  }
}

/// Runs `body` on a named thread under supervision.
pub fn spawn<F>(name: &'static str, restart: Restart, mut body: F) -> std::io::Result<()>
where
  F: FnMut() + Send + 'static,
{
  if let Ok(mut all) = HEALTH.lock() {
    all.retain(|h| h.name != name);
    all.push(ServiceHealth { name: name.to_string(), state: "running", restarts: 0, last_panic: None });
  }
  std::thread::Builder::new()
    .name(format!("udaan-{name}"))
    .spawn(move || {
      let mut delay = FIRST_DELAY;
      let mut recent: Vec<Instant> = Vec::new();
      loop {
        update(name, |h| h.state = "running");
        let started = Instant::now();
        match catch_unwind(AssertUnwindSafe(|| body())) {
          Ok(()) => {
            update(name, |h| h.state = "stopped");
            return;
          }
          Err(p) => {
            let msg = panic_message(&p);
            trace::line(&format!("service '{name}' panicked: {msg}"));
            update(name, |h| {
              h.restarts += 1;
              h.last_panic = Some(msg.clone());
            });
            if restart == Restart::Never {
              update(name, |h| h.state = "failed");
              return;
            }
            let now = Instant::now();
            if started.elapsed() > HEALTHY_AFTER {
              delay = FIRST_DELAY;
              recent.clear();
            }
            recent.push(now);
            recent.retain(|t| now.duration_since(*t) < WINDOW);
            if recent.len() > MAX_RESTARTS {
              trace::line(&format!("service '{name}' gave up after {} panics in {:?}", recent.len(), WINDOW));
              update(name, |h| h.state = "failed");
              return;
            }
            update(name, |h| h.state = "restarting");
            std::thread::sleep(delay);
            delay = (delay * 2).min(MAX_DELAY);
          }
        }
      }
    })
    .map(|_| ())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicU32, Ordering};
  use std::sync::Arc;

  #[test]
  fn restarts_after_a_panic_and_keeps_state() {
    let runs = Arc::new(AtomicU32::new(0));
    let r = runs.clone();
    spawn("test-restart", Restart::OnPanic, move || {
      let n = r.fetch_add(1, Ordering::SeqCst);
      if n == 0 {
        panic!("first run fails");
      }
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(900));
    assert_eq!(runs.load(Ordering::SeqCst), 2, "ran once, panicked, ran again");
    let h = health().into_iter().find(|h| h.name == "test-restart").unwrap();
    assert_eq!(h.state, "stopped");
    assert_eq!(h.restarts, 1);
    assert_eq!(h.last_panic.as_deref(), Some("first run fails"));
  }

  #[test]
  fn never_policy_does_not_restart() {
    let runs = Arc::new(AtomicU32::new(0));
    let r = runs.clone();
    spawn("test-never", Restart::Never, move || {
      r.fetch_add(1, Ordering::SeqCst);
      panic!("boom");
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(600));
    assert_eq!(runs.load(Ordering::SeqCst), 1);
    assert_eq!(health().into_iter().find(|h| h.name == "test-never").unwrap().state, "failed");
  }
}
