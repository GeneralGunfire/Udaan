//! Wallpaper packs and automatic changing.
//!
//! Builds on [`super::wallpapers`] (the library and the screen-sized copies):
//!
//! - **Packs** group wallpapers: Cars, Windows, Abstract, Landscapes... They are suggested
//!   automatically from the picture names (and every one can be renamed, re-keyworded, or have
//!   pictures added by hand), plus any pack you make yourself.
//! - **Knowing each picture:** its shape (ultrawide or not) and whether it is dark or light, read
//!   once and remembered, so rotation can prefer pictures that fit the screen and the time of day.
//! - **Rotation** changes the wallpaper by itself: every N minutes, once per login, or day and
//!   night (dark pictures at night, light by day), shuffled or in order, from one pack or all.
//!   One sleeping timer drives it; nothing polls.
//!
//! The engine owns which wallpaper is current and announces `wallpaper://changed` with its id.

use super::wallpapers::{self, WallpaperInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Aspect {
  Ultrawide,
  Wide,
  Standard,
  Portrait,
}

pub fn aspect_of(w: u32, h: u32) -> Aspect {
  let r = w as f64 / h.max(1) as f64;
  if r < 1.0 {
    Aspect::Portrait
  } else if r >= 2.0 {
    Aspect::Ultrawide
  } else if r >= 1.55 {
    Aspect::Wide
  } else {
    Aspect::Standard
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
  Dark,
  Light,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
  #[serde(flatten)]
  pub info: WallpaperInfo,
  pub aspect: Aspect,
  pub tone: Tone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pack {
  pub id: String,
  pub name: String,
  /// A picture belongs if any word in its name starts with one of these.
  #[serde(default)]
  pub keywords: Vec<String>,
  /// Pictures added by hand (wallpaper ids).
  #[serde(default)]
  pub manual: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum Mode {
  Off,
  Interval { minutes: u32 },
  OnLogin,
  /// Dark pictures from `night_from` o'clock until `day_from`, light ones by day.
  DayNight { day_from: u8, night_from: u8 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Order {
  Shuffle,
  Sequential,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rotation {
  pub mode: Mode,
  pub order: Order,
  /// Rotate within this pack; `None` means everything.
  pub pack_id: Option<String>,
  /// Prefer pictures whose shape fits the screen (an ultrawide picture on a 16:9 screen is cropped).
  pub fit_screen: bool,
}

impl Default for Rotation {
  fn default() -> Self {
    Rotation { mode: Mode::Off, order: Order::Shuffle, pack_id: None, fit_screen: true }
  }
}

// ---------------------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------------------

fn words(name: &str) -> Vec<String> {
  name.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// Packs suggested from the picture names. A user's own packs and edits replace these by id.
pub fn builtin_packs() -> Vec<Pack> {
  let p = |id: &str, name: &str, kw: &[&str]| Pack { id: id.into(), name: name.into(), keywords: kw.iter().map(|s| s.to_string()).collect(), manual: vec![] };
  vec![
    p(
      "cars",
      "Cars",
      &[
        "aston", "bmw", "hyundai", "mercedes", "audi", "porsche", "ferrari", "lamborghini", "tesla", "toyota", "honda", "ford", "chevrolet", "nissan", "mazda",
        "subaru", "kia", "volkswagen", "volvo", "jaguar", "bentley", "rolls", "mclaren", "bugatti", "mustang", "corvette", "supra", "gtr", "sonata", "tributo",
        "car", "cars", "supercar",
      ],
    ),
    p("windows", "Windows", &["windows", "win11", "win10"]),
    p("macos", "macOS", &["macos", "sequoia", "sonoma", "ventura", "monterey", "bigsur"]),
    p("abstract", "Abstract", &["abstract", "bloom", "flowing", "gradient", "swirl", "waves", "lines", "fluid"]),
    p("landscapes", "Landscapes", &["mountain", "mountains", "sea", "bridge", "forest", "lake", "beach", "sunset", "canyon", "valley", "river", "ocean", "skyline", "coast"]),
  ]
}

/// Whether a picture belongs to a pack.
pub fn in_pack(item: &Item, pack: &Pack) -> bool {
  if pack.manual.iter().any(|m| *m == item.info.id) {
    return true;
  }
  let ws = words(&item.info.name);
  pack.keywords.iter().any(|k| {
    let k = k.to_lowercase();
    ws.iter().any(|w| w.starts_with(&k))
  })
}

/// How many pictures each pack holds, and the pictures that belong to no pack.
pub fn membership(items: &[Item], packs: &[Pack]) -> (HashMap<String, usize>, Vec<String>) {
  let mut counts = HashMap::new();
  let mut unplaced = Vec::new();
  for it in items {
    let mut any = false;
    for p in packs {
      if in_pack(it, p) {
        *counts.entry(p.id.clone()).or_insert(0) += 1;
        any = true;
      }
    }
    if !any {
      unplaced.push(it.info.id.clone());
    }
  }
  (counts, unplaced)
}

/// Whether `hour` (0-23) is night, given when day starts and night starts. Handles night
/// wrapping past midnight (e.g. night from 19, day from 7).
pub fn is_night(hour: u8, day_from: u8, night_from: u8) -> bool {
  if night_from > day_from {
    hour >= night_from || hour < day_from
  } else {
    hour >= night_from && hour < day_from
  }
}

/// A tiny deterministic random number generator (xorshift), enough to shuffle a handful of
/// wallpapers and testable with a fixed seed.
pub struct Rng(pub u64);
impl Rng {
  pub fn next(&mut self) -> u64 {
    let mut x = self.0.max(1);
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    self.0 = x;
    x
  }
}

/// Chooses the next wallpaper from `pool` (already filtered to the pack). Never repeats the
/// current one unless it is the only choice. `history` is the recent ones, avoided for a shuffle
/// until the pool has been seen through.
pub fn pick_next(pool: &[Item], current: Option<&str>, order: Order, history: &[String], rng: &mut Rng) -> Option<String> {
  if pool.is_empty() {
    return None;
  }
  if pool.len() == 1 {
    return Some(pool[0].info.id.clone());
  }
  match order {
    Order::Sequential => {
      let mut sorted: Vec<&Item> = pool.iter().collect();
      sorted.sort_by(|a, b| a.info.name.to_lowercase().cmp(&b.info.name.to_lowercase()));
      let at = current.and_then(|c| sorted.iter().position(|i| i.info.id == c));
      let next = match at {
        Some(i) => (i + 1) % sorted.len(),
        None => 0,
      };
      Some(sorted[next].info.id.clone())
    }
    Order::Shuffle => {
      // everything not shown recently; if all were shown, start over (but never the current one)
      let mut fresh: Vec<&Item> = pool.iter().filter(|i| Some(i.info.id.as_str()) != current && !history.contains(&i.info.id)).collect();
      if fresh.is_empty() {
        fresh = pool.iter().filter(|i| Some(i.info.id.as_str()) != current).collect();
      }
      let i = (rng.next() % fresh.len() as u64) as usize;
      Some(fresh[i].info.id.clone())
    }
  }
}

/// The pool rotation draws from: the pack (if any), narrowed to what fits the screen and the time
/// of day, falling back to the wider pool if the narrowing would leave too little.
pub fn rotation_pool<'a>(items: &'a [Item], packs: &[Pack], rot: &Rotation, screen: Aspect, night: Option<bool>) -> Vec<Item> {
  let mut pool: Vec<&Item> = match rot.pack_id.as_deref().and_then(|id| packs.iter().find(|p| p.id == id)) {
    Some(p) => items.iter().filter(|i| in_pack(i, p)).collect(),
    None => items.iter().collect(),
  };
  if rot.fit_screen {
    let fitting: Vec<&Item> = pool.iter().copied().filter(|i| i.aspect == screen).collect();
    if fitting.len() >= 2 {
      pool = fitting;
    }
  }
  if let Some(night) = night {
    let want = if night { Tone::Dark } else { Tone::Light };
    let toned: Vec<&Item> = pool.iter().copied().filter(|i| i.tone == want).collect();
    if toned.len() >= 2 {
      pool = toned;
    }
  }
  pool.into_iter().cloned().collect()
}

/// When the wallpaper should next change, in milliseconds since the epoch, or `None` if it only
/// changes on request. `local_minutes` is the local time of day in minutes (hour * 60 + minute).
pub fn next_change_at(mode: Mode, last_change_ms: i64, now_ms: i64, local_minutes: u32) -> Option<i64> {
  match mode {
    Mode::Off | Mode::OnLogin => None,
    Mode::Interval { minutes } => Some(last_change_ms + minutes.max(1) as i64 * 60_000),
    Mode::DayNight { day_from, night_from } => {
      // the next of the two boundaries after now
      let boundaries = [day_from as u32 * 60, night_from as u32 * 60];
      let mut best = i64::MAX;
      for b in boundaries {
        let delta_min = if b > local_minutes { b - local_minutes } else { b + 24 * 60 - local_minutes };
        best = best.min(now_ms + delta_min as i64 * 60_000);
      }
      Some(best)
    }
  }
}

// ---------------------------------------------------------------------------------------
// State, persistence, and the service
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
  #[serde(default)]
  folders: Vec<String>,
  /// Packs the user edited or created (by id); built-in ones are used as-is otherwise.
  #[serde(default)]
  packs: Vec<Pack>,
  /// Built-in packs the user deleted.
  #[serde(default)]
  hidden_packs: Vec<String>,
  #[serde(default)]
  rotation: Option<Rotation>,
  #[serde(default)]
  current: Option<String>,
  #[serde(default)]
  history: Vec<String>,
  #[serde(default)]
  last_change_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Tag {
  mtime: u64,
  tone: Tone,
}

struct Service {
  saved: Mutex<Saved>,
  /// Brightness, remembered per picture so it is measured once.
  tones: Mutex<HashMap<String, Tag>>,
  file: PathBuf,
  tones_file: PathBuf,
  wake: Condvar,
  gate: Mutex<()>,
}

static SERVICE: OnceLock<Service> = OnceLock::new();

fn now_ms() -> i64 {
  chrono::Utc::now().timestamp_millis()
}

fn service() -> Result<&'static Service, String> {
  SERVICE.get().ok_or_else(|| "the wallpaper service is not running".to_string())
}

/// Wakes the rotation timer. Takes the timer's own lock first, so the wake-up cannot slip in
/// between the timer deciding to sleep and actually sleeping (which would lose it, and a timer
/// waiting with rotation off would then never notice rotation being switched on).
fn poke(s: &Service) {
  let _g = s.gate.lock().unwrap_or_else(|e| e.into_inner());
  s.wake.notify_all();
}

fn save(s: &Service) {
  if let Ok(g) = s.saved.lock() {
    if let Ok(json) = serde_json::to_string_pretty(&*g) {
      let tmp = s.file.with_extension("tmp");
      if std::fs::write(&tmp, json).is_ok() {
        let _ = std::fs::rename(&tmp, &s.file);
      }
    }
  }
}

fn save_tones(s: &Service) {
  if let Ok(g) = s.tones.lock() {
    if let Ok(json) = serde_json::to_string(&*g) {
      let _ = std::fs::write(&s.tones_file, json);
    }
  }
}

/// Default places to look: a `wallpapers` folder beside the app (the project's, in development)
/// and the user's Pictures\Wallpapers.
fn default_folders() -> Vec<String> {
  let mut out = Vec::new();
  if let Ok(exe) = std::env::current_exe() {
    let mut dir = exe.parent().map(Path::to_path_buf);
    for _ in 0..6 {
      let Some(d) = dir else { break };
      let cand = d.join("wallpapers");
      if cand.is_dir() {
        out.push(cand.to_string_lossy().to_string());
        break;
      }
      dir = d.parent().map(Path::to_path_buf);
    }
  }
  if let Some(p) = dirs::picture_dir().map(|p| p.join("Wallpapers")).filter(|p| p.is_dir()) {
    out.push(p.to_string_lossy().to_string());
  }
  out
}

/// Whether a picture is dark or light, from its average brightness, measured once on a small copy.
fn measure_tone(path: &Path, cache: &Path) -> Tone {
  let Ok(small) = wallpapers::fit_in(cache, path, 64, 36, 70) else { return Tone::Dark };
  let Ok(img) = image::open(small) else { return Tone::Dark };
  let rgb = img.to_rgb8();
  let n = (rgb.width() * rgb.height()).max(1) as f64;
  let sum: f64 = rgb.pixels().map(|p| 0.2126 * p[0] as f64 + 0.7152 * p[1] as f64 + 0.0722 * p[2] as f64).sum();
  if sum / n / 255.0 > 0.45 {
    Tone::Light
  } else {
    Tone::Dark
  }
}

fn cache_dir() -> Option<PathBuf> {
  let d = dirs::data_local_dir()?.join("dev.udaan.workstation").join("wallpaper-cache");
  std::fs::create_dir_all(&d).ok()?;
  Some(d)
}

fn mtime_of(path: &str) -> u64 {
  std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

/// The whole library with each picture's shape and tone.
fn library(s: &Service) -> Vec<Item> {
  let folders: Vec<PathBuf> = {
    let g = s.saved.lock().unwrap_or_else(|e| e.into_inner());
    if g.folders.is_empty() { default_folders() } else { g.folders.clone() }.into_iter().map(PathBuf::from).collect()
  };
  let infos = wallpapers::scan_dirs(&folders);
  let cache = cache_dir();
  let mut tones = s.tones.lock().unwrap_or_else(|e| e.into_inner());
  let mut changed = false;
  let items: Vec<Item> = infos
    .into_iter()
    .map(|info| {
      let m = mtime_of(&info.path);
      let tone = match tones.get(&info.path) {
        Some(t) if t.mtime == m => t.tone,
        _ => {
          let t = cache.as_ref().map(|c| measure_tone(Path::new(&info.path), c)).unwrap_or(Tone::Dark);
          tones.insert(info.path.clone(), Tag { mtime: m, tone: t });
          changed = true;
          t
        }
      };
      let aspect = aspect_of(info.width, info.height);
      Item { info, aspect, tone }
    })
    .collect();
  drop(tones);
  if changed {
    save_tones(s);
  }
  items
}

fn all_packs(saved: &Saved) -> Vec<Pack> {
  let mut out: Vec<Pack> = builtin_packs().into_iter().filter(|p| !saved.hidden_packs.contains(&p.id) && !saved.packs.iter().any(|u| u.id == p.id)).collect();
  out.extend(saved.packs.iter().cloned());
  out
}

fn screen_aspect(app: &AppHandle) -> Aspect {
  app.primary_monitor().ok().flatten().map(|m| aspect_of(m.size().width, m.size().height)).unwrap_or(Aspect::Wide)
}

fn local_minutes() -> u32 {
  use chrono::Timelike;
  let t = chrono::Local::now();
  t.hour() * 60 + t.minute()
}

/// Picks and applies the next wallpaper per the rotation settings.
fn advance(app: &AppHandle, s: &Service, forward: bool) -> Option<String> {
  let items = library(s);
  let (rot, packs, current, history) = {
    let g = s.saved.lock().ok()?;
    (g.rotation.clone().unwrap_or_default(), all_packs(&g), g.current.clone(), g.history.clone())
  };
  let night = match rot.mode {
    Mode::DayNight { day_from, night_from } => {
      use chrono::Timelike;
      Some(is_night(chrono::Local::now().hour() as u8, day_from, night_from))
    }
    _ => None,
  };
  let pool = rotation_pool(&items, &packs, &rot, screen_aspect(app), night);
  let mut rng = Rng(now_ms() as u64 ^ 0x9E37_79B9_7F4A_7C15);
  let id = if forward {
    pick_next(&pool, current.as_deref(), rot.order, &history, &mut rng)?
  } else {
    // "previous" steps back through what was shown
    history.last().cloned().filter(|h| pool.iter().any(|i| i.info.id == *h)).or_else(|| pick_next(&pool, current.as_deref(), rot.order, &history, &mut rng))?
  };
  apply(app, s, &id, forward);
  Some(id)
}

fn apply(app: &AppHandle, s: &Service, id: &str, forward: bool) {
  {
    let mut g = s.saved.lock().unwrap_or_else(|e| e.into_inner());
    if forward {
      if let Some(cur) = g.current.clone() {
        g.history.push(cur);
        let extra = g.history.len().saturating_sub(40);
        g.history.drain(..extra);
      }
    } else {
      g.history.pop();
    }
    g.current = Some(id.to_string());
    g.last_change_ms = now_ms();
  }
  save(s);
  let _ = app.emit("wallpaper://changed", id);
  poke(s);
}

/// Starts the service: loads settings, applies the on-login change, and runs the rotation timer.
pub fn start(app: &AppHandle) -> Result<(), String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let file = dir.join("wallpapers.json");
  let tones_file = dir.join("wallpaper-tones.json");
  let saved: Saved = std::fs::read_to_string(&file).ok().and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default();
  let tones: HashMap<String, Tag> = std::fs::read_to_string(&tones_file).ok().and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default();
  let on_login = matches!(saved.rotation.as_ref().map(|r| r.mode), Some(Mode::OnLogin));
  let _ = SERVICE.set(Service { saved: Mutex::new(saved), tones: Mutex::new(tones), file, tones_file, wake: Condvar::new(), gate: Mutex::new(()) });
  let app = app.clone();
  let _ = super::supervisor::spawn("wallpaper-rotation", super::supervisor::Restart::OnPanic, move || {
    let Ok(s) = service() else { return };
    // Let the shell settle first; then the once-per-login change if that is the mode.
    std::thread::sleep(Duration::from_secs(12));
    if on_login {
      advance(&app, s, true);
    }
    let mut guard = s.gate.lock().unwrap_or_else(|e| e.into_inner());
    loop {
      let (mode, last) = {
        let g = s.saved.lock().unwrap_or_else(|e| e.into_inner());
        (g.rotation.as_ref().map(|r| r.mode).unwrap_or(Mode::Off), g.last_change_ms)
      };
      match next_change_at(mode, last, now_ms(), local_minutes()) {
        None => {
          guard = s.wake.wait(guard).unwrap_or_else(|e| e.into_inner());
        }
        Some(at) => {
          let wait = (at - now_ms()).max(0) as u64;
          let (g, timeout) = s.wake.wait_timeout(guard, Duration::from_millis(wait)).unwrap_or_else(|e| e.into_inner());
          guard = g;
          if timeout.timed_out() {
            drop(guard);
            advance(&app, s, true);
            guard = s.gate.lock().unwrap_or_else(|e| e.into_inner());
          }
        }
      }
    }
  });
  Ok(())
}

// ---------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
  #[serde(flatten)]
  pub pack: Pack,
  pub count: usize,
  pub builtin: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
  pub items: Vec<Item>,
  pub packs: Vec<PackInfo>,
  /// Pictures that belong to no pack.
  pub unplaced: Vec<String>,
  pub current: Option<String>,
  pub rotation: Rotation,
  pub folders: Vec<String>,
}

/// The library, its packs, and the current rotation settings.
#[tauri::command(async)]
pub fn wallpaper_library() -> Result<Library, String> {
  let s = service()?;
  let items = library(s);
  let g = s.saved.lock().map_err(|e| e.to_string())?.clone();
  let packs = all_packs(&g);
  let (counts, unplaced) = membership(&items, &packs);
  let builtin_ids: Vec<String> = builtin_packs().into_iter().map(|p| p.id).collect();
  Ok(Library {
    items,
    packs: packs.into_iter().map(|p| PackInfo { count: counts.get(&p.id).copied().unwrap_or(0), builtin: builtin_ids.contains(&p.id), pack: p }).collect(),
    unplaced,
    current: g.current,
    rotation: g.rotation.unwrap_or_default(),
    folders: if g.folders.is_empty() { default_folders() } else { g.folders },
  })
}

/// Sets the folders the library is read from.
#[tauri::command(async)]
pub fn wallpaper_set_folders(folders: Vec<String>) -> Result<(), String> {
  let s = service()?;
  s.saved.lock().map_err(|e| e.to_string())?.folders = folders;
  save(s);
  Ok(())
}

/// Creates or updates a pack (a built-in pack is replaced by the edited copy).
#[tauri::command(async)]
pub fn wallpaper_pack_save(pack: Pack) -> Result<(), String> {
  let s = service()?;
  {
    let mut g = s.saved.lock().map_err(|e| e.to_string())?;
    g.packs.retain(|p| p.id != pack.id);
    g.hidden_packs.retain(|id| *id != pack.id);
    g.packs.push(pack);
  }
  save(s);
  Ok(())
}

/// Deletes a pack (a built-in one is hidden rather than lost).
#[tauri::command(async)]
pub fn wallpaper_pack_delete(id: String) -> Result<(), String> {
  let s = service()?;
  {
    let mut g = s.saved.lock().map_err(|e| e.to_string())?;
    g.packs.retain(|p| p.id != id);
    if builtin_packs().iter().any(|p| p.id == id) && !g.hidden_packs.contains(&id) {
      g.hidden_packs.push(id);
    }
  }
  save(s);
  Ok(())
}

/// Sets how the wallpaper changes by itself, and restarts the timer.
#[tauri::command(async)]
pub fn wallpaper_set_rotation(rotation: Rotation) -> Result<(), String> {
  let s = service()?;
  s.saved.lock().map_err(|e| e.to_string())?.rotation = Some(rotation);
  save(s);
  poke(s);
  Ok(())
}

/// Chooses a wallpaper by hand.
#[tauri::command(async)]
pub fn wallpaper_set(app: AppHandle, id: String) -> Result<(), String> {
  let s = service()?;
  apply(&app, s, &id, true);
  Ok(())
}

/// Moves to the next (or previous) wallpaper per the rotation settings.
#[tauri::command(async)]
pub fn wallpaper_step(app: AppHandle, forward: bool) -> Result<Option<String>, String> {
  Ok(advance(&app, service()?, forward))
}

/// The wallpaper the engine considers current.
#[tauri::command(async)]
pub fn wallpaper_current() -> Result<Option<String>, String> {
  Ok(service()?.saved.lock().map_err(|e| e.to_string())?.current.clone())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn item(name: &str, w: u32, h: u32, tone: Tone) -> Item {
    Item {
      info: WallpaperInfo { id: format!("file:C:/w/{name}.jpg"), path: format!("C:/w/{name}.jpg"), name: name.to_string(), width: w, height: h, bytes: 1 },
      aspect: aspect_of(w, h),
      tone,
    }
  }

  fn real_library() -> Vec<Item> {
    vec![
      item("aston-martin-2560x1080-27712", 2560, 1080, Tone::Dark),
      item("bmw-m3-tributo-alex-2560x1080-27720", 2560, 1080, Tone::Dark),
      item("hyundai-sonata-n-2560x1080-27515", 2560, 1080, Tone::Dark),
      item("macos-27-golden-2560x1080-27634", 2560, 1080, Tone::Light),
      item("windows-11-stock-official-light-3840x2160-5664", 3840, 2160, Tone::Light),
      item("blue-background-windows-365-windows-11-stock-dark-3840x2160-7928", 3840, 2160, Tone::Dark),
      item("bloom-abstract-3840x2160-17263", 3840, 2160, Tone::Dark),
      item("abstract-modern-blue-flowing-lines", 3840, 2160, Tone::Dark),
      item("bridge-sea-middle-mountains", 3840, 2160, Tone::Light),
    ]
  }

  #[test]
  fn the_users_real_wallpapers_group_sensibly() {
    let items = real_library();
    let packs = builtin_packs();
    let ids = |pack: &str| -> Vec<String> {
      let p = packs.iter().find(|p| p.id == pack).unwrap();
      items.iter().filter(|i| in_pack(i, p)).map(|i| i.info.name.clone()).collect()
    };
    assert_eq!(ids("cars").len(), 3, "aston martin, bmw, hyundai: {:?}", ids("cars"));
    assert!(ids("macos").iter().any(|n| n.starts_with("macos-27")));
    assert_eq!(ids("windows").len(), 2);
    assert_eq!(ids("abstract").len(), 2);
    assert_eq!(ids("landscapes"), vec!["bridge-sea-middle-mountains"]);
    let (_, unplaced) = membership(&items, &packs);
    assert!(unplaced.is_empty(), "everything finds a home: {unplaced:?}");
  }

  #[test]
  fn a_manual_pack_and_keywords_work_together() {
    let items = real_library();
    let mine = Pack { id: "mine".into(), name: "Mine".into(), keywords: vec!["bloom".into()], manual: vec![items[0].info.id.clone()] };
    let found: Vec<_> = items.iter().filter(|i| in_pack(i, &mine)).map(|i| i.info.name.as_str()).collect();
    assert_eq!(found, vec!["aston-martin-2560x1080-27712", "bloom-abstract-3840x2160-17263"]);
  }

  #[test]
  fn aspect_is_classified_from_the_size() {
    assert_eq!(aspect_of(2560, 1080), Aspect::Ultrawide);
    assert_eq!(aspect_of(3840, 2160), Aspect::Wide);
    assert_eq!(aspect_of(3840, 2400), Aspect::Wide, "16:10 is still wide");
    assert_eq!(aspect_of(1024, 768), Aspect::Standard);
    assert_eq!(aspect_of(1080, 1920), Aspect::Portrait);
  }

  #[test]
  fn night_wraps_past_midnight() {
    // night from 19:00, day from 07:00
    assert!(is_night(23, 7, 19) && is_night(2, 7, 19) && is_night(19, 7, 19));
    assert!(!is_night(7, 7, 19) && !is_night(12, 7, 19) && !is_night(18, 7, 19));
  }

  #[test]
  fn shuffle_never_repeats_the_current_and_cycles_through_everything() {
    let pool = real_library();
    let mut rng = Rng(12345);
    let mut history: Vec<String> = Vec::new();
    let mut current: Option<String> = None;
    let mut seen = std::collections::HashSet::new();
    for _ in 0..pool.len() {
      let next = pick_next(&pool, current.as_deref(), Order::Shuffle, &history, &mut rng).unwrap();
      assert_ne!(Some(next.clone()), current, "never the same twice in a row");
      assert!(seen.insert(next.clone()), "every picture is shown once before any repeats");
      if let Some(c) = current.take() {
        history.push(c);
      }
      current = Some(next);
    }
    assert_eq!(seen.len(), pool.len());
  }

  #[test]
  fn sequential_goes_in_name_order_and_wraps() {
    let pool = vec![item("b", 1920, 1080, Tone::Dark), item("a", 1920, 1080, Tone::Dark), item("c", 1920, 1080, Tone::Dark)];
    let mut rng = Rng(1);
    let a = pick_next(&pool, None, Order::Sequential, &[], &mut rng).unwrap();
    assert!(a.contains("/a."));
    let b = pick_next(&pool, Some(&a), Order::Sequential, &[], &mut rng).unwrap();
    assert!(b.contains("/b."));
    let c = pick_next(&pool, Some(&b), Order::Sequential, &[], &mut rng).unwrap();
    let wrap = pick_next(&pool, Some(&c), Order::Sequential, &[], &mut rng).unwrap();
    assert!(wrap.contains("/a."), "wraps back to the start");
  }

  #[test]
  fn rotation_prefers_screen_shape_and_time_of_day_but_never_runs_dry() {
    let items = real_library();
    let packs = builtin_packs();
    let rot = Rotation { mode: Mode::DayNight { day_from: 7, night_from: 19 }, order: Order::Shuffle, pack_id: None, fit_screen: true };
    // a 16:9-ish screen at night: wide AND dark pictures
    let night = rotation_pool(&items, &packs, &rot, Aspect::Wide, Some(true));
    assert!(night.iter().all(|i| i.aspect == Aspect::Wide && i.tone == Tone::Dark), "{:?}", night.iter().map(|i| &i.info.name).collect::<Vec<_>>());
    // inside the Cars pack (all ultrawide, all dark) on a wide screen, narrowing would leave
    // nothing, so it falls back to the whole pack instead of going empty
    let cars = Rotation { pack_id: Some("cars".into()), ..rot.clone() };
    assert_eq!(rotation_pool(&items, &packs, &cars, Aspect::Wide, Some(false)).len(), 3);
  }

  #[test]
  fn the_next_change_time_follows_the_mode() {
    let now = 1_000_000_000_000;
    assert_eq!(next_change_at(Mode::Off, 0, now, 0), None);
    assert_eq!(next_change_at(Mode::OnLogin, 0, now, 0), None);
    assert_eq!(next_change_at(Mode::Interval { minutes: 30 }, now - 10 * 60_000, now, 0), Some(now + 20 * 60_000));
    // 18:30 local, day from 7, night from 19: the next boundary is 19:00, 30 minutes away
    assert_eq!(next_change_at(Mode::DayNight { day_from: 7, night_from: 19 }, 0, now, 18 * 60 + 30), Some(now + 30 * 60_000));
    // 21:00 local: the next boundary is 07:00 the next day, 10 hours away
    assert_eq!(next_change_at(Mode::DayNight { day_from: 7, night_from: 19 }, 0, now, 21 * 60), Some(now + 10 * 60 * 60_000));
  }
}
