//! The notification engine: one owner for a notification's whole life.
//!
//! The old design stored notifications in Rust but left every decision (is this muted? is Do
//! Not Disturb on? how long does the banner stay? is a storm of them arriving?) to whichever
//! window happened to render them, so the rules were applied inconsistently or not at all. Now a
//! notification takes one path:
//!
//! 1. A source (an app, Windows, a phone) calls [`submit`].
//! 2. [`decide`], a pure function with tests, rules on it: show a banner, keep it quietly in the
//!    history, or fold it into an identical one that just arrived.
//! 3. It is saved to the history, which survives restarts and is pruned to a sensible size.
//! 4. If it earns a banner, the banner joins a small queue. One supervised timer expires banners
//!    on schedule (no timers in a renderer) and the engine tells every window the current stack.
//!
//! The UI only renders what the engine says and sends back what the user did.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Condvar, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

/// Most banners shown at once; a newer one pushes the oldest off.
const MAX_BANNERS: usize = 3;
/// Same app + title + body inside this window is the same notification arriving again.
const DUPLICATE_MS: i64 = 3_000;
/// How far back burst limits look.
const BURST_WINDOW_MS: i64 = 10_000;
const BURST_PER_APP: usize = 3;
const BURST_TOTAL: usize = 5;
/// History kept: the newest this many, and nothing older than this many days.
const KEEP_COUNT: i64 = 500;
const KEEP_DAYS: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Urgency {
  Low,
  #[default]
  Normal,
  /// Gets through Do Not Disturb and burst limits, and stays up longer.
  Critical,
}

impl Urgency {
  fn as_str(self) -> &'static str {
    match self {
      Urgency::Low => "low",
      Urgency::Normal => "normal",
      Urgency::Critical => "critical",
    }
  }
  fn parse(s: &str) -> Self {
    match s {
      "low" => Urgency::Low,
      "critical" => Urgency::Critical,
      _ => Urgency::Normal,
    }
  }
}

/// What a source hands to [`submit`].
#[derive(Debug, Clone, Deserialize)]
pub struct Incoming {
  pub kind: String,
  pub title: String,
  pub body: String,
  pub source_app: String,
  #[serde(default)]
  pub action_label: Option<String>,
  #[serde(default)]
  pub action_payload: Option<String>,
  #[serde(default)]
  pub urgency: Urgency,
}

/// A stored notification. The field names are the ones the existing frontend already reads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
  pub id: String,
  pub kind: String,
  pub title: String,
  pub body: String,
  pub source_app: String,
  pub created_at: String,
  pub read_at: Option<String>,
  pub action_label: Option<String>,
  pub action_payload: Option<String>,
  /// How many times this same notification arrived (folded together).
  pub count: u32,
  pub urgency: Urgency,
}

/// One banner on screen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Banner {
  pub id: String,
  pub kind: String,
  pub title: String,
  /// Empty when previews are off: the banner then shows only who it is from.
  pub body: String,
  pub source_app: String,
  pub action_label: Option<String>,
  pub urgency: Urgency,
  #[serde(skip)]
  expires_at: i64,
}

// ---------------------------------------------------------------------------------------
// Policy: a pure decision
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct Settings {
  pub dnd: bool,
  /// Apps (lower-case) whose banners are silenced; they still reach the history.
  pub muted_apps: Vec<String>,
  /// Banners show the message text. Off: only who it is from.
  pub previews: bool,
  pub duration_ms: i64,
}

impl Default for Settings {
  fn default() -> Self {
    Settings { dnd: false, muted_apps: Vec::new(), previews: true, duration_ms: 5_000 }
  }
}

#[derive(Debug, Clone)]
pub struct Recent {
  pub app: String,
  pub title: String,
  pub body: String,
  pub at_ms: i64,
  pub banner: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
  Banner { duration_ms: i64, redacted: bool },
  /// Keep in the history, no banner.
  Silent,
  /// The same notification just arrived; fold it into that one.
  Duplicate,
}

/// Decides what to do with a notification. Rules apply in this order.
pub fn decide(inc: &Incoming, s: &Settings, recent: &[Recent], now_ms: i64) -> Delivery {
  let app = inc.source_app.to_lowercase();
  if recent.iter().any(|r| now_ms - r.at_ms < DUPLICATE_MS && r.app == app && r.title == inc.title && r.body == inc.body) {
    return Delivery::Duplicate;
  }
  if s.muted_apps.iter().any(|m| *m == app) {
    return Delivery::Silent;
  }
  let critical = inc.urgency == Urgency::Critical;
  if s.dnd && !critical {
    return Delivery::Silent;
  }
  if !critical {
    let in_window = |r: &&Recent| r.banner && now_ms - r.at_ms < BURST_WINDOW_MS;
    if recent.iter().filter(in_window).count() >= BURST_TOTAL || recent.iter().filter(in_window).filter(|r| r.app == app).count() >= BURST_PER_APP {
      return Delivery::Silent;
    }
  }
  let base = s.duration_ms.clamp(2_000, 30_000);
  Delivery::Banner { duration_ms: if critical { base * 2 } else { base }, redacted: !s.previews }
}

/// Reads the engine's notification settings out of the stored preferences (each stored as a JSON
/// string; the muted list is a JSON array stored inside a JSON string).
pub fn parse_settings(dnd: Option<&str>, muted: Option<&str>, previews: Option<&str>, duration_secs: Option<&str>) -> Settings {
  let mut s = Settings::default();
  if let Some(v) = dnd.and_then(|r| serde_json::from_str::<bool>(r).ok()) {
    s.dnd = v;
  }
  if let Some(v) = previews.and_then(|r| serde_json::from_str::<bool>(r).ok()) {
    s.previews = v;
  }
  if let Some(v) = duration_secs.and_then(|r| serde_json::from_str::<f64>(r).ok()) {
    s.duration_ms = (v * 1000.0) as i64;
  }
  if let Some(raw) = muted {
    let list = serde_json::from_str::<String>(raw).ok().and_then(|inner| serde_json::from_str::<Vec<String>>(&inner).ok()).or_else(|| serde_json::from_str::<Vec<String>>(raw).ok());
    s.muted_apps = list.unwrap_or_default().into_iter().map(|a| a.to_lowercase()).collect();
  }
  s
}

/// Removes expired banners, oldest first. Returns whether any were removed.
fn expire(banners: &mut Vec<Banner>, now_ms: i64) -> bool {
  let before = banners.len();
  banners.retain(|b| b.expires_at > now_ms);
  banners.len() != before
}

// ---------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------

struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  /// Opens (and upgrades) the history database. The same file and table as before, so existing
  /// history is kept; the new columns are added if they are missing.
  fn open(path: std::path::PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(path)?;
    crate::db::configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS notifications (
         id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
         source_app TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
         action_label TEXT, action_payload TEXT
       );
       CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);",
    )?;
    let have: Vec<String> = conn.prepare("PRAGMA table_info(notifications)")?.query_map([], |r| r.get::<_, String>(1))?.flatten().collect();
    if !have.iter().any(|c| c == "count") {
      conn.execute("ALTER TABLE notifications ADD COLUMN count INTEGER NOT NULL DEFAULT 1", [])?;
    }
    if !have.iter().any(|c| c == "urgency") {
      conn.execute("ALTER TABLE notifications ADD COLUMN urgency TEXT NOT NULL DEFAULT 'normal'", [])?;
    }
    Ok(Store { conn: Mutex::new(conn) })
  }

  fn push(&self, inc: &Incoming) -> rusqlite::Result<Notification> {
    let n = Notification {
      id: uuid::Uuid::new_v4().to_string(),
      kind: inc.kind.clone(),
      title: inc.title.clone(),
      body: inc.body.clone(),
      source_app: inc.source_app.clone(),
      created_at: chrono::Utc::now().to_rfc3339(),
      read_at: None,
      action_label: inc.action_label.clone(),
      action_payload: inc.action_payload.clone(),
      count: 1,
      urgency: inc.urgency,
    };
    let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
      "INSERT INTO notifications (id, kind, title, body, source_app, created_at, read_at, action_label, action_payload, count, urgency)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, 1, ?9)",
      params![n.id, n.kind, n.title, n.body, n.source_app, n.created_at, n.action_label, n.action_payload, n.urgency.as_str()],
    )?;
    Ok(n)
  }

  /// Folds a repeat into the newest identical notification.
  fn bump(&self, inc: &Incoming) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute(
      "UPDATE notifications SET count = count + 1, read_at = NULL WHERE id = (
         SELECT id FROM notifications WHERE source_app = ?1 AND title = ?2 AND body = ?3 ORDER BY created_at DESC LIMIT 1)",
      params![inc.source_app, inc.title, inc.body],
    )?;
    Ok(())
  }

  fn list(&self, unread_only: bool, limit: i64) -> rusqlite::Result<Vec<Notification>> {
    let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
    let sql = format!(
      "SELECT id, kind, title, body, source_app, created_at, read_at, action_label, action_payload, count, urgency
       FROM notifications {} ORDER BY created_at DESC LIMIT ?1",
      if unread_only { "WHERE read_at IS NULL" } else { "" }
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(params![limit.max(1)], |r| {
      Ok(Notification {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        source_app: r.get(4)?,
        created_at: r.get(5)?,
        read_at: r.get(6)?,
        action_label: r.get(7)?,
        action_payload: r.get(8)?,
        count: r.get::<_, i64>(9)?.max(1) as u32,
        urgency: Urgency::parse(&r.get::<_, String>(10)?),
      })
    })?;
    rows.collect()
  }

  fn unread_count(&self) -> rusqlite::Result<i64> {
    let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
    conn.query_row("SELECT COUNT(*) FROM notifications WHERE read_at IS NULL", [], |r| r.get(0))
  }

  fn mark_read(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute("UPDATE notifications SET read_at = ?1 WHERE id = ?2 AND read_at IS NULL", params![chrono::Utc::now().to_rfc3339(), id])?;
    Ok(())
  }

  fn mark_all_read(&self) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute("UPDATE notifications SET read_at = ?1 WHERE read_at IS NULL", params![chrono::Utc::now().to_rfc3339()])?;
    Ok(())
  }

  fn dismiss(&self, id: &str) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
    conn.execute("DELETE FROM notifications WHERE id = ?1", params![id])?;
    Ok(())
  }

  /// Keeps the newest [`KEEP_COUNT`] and drops anything older than [`KEEP_DAYS`].
  fn prune(&self) -> rusqlite::Result<usize> {
    let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(KEEP_DAYS)).to_rfc3339();
    let old = conn.execute("DELETE FROM notifications WHERE created_at < ?1", params![cutoff])?;
    let extra = conn.execute(
      "DELETE FROM notifications WHERE id IN (SELECT id FROM notifications ORDER BY created_at DESC LIMIT -1 OFFSET ?1)",
      params![KEEP_COUNT],
    )?;
    Ok(old + extra)
  }
}

// ---------------------------------------------------------------------------------------
// The center
// ---------------------------------------------------------------------------------------

struct Center {
  store: Store,
  recent: Mutex<Vec<Recent>>,
  banners: Mutex<Vec<Banner>>,
  wake: Condvar,
}

static CENTER: OnceLock<Center> = OnceLock::new();

fn now_ms() -> i64 {
  chrono::Utc::now().timestamp_millis()
}

fn read_settings(app: &AppHandle) -> Settings {
  let get = |k: &str| crate::taskbar_prefs::read_pref(app, k);
  parse_settings(
    get("notifications.dnd").as_deref(),
    get("notifications.muted").as_deref(),
    get("notifications.previews").as_deref(),
    get("notifications.duration").as_deref(),
  )
}

fn announce_changed(app: &AppHandle) {
  // The event the existing panel and toast already listen to.
  let _ = app.emit("notifications:changed", ());
}

fn announce_banners(app: &AppHandle, banners: &[Banner]) {
  let _ = app.emit("notify://banners", banners);
}

/// Starts the engine: opens the history, prunes it, and runs the banner timer. Call once.
pub fn start(app: &AppHandle) -> Result<(), String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let store = Store::open(dir.join("notifications.sqlite3")).map_err(|e| format!("notifications store: {e}"))?;
  if let Ok(n) = store.prune() {
    if n > 0 {
      super::trace::line(&format!("notifications: pruned {n} old entries"));
    }
  }
  let _ = CENTER.set(Center { store, recent: Mutex::new(Vec::new()), banners: Mutex::new(Vec::new()), wake: Condvar::new() });
  let app = app.clone();
  let _ = super::supervisor::spawn("notification-banners", super::supervisor::Restart::OnPanic, move || run_banner_timer(&app));
  Ok(())
}

/// Sleeps until the next banner is due to expire, then removes it and tells every window.
fn run_banner_timer(app: &AppHandle) {
  let Some(c) = CENTER.get() else { return };
  let mut banners = c.banners.lock().unwrap_or_else(|e| e.into_inner());
  loop {
    let now = now_ms();
    if expire(&mut banners, now) {
      let snapshot = banners.clone();
      drop(banners);
      announce_banners(app, &snapshot);
      banners = c.banners.lock().unwrap_or_else(|e| e.into_inner());
      continue;
    }
    banners = match banners.iter().map(|b| b.expires_at).min() {
      Some(next) => c.wake.wait_timeout(banners, std::time::Duration::from_millis((next - now).max(1) as u64)).unwrap_or_else(|e| e.into_inner()).0,
      None => c.wake.wait(banners).unwrap_or_else(|e| e.into_inner()),
    };
  }
}

/// A notification arrives. Returns the stored notification.
pub fn submit(app: &AppHandle, inc: Incoming) -> Result<Notification, String> {
  let c = CENTER.get().ok_or("the notification engine is not running")?;
  let settings = read_settings(app);
  let now = now_ms();
  let delivery = {
    let mut recent = c.recent.lock().unwrap_or_else(|e| e.into_inner());
    recent.retain(|r| now - r.at_ms < BURST_WINDOW_MS.max(DUPLICATE_MS));
    let d = decide(&inc, &settings, &recent, now);
    if d != Delivery::Duplicate {
      recent.push(Recent { app: inc.source_app.to_lowercase(), title: inc.title.clone(), body: inc.body.clone(), at_ms: now, banner: matches!(d, Delivery::Banner { .. }) });
    }
    d
  };

  if delivery == Delivery::Duplicate {
    c.store.bump(&inc).map_err(|e| e.to_string())?;
    announce_changed(app);
    // The folded one is the newest identical entry; return it.
    return c.store.list(false, 1).map_err(|e| e.to_string())?.into_iter().next().ok_or_else(|| "empty history".to_string());
  }

  let stored = c.store.push(&inc).map_err(|e| e.to_string())?;
  if let Delivery::Banner { duration_ms, redacted } = delivery {
    let snapshot = {
      let mut banners = c.banners.lock().unwrap_or_else(|e| e.into_inner());
      banners.push(Banner {
        id: stored.id.clone(),
        kind: stored.kind.clone(),
        title: stored.title.clone(),
        body: if redacted { String::new() } else { stored.body.clone() },
        source_app: stored.source_app.clone(),
        action_label: stored.action_label.clone(),
        urgency: stored.urgency,
        expires_at: now + duration_ms,
      });
      while banners.len() > MAX_BANNERS {
        banners.remove(0);
      }
      banners.clone()
    };
    announce_banners(app, &snapshot);
    c.wake.notify_all();
  }
  announce_changed(app);
  Ok(stored)
}

fn center() -> Result<&'static Center, String> {
  CENTER.get().ok_or_else(|| "the notification engine is not running".to_string())
}

// ---------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------

#[tauri::command(async)]
pub fn notify_push(app: AppHandle, incoming: Incoming) -> Result<Notification, String> {
  submit(&app, incoming)
}

#[tauri::command(async)]
pub fn notify_list(unread_only: bool, limit: i64) -> Result<Vec<Notification>, String> {
  center()?.store.list(unread_only, limit).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notify_unread_count() -> Result<i64, String> {
  center()?.store.unread_count().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn notify_mark_read(app: AppHandle, id: String) -> Result<(), String> {
  center()?.store.mark_read(&id).map_err(|e| e.to_string())?;
  announce_changed(&app);
  Ok(())
}

#[tauri::command(async)]
pub fn notify_mark_all_read(app: AppHandle) -> Result<(), String> {
  center()?.store.mark_all_read().map_err(|e| e.to_string())?;
  announce_changed(&app);
  Ok(())
}

/// Removes a notification from the history (and from the banner stack if it is showing).
#[tauri::command(async)]
pub fn notify_dismiss(app: AppHandle, id: String) -> Result<(), String> {
  let c = center()?;
  c.store.dismiss(&id).map_err(|e| e.to_string())?;
  notify_dismiss_banner(app.clone(), id)?;
  announce_changed(&app);
  Ok(())
}

/// Takes a banner off the screen; it stays in the history.
#[tauri::command(async)]
pub fn notify_dismiss_banner(app: AppHandle, id: String) -> Result<(), String> {
  let c = center()?;
  let snapshot = {
    let mut banners = c.banners.lock().unwrap_or_else(|e| e.into_inner());
    let before = banners.len();
    banners.retain(|b| b.id != id);
    (banners.len() != before).then(|| banners.clone())
  };
  if let Some(s) = snapshot {
    announce_banners(&app, &s);
    c.wake.notify_all();
  }
  Ok(())
}

/// The banners on screen right now.
#[tauri::command(async)]
pub fn notify_banners() -> Result<Vec<Banner>, String> {
  Ok(center()?.banners.lock().unwrap_or_else(|e| e.into_inner()).clone())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn inc(app: &str, title: &str, body: &str) -> Incoming {
    Incoming { kind: "test".into(), title: title.into(), body: body.into(), source_app: app.into(), action_label: None, action_payload: None, urgency: Urgency::Normal }
  }
  fn recent(app: &str, title: &str, body: &str, at: i64, banner: bool) -> Recent {
    Recent { app: app.into(), title: title.into(), body: body.into(), at_ms: at, banner }
  }

  #[test]
  fn a_normal_notification_gets_a_banner() {
    let d = decide(&inc("Mail", "Hi", "there"), &Settings::default(), &[], 1_000);
    assert_eq!(d, Delivery::Banner { duration_ms: 5_000, redacted: false });
  }

  #[test]
  fn an_identical_one_just_arrived_is_folded() {
    let r = [recent("mail", "Hi", "there", 900, true)];
    assert_eq!(decide(&inc("Mail", "Hi", "there"), &Settings::default(), &r, 1_000), Delivery::Duplicate);
    // a different body, or long enough ago, is a new notification
    assert!(matches!(decide(&inc("Mail", "Hi", "other"), &Settings::default(), &r, 1_000), Delivery::Banner { .. }));
    assert!(matches!(decide(&inc("Mail", "Hi", "there"), &Settings::default(), &r, 5_000), Delivery::Banner { .. }));
  }

  #[test]
  fn muted_apps_and_dnd_go_to_the_history_quietly() {
    let s = Settings { muted_apps: vec!["norton".into()], ..Settings::default() };
    assert_eq!(decide(&inc("Norton", "Scan", "done"), &s, &[], 0), Delivery::Silent);
    let dnd = Settings { dnd: true, ..Settings::default() };
    assert_eq!(decide(&inc("Mail", "Hi", "x"), &dnd, &[], 0), Delivery::Silent);
  }

  #[test]
  fn critical_ones_break_through_and_stay_longer() {
    let dnd = Settings { dnd: true, ..Settings::default() };
    let mut c = inc("System", "Battery critical", "5%");
    c.urgency = Urgency::Critical;
    assert_eq!(decide(&c, &dnd, &[], 0), Delivery::Banner { duration_ms: 10_000, redacted: false });
  }

  #[test]
  fn a_burst_is_limited_per_app_and_overall() {
    let busy_app: Vec<Recent> = (0..3).map(|i| recent("chat", &format!("m{i}"), "x", 100 * i, true)).collect();
    assert_eq!(decide(&inc("Chat", "m9", "x"), &Settings::default(), &busy_app, 500), Delivery::Silent, "3 from one app in 10 s");
    assert!(matches!(decide(&inc("Mail", "m9", "x"), &Settings::default(), &busy_app, 500), Delivery::Banner { .. }), "another app is unaffected");
    let busy_all: Vec<Recent> = (0..5).map(|i| recent(&format!("app{i}"), "t", "b", 100 * i, true)).collect();
    assert_eq!(decide(&inc("Mail", "new", "x"), &Settings::default(), &busy_all, 600), Delivery::Silent, "5 banners overall in 10 s");
    // silent ones do not count toward the limit
    let quiet: Vec<Recent> = (0..8).map(|i| recent("chat", &format!("m{i}"), "x", 100 * i, false)).collect();
    assert!(matches!(decide(&inc("Chat", "m9", "x"), &Settings::default(), &quiet, 900), Delivery::Banner { .. }));
    // and old ones age out
    assert!(matches!(decide(&inc("Chat", "m9", "x"), &Settings::default(), &busy_app, 20_000), Delivery::Banner { .. }));
  }

  #[test]
  fn previews_off_redacts_and_duration_is_clamped() {
    let s = Settings { previews: false, duration_ms: 500, ..Settings::default() };
    assert_eq!(decide(&inc("Mail", "Hi", "secret"), &s, &[], 0), Delivery::Banner { duration_ms: 2_000, redacted: true });
    let long = Settings { duration_ms: 600_000, ..Settings::default() };
    assert_eq!(decide(&inc("Mail", "Hi", "x"), &long, &[], 0), Delivery::Banner { duration_ms: 30_000, redacted: false });
  }

  #[test]
  fn settings_are_read_from_the_stored_json() {
    // the muted list is a JSON array that was stored as a JSON string
    let muted = serde_json::to_string(&serde_json::to_string(&vec!["Norton", "Avast"]).unwrap()).unwrap();
    let s = parse_settings(Some("true"), Some(&muted), Some("false"), Some("8"));
    assert!(s.dnd && !s.previews);
    assert_eq!(s.duration_ms, 8_000);
    assert_eq!(s.muted_apps, vec!["norton", "avast"]);
    let d = parse_settings(None, None, None, None);
    assert!(!d.dnd && d.previews && d.muted_apps.is_empty());
  }

  #[test]
  fn expired_banners_are_removed_oldest_first() {
    let mk = |id: &str, at: i64| Banner { id: id.into(), kind: "t".into(), title: "t".into(), body: String::new(), source_app: "a".into(), action_label: None, urgency: Urgency::Normal, expires_at: at };
    let mut b = vec![mk("a", 100), mk("b", 300), mk("c", 200)];
    assert!(expire(&mut b, 250));
    assert_eq!(b.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["b"]);
    assert!(!expire(&mut b, 250), "nothing more to remove");
  }

  #[test]
  fn the_store_upgrades_an_old_database_keeps_history_folds_repeats_and_prunes() {
    let dir = std::env::temp_dir().join(format!("udaan_notify_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("n.sqlite3");
    // an OLD database: the original schema, with one existing notification
    {
      let c = Connection::open(&path).unwrap();
      c.execute_batch(
        "CREATE TABLE notifications (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
           source_app TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, action_label TEXT, action_payload TEXT);
         INSERT INTO notifications VALUES ('old1','k','Old title','Old body','Phone','2026-11-01T00:00:00+00:00',NULL,NULL,NULL);",
      )
      .unwrap();
    }
    let s = Store::open(path).unwrap();
    let all = s.list(false, 10).unwrap();
    assert_eq!(all.len(), 1, "existing history survives the upgrade");
    assert_eq!((all[0].title.as_str(), all[0].count, all[0].urgency), ("Old title", 1, Urgency::Normal));

    let n = s.push(&inc("Mail", "Hello", "World")).unwrap();
    s.bump(&inc("Mail", "Hello", "World")).unwrap();
    let folded = s.list(false, 10).unwrap().into_iter().find(|x| x.id == n.id).unwrap();
    assert_eq!(folded.count, 2, "a repeat is folded, not duplicated");
    assert_eq!(s.unread_count().unwrap(), 2);
    s.mark_read(&n.id).unwrap();
    assert_eq!(s.unread_count().unwrap(), 1);
    s.mark_all_read().unwrap();
    assert_eq!(s.unread_count().unwrap(), 0);
    // the 2026-11-01 entry is older than KEEP_DAYS only if the clock is far ahead; prune never
    // removes recent ones
    s.prune().unwrap();
    assert!(s.list(false, 10).unwrap().iter().any(|x| x.id == n.id));
    s.dismiss(&n.id).unwrap();
    assert!(!s.list(false, 10).unwrap().iter().any(|x| x.id == n.id));
    let _ = std::fs::remove_dir_all(&dir);
  }
}
