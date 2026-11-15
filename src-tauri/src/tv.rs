//! Udaan TV: streaming services hosted inside the TV window.
//!
//! Each service runs as a real Microsoft Edge "app" window — Edge carries
//! the DRM (Widevine/PlayReady) Disney+, Apple TV+ and Netflix require,
//! which WebView2 lacks — in its own profile under %LOCALAPPDATA%\Udaan\TV
//! (so sign-ins stick and each is its own process). Udaan then strips its
//! frame and re-parents it into the TV window as a child, so it plays inside
//! the TV app. Services stay alive in the background for instant switching.

use serde::Serialize;
use std::collections::HashMap;
use std::process::Command;
use std::sync::Mutex;

#[derive(Clone, Copy)]
struct Hosted {
  pid: u32,
  hwnd: isize,
}

static HOSTED: Mutex<Option<HashMap<String, Hosted>>> = Mutex::new(None);
/// The container every service sits in, inside the TV window's stage area.
static HOST: Mutex<isize> = Mutex::new(0);
/// The service currently on screen, so focus can be handed back to it.
static ACTIVE: Mutex<Option<String>> = Mutex::new(None);
/// Edge app windows draw their own title bar inside the client area; the
/// service is shifted up by this much (logical px) inside the container so
/// that bar is clipped away.
const EDGE_CAPTION: f64 = 31.0;

/// A TV's user agent unlocks YouTube's 10-foot "leanback" interface.
/// A PlayStation "Leanback Shell" user agent: YouTube still serves its TV UI to it.
const TV_UA: &str = "Mozilla/5.0 (PS4; Leanback Shell) Gecko/20100101 Firefox/65.0 LeanbackShell/01.00.01.75 Sony PS4/ (PS4, , no, CH)";

/// The browser that hosts services: Google Chrome when installed, then
/// Microsoft Edge, then Norton Private Browser. All are Chromium with DRM
/// (Widevine), which WebView2 lacks. Returns the exe and a profile tag: each
/// browser keeps its own profile folder, since a Chromium profile written by
/// one browser can refuse to open in another.
fn browser_path() -> Option<(std::path::PathBuf, &'static str)> {
  let env = |k: &str| std::env::var_os(k).map(std::path::PathBuf::from);
  let chrome = [env("ProgramFiles"), env("ProgramFiles(x86)"), env("LOCALAPPDATA")]
    .into_iter()
    .flatten()
    .map(|p| p.join(r"Google\Chrome\Application\chrome.exe"));
  let edge = [env("ProgramFiles(x86)"), env("ProgramFiles")].into_iter().flatten().map(|p| p.join(r"Microsoft\Edge\Application\msedge.exe"));
  let norton = env("LOCALAPPDATA").map(|p| p.join(r"Norton\Browser\Application\NortonBrowser.exe"));
  chrome
    .into_iter()
    .find(|p| p.exists())
    .map(|p| (p, "TV-Chrome"))
    .or_else(|| edge.into_iter().find(|p| p.exists()).map(|p| (p, "TV-Norton")))
    .or_else(|| norton.filter(|p| p.exists()).map(|p| (p, "TV-Norton")))
}

fn profile_dir(tag: &str, name: &str) -> Result<std::path::PathBuf, String> {
  let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA not set")?;
  let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
  let dir = std::path::PathBuf::from(base).join(r"Udaan").join(tag).join(if safe.is_empty() { "web".into() } else { safe });
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

fn kill_tree(pid: u32) {
  let mut cmd = Command::new("taskkill");
  cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000);
  }
  let _ = cmd.status();
}

#[cfg(windows)]
mod win {
  use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
  use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
  use windows_sys::Win32::UI::WindowsAndMessaging::*;

  /// The main visible top-level window belonging to `pid`, if it exists yet.
  pub fn main_window(pid: u32) -> Option<isize> {
    struct Find {
      pid: u32,
      found: isize,
    }
    unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
      let f = &mut *(lp as *mut Find);
      let mut owner = 0u32;
      GetWindowThreadProcessId(hwnd, &mut owner);
      if owner == f.pid && IsWindowVisible(hwnd) != 0 && GetWindow(hwnd, GW_OWNER).is_null() {
        let mut class = [0u16; 64];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), 64);
        if String::from_utf16_lossy(&class[..n as usize]).starts_with("Chrome_WidgetWin") {
          f.found = hwnd as isize;
          return 0;
        }
      }
      1
    }
    let mut f = Find { pid, found: 0 };
    unsafe { EnumWindows(Some(cb), &mut f as *mut Find as LPARAM) };
    (f.found != 0).then_some(f.found)
  }

  /// Makes `child` a borderless child of `parent`.
  pub fn adopt(child: isize, parent: isize) {
    unsafe {
      let h = child as HWND;
      let style = GetWindowLongPtrW(h, GWL_STYLE);
      let style = (style & !((WS_CAPTION | WS_THICKFRAME | WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX) as isize)) | WS_CHILD as isize;
      SetWindowLongPtrW(h, GWL_STYLE, style);
      let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) & !((WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_DLGMODALFRAME) as isize);
      SetWindowLongPtrW(h, GWL_EXSTYLE, ex);
      SetParent(h, parent as HWND);
      SetWindowPos(h, std::ptr::null_mut(), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
    }
  }

  pub fn place(child: isize, x: i32, y: i32, w: i32, h: i32, visible: bool) {
    unsafe {
      let hwnd = child as HWND;
      // Always on top of its siblings: the TV's own web content is a sibling too.
      SetWindowPos(hwnd, HWND_TOP, x, y, w, h, SWP_NOACTIVATE);
      ShowWindow(hwnd, if visible { SW_SHOW } else { SW_HIDE });
    }
  }

  /// Gives the hosted browser keyboard focus. Its window belongs to another thread, and
  /// SetFocus only works across threads when their input queues are attached for the call.
  pub fn focus(child: isize) {
    unsafe {
      let h = child as HWND;
      let target = GetWindowThreadProcessId(h, std::ptr::null_mut());
      let me = GetCurrentThreadId();
      let attached = target != 0 && target != me && AttachThreadInput(me, target, 1) != 0;
      windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus(h);
      if attached {
        AttachThreadInput(me, target, 0);
      }
    }
  }

  /// Whether a screen point is inside a visible window.
  pub fn contains(hwnd: isize, x: i32, y: i32) -> bool {
    unsafe {
      let h = hwnd as HWND;
      if IsWindowVisible(h) == 0 {
        return false;
      }
      let mut r: RECT = std::mem::zeroed();
      GetWindowRect(h, &mut r) != 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom
    }
  }

  /// A plain clipping container, child of the TV window. Must run on the UI thread.
  pub fn make_container(parent: isize) -> isize {
    unsafe {
      let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
      let hwnd = CreateWindowExW(0, class.as_ptr(), std::ptr::null(), WS_CHILD | WS_CLIPCHILDREN, 0, 0, 10, 10, parent as HWND, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null());
      hwnd as isize
    }
  }

  pub fn show(hwnd: isize, visible: bool) {
    unsafe {
      ShowWindow(hwnd as HWND, if visible { SW_SHOW } else { SW_HIDE });
    }
  }

  pub fn alive(child: isize) -> bool {
    unsafe { IsWindow(child as HWND) != 0 }
  }

  /// Browser back / forward / refresh through the standard app-command message,
  /// which Chromium browsers handle on their top-level window.
  pub fn app_command(child: isize, cmd: isize) {
    unsafe {
      PostMessageW(child as HWND, WM_APPCOMMAND, child as usize, cmd << 16);
    }
  }
}

fn hosted() -> std::sync::MutexGuard<'static, Option<HashMap<String, Hosted>>> {
  let mut g = HOSTED.lock().unwrap();
  g.get_or_insert_with(HashMap::new);
  g
}

/// Starts (or reuses) a service and hosts it inside the calling TV window.
#[tauri::command]
pub async fn tv_host_open(window: tauri::WebviewWindow, id: String, url: String, tv_ui: bool) -> Result<(), String> {
  if !(url.starts_with("https://") || url.starts_with("http://")) {
    return Err("Only web addresses can be opened".into());
  }
  if let Some(h) = hosted().as_ref().unwrap().get(&id).copied() {
    #[cfg(windows)]
    if win::alive(h.hwnd) {
      return Ok(());
    }
    kill_tree(h.pid);
  }
  let parent = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
  // One clipping container per TV window, created on the UI thread.
  let host = {
    let current = *HOST.lock().unwrap();
    #[cfg(windows)]
    let ok = current != 0 && win::alive(current);
    #[cfg(not(windows))]
    let ok = false;
    if ok {
      current
    } else {
      let (tx, rx) = std::sync::mpsc::channel();
      window
        .run_on_main_thread(move || {
          #[cfg(windows)]
          let _ = tx.send(win::make_container(parent));
          #[cfg(not(windows))]
          let _ = tx.send(0isize);
        })
        .map_err(|e| e.to_string())?;
      let h = rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "Couldn't prepare the player area")?;
      *HOST.lock().unwrap() = h;
      // However the TV window goes away, its players must go with it.
      window.on_window_event(|event| match event {
        tauri::WindowEvent::Destroyed => {
          tv_host_close(None);
          *HOST.lock().unwrap() = 0;
          *ACTIVE.lock().unwrap() = None;
        }
        // Coming back to the TV window: the playing service gets the keyboard again.
        tauri::WindowEvent::Focused(true) => {
          std::thread::spawn(focus_active);
        }
        _ => {}
      });
      h
    }
  };
  let (browser, tag) = browser_path().ok_or("Google Chrome (or Microsoft Edge) is needed to play streaming services — they provide the DRM.")?;
  let mut cmd = Command::new(browser);
  cmd
    .arg(format!("--user-data-dir={}", profile_dir(tag, &format!("svc-{id}"))?.display()))
    .arg(format!("--app={url}"))
    .arg("--no-first-run")
    .arg("--no-default-browser-check")
    .arg("--autoplay-policy=no-user-gesture-required")
    .arg("--hide-crash-restore-bubble")
    .arg("--disable-session-crashed-bubble")
    .arg("--disable-features=msEdgeSidebarV2,msHubApps")
    .arg("--window-position=-32000,-32000");
  if tv_ui {
    // Client hints would still announce the real browser on Windows; turn
    // them off so the TV identity is the only one the site sees.
    cmd.arg(format!("--user-agent={TV_UA}")).arg("--disable-features=UserAgentClientHint,msEdgeSidebarV2,msHubApps");
  }
  let pid = cmd.spawn().map_err(|e| format!("Couldn't start the player: {e}"))?.id();
  // Wait for Edge's window, then adopt it.
  let mut found = None;
  for _ in 0..80 {
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    #[cfg(windows)]
    if let Some(h) = win::main_window(pid) {
      found = Some(h);
      break;
    }
  }
  let hwnd = found.ok_or("The player window didn't appear")?;
  #[cfg(windows)]
  win::adopt(hwnd, host);
  hosted().as_mut().unwrap().insert(id, Hosted { pid, hwnd });
  Ok(())
}

/// Positions the hosted services: `id` fills the rect (physical px, relative
/// to the TV window's client area); every other service is hidden.
#[tauri::command]
pub fn tv_host_show(id: Option<String>, x: i32, y: i32, w: i32, h: i32, scale: Option<f64>) {
  *ACTIVE.lock().unwrap() = id.clone();
  let cap = (EDGE_CAPTION * scale.unwrap_or(1.0)).round() as i32;
  let host = *HOST.lock().unwrap();
  #[cfg(windows)]
  if host != 0 {
    win::place(host, x, y, w, h, id.is_some());
  }
  let map = hosted();
  for (key, h_) in map.as_ref().unwrap().iter() {
    let visible = Some(key) == id.as_ref();
    #[cfg(windows)]
    {
      // Inside the container: shifted up so Edge's own title bar is clipped off.
      // Edge keeps an invisible ~8px resize margin on its left, right and
      // bottom edges; overshoot so it's clipped too.
      let edge = (8.0 * scale.unwrap_or(1.0)).round() as i32;
      win::place(h_.hwnd, -edge, -cap, w + edge * 2, h + cap + edge, visible);
      if visible {
        win::focus(h_.hwnd);
      }
    }
  }
  #[cfg(not(windows))]
  let _ = (host, cap);
}

/// Hands keyboard focus to the service on screen. Called off the UI thread.
pub fn focus_active() {
  #[cfg(windows)]
  {
    let id = ACTIVE.lock().unwrap().clone();
    if let Some(id) = id {
      let hwnd = hosted().as_ref().unwrap().get(&id).map(|h| h.hwnd);
      if let Some(h) = hwnd {
        win::focus(h);
      }
    }
  }
}

/// Whether a screen point is inside the player area while a service is showing.
/// Called from the mouse hook, so it never waits on a lock.
pub(crate) fn point_in_host(x: i32, y: i32) -> bool {
  #[cfg(windows)]
  {
    let (Ok(host), Ok(active)) = (HOST.try_lock(), ACTIVE.try_lock()) else {
      return false;
    };
    *host != 0 && active.is_some() && win::contains(*host, x, y)
  }
  #[cfg(not(windows))]
  {
    let _ = (x, y);
    false
  }
}

/// Back, forward, reload or home inside a hosted service.
#[tauri::command]
pub fn tv_host_nav(id: String, action: String) {
  let cmd = match action.as_str() {
    "back" => 1,
    "forward" => 2,
    "reload" => 3,
    "home" => 7,
    _ => return,
  };
  let map = hosted();
  if let Some(h) = map.as_ref().unwrap().get(&id) {
    #[cfg(windows)]
    win::app_command(h.hwnd, cmd);
    #[cfg(not(windows))]
    let _ = (h, cmd);
  }
}

/// Which services are running (still alive) right now.
#[tauri::command]
pub fn tv_host_running() -> Vec<String> {
  let mut map = hosted();
  let list = map.as_mut().unwrap();
  #[cfg(windows)]
  list.retain(|_, h| win::alive(h.hwnd));
  list.keys().cloned().collect()
}

/// Closes one service, or all of them when `id` is None.
#[tauri::command]
pub fn tv_host_close(id: Option<String>) -> usize {
  let mut map = hosted();
  let list = map.as_mut().unwrap();
  let keys: Vec<String> = match id {
    Some(id) => list.keys().filter(|k| **k == id).cloned().collect(),
    None => list.keys().cloned().collect(),
  };
  for k in &keys {
    if let Some(h) = list.remove(k) {
      kill_tree(h.pid);
    }
  }
  keys.len()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Poster {
  pub title: String,
  /// Card-sized artwork (600x900), sharp on a 1080p screen.
  pub image: String,
  /// Hero-sized artwork (1400x2100) for the big featured poster and its backdrop.
  pub image_hi: String,
  pub genre: String,
  pub summary: String,
  pub year: String,
}

/// Apple's artwork URLs end in `<w>x<h>bb.png` and serve any size up to the original, so the thumbnail the
/// feed hands out (about 113x170) can be swapped for a real poster.
fn art(url: &str, w: u32, h: u32) -> String {
  match url.rfind('/') {
    Some(i) => format!("{}/{}x{}bb.jpg", &url[..i], w, h),
    None => url.to_string(),
  }
}

async fn feed(url: &str) -> Result<Vec<Poster>, String> {
  let json: serde_json::Value = reqwest::Client::new()
    .get(url)
    .timeout(std::time::Duration::from_secs(12))
    .send()
    .await
    .map_err(|e| e.to_string())?
    .json()
    .await
    .map_err(|e| e.to_string())?;
  let entries = json["feed"]["entry"].as_array().cloned().unwrap_or_default();
  Ok(
    entries
      .iter()
      .filter_map(|e| {
        let title = e["im:name"]["label"].as_str()?.to_string();
        let thumb = e["im:image"].as_array()?.last()?["label"].as_str()?.to_string();
        let year = e["im:releaseDate"]["label"].as_str().unwrap_or("").chars().take(4).collect::<String>();
        Some(Poster {
          title,
          image: art(&thumb, 600, 900),
          image_hi: art(&thumb, 1400, 2100),
          genre: e["category"]["attributes"]["label"].as_str().unwrap_or("").to_string(),
          summary: e["summary"]["label"].as_str().unwrap_or("").chars().take(320).collect(),
          year,
        })
      })
      .collect(),
  )
}

/// This week's top films on Apple's store (public RSS, no key) for the home screen.
#[tauri::command]
pub async fn tv_top_movies() -> Result<Vec<Poster>, String> {
  feed("https://itunes.apple.com/za/rss/topmovies/limit=30/json").await
}

/// This week's top TV series on Apple's store.
#[tauri::command]
pub async fn tv_top_shows() -> Result<Vec<Poster>, String> {
  feed("https://itunes.apple.com/za/rss/toptvseasons/limit=30/json").await
}
