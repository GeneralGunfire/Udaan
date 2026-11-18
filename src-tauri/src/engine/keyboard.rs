//! The keyboard: global shortcuts Udaan owns (the Win key, Win+<key>, double-tap Ctrl, Alt+`).
//!
//! Split in two on purpose. [`Keys`] is a pure state machine: it is fed key events and what is going on
//! around them (is a mouse button down, was there a click, is a Udaan window in front) and says what to
//! do. It has no Win32 in it, so the fiddly timing rules (a double-tap must be two short, lone Ctrl
//! presses, close together, with nothing in between) are tested with simulated clocks. The hook below it
//! is thin: it gathers that context, asks the state machine, and carries out the answer.
//!
//! What the rules are:
//! - **Win alone** opens Udaan's Start (and masks the key so Explorer's Start does not also open).
//! - **Win+<key>** for the shortcuts in [`win_combo`] is Udaan's; everything else (Win+L, Win+arrows,
//!   Win+Shift+S...) passes through to Windows unchanged.
//! - **Double-tap Ctrl** opens the 3D switcher. Strict, so ordinary Ctrl shortcuts and Ctrl+click never
//!   trigger it.
//! - **Alt+`** cycles the windows of the front app (macOS Cmd+`).

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_LSHIFT, VK_LWIN, VK_MBUTTON, VK_RBUTTON, VK_RSHIFT, VK_RWIN};
use windows::Win32::UI::WindowsAndMessaging::{
  CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, PostThreadMessageW, SetWindowsHookExW,
  TranslateMessage, UnhookWindowsHookEx, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL, WM_APP, WM_KEYDOWN,
  WM_SYSKEYDOWN,
};

/// Longest a Ctrl press may be held and still count as a tap.
const MAX_HOLD_MS: u32 = 220;
/// Longest pause between the first tap's release and the second press (the default; Settings → Window Switcher changes it).
const DEFAULT_GAP_MS: u32 = 350;
static GAP_MS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(DEFAULT_GAP_MS);

/// Sets the longest pause between the two taps, clamped to a sensible range.
pub fn set_gap_ms(ms: u32) {
  GAP_MS.store(ms.clamp(200, 600), std::sync::atomic::Ordering::Relaxed);
}

fn max_gap_ms() -> u32 {
  GAP_MS.load(std::sync::atomic::Ordering::Relaxed)
}

/// The shortcut id for Win+<key>, if Udaan owns it.
pub fn win_combo(vk: u32) -> Option<&'static str> {
  Some(match vk {
    0x44 => "show-desktop",   // D
    0x45 => "file-explorer",  // E
    0x41 => "quick-settings", // A
    0x4E => "notifications",  // N
    0x53 | 0x51 => "search",  // S, Q
    0x09 => "task-view",      // Tab
    0x5A => "snap-layouts",   // Z
    0x31 => "dock-1",
    0x32 => "dock-2",
    0x33 => "dock-3",
    0x34 => "dock-4",
    0x35 => "dock-5",
    0x36 => "dock-6",
    0x37 => "dock-7",
    0x38 => "dock-8",
    0x39 => "dock-9",
    _ => return None,
  })
}

fn is_ctrl(vk: u32) -> bool {
  matches!(vk, 0x11 | 0xA2 | 0xA3)
}

fn is_win(vk: u32) -> bool {
  vk == VK_LWIN.0 as u32 || vk == VK_RWIN.0 as u32
}

fn is_shift(vk: u32) -> bool {
  vk == VK_LSHIFT.0 as u32 || vk == VK_RSHIFT.0 as u32
}

// ---------------------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------------------

/// One key going down or up.
#[derive(Debug, Clone, Copy)]
pub struct KeyEvent {
  pub vk: u32,
  pub down: bool,
  /// Tick time in milliseconds (wraps around; only differences are used).
  pub time: u32,
  /// Alt is held.
  pub alt: bool,
}

/// What is going on around a key event that the state machine cannot know itself.
#[derive(Debug, Clone, Copy, Default)]
pub struct Context {
  pub mouse_down: bool,
  /// Tick time of the most recent mouse click, if any.
  pub last_click: Option<u32>,
  /// A Udaan window is in front.
  pub own_foreground: bool,
}

impl Context {
  /// True when a click happened at or after tick `t`.
  fn clicked_since(&self, t: u32) -> bool {
    self.last_click.map(|c| c.wrapping_sub(t) < 0x8000_0000).unwrap_or(false)
  }
}

/// What the hook should do about a key event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Reaction {
  /// Tell the shell windows this shortcut was pressed.
  pub hotkey: Option<&'static str>,
  /// Press a harmless unassigned key so Explorer's own Start does not also open.
  pub mask_win: bool,
  /// Do not pass the key on to the rest of the system.
  pub swallow: bool,
}

#[derive(Debug, Default)]
pub struct Keys {
  shift: bool,
  ctrl: bool,
  win: bool,
  /// Another key was pressed while Win was held, so releasing Win is not a lone tap.
  win_combo: bool,
  // double-tap Ctrl
  press_at: u32,
  /// The current press was spoiled (another key, a click, a modifier).
  dirty: bool,
  /// A clean first tap has been released and is waiting for its partner.
  armed: bool,
  first_up: u32,
}

impl Keys {
  pub fn handle(&mut self, e: KeyEvent, ctx: &Context) -> Reaction {
    let mut r = Reaction::default();
    let vk = e.vk;
    if is_shift(vk) {
      self.shift = e.down;
    } else if is_ctrl(vk) {
      self.on_ctrl(e, ctx, &mut r);
    } else if is_win(vk) {
      self.on_win(e, &mut r);
    } else if e.down && vk == 0xC0 && e.alt && !self.win {
      // Alt+` / Alt+Shift+`: cycle windows of the front app.
      r.hotkey = Some(if self.shift { "prev-app-window" } else { "next-app-window" });
      r.swallow = true;
      return r;
    } else if e.down && self.win {
      self.win_combo = true;
      let modified = self.shift || self.ctrl || e.alt;
      if !modified {
        if let Some(id) = win_combo(vk) {
          // Win+Z only means Snap Layouts for Udaan's own windows.
          if id == "snap-layouts" && !ctx.own_foreground {
            return r;
          }
          r.hotkey = Some(id);
          r.swallow = true;
          return r;
        }
      }
      // Everything else (Win+L, Win+R, Win+arrows, Win+Shift+S...) passes through to Windows.
    }
    // Any other key (a letter, Shift, Alt, Win) spoils a tap in progress and breaks a half-done double-tap.
    if e.down && !is_ctrl(vk) {
      self.dirty = true;
      self.armed = false;
    }
    r
  }

  fn on_ctrl(&mut self, e: KeyEvent, ctx: &Context, r: &mut Reaction) {
    let was_down = self.ctrl;
    self.ctrl = e.down;
    if e.down && self.win {
      // Win+Ctrl+... belongs to Windows (virtual desktops).
      self.win_combo = true;
    }
    if e.down && !was_down {
      // A fresh press (auto-repeat of a held key is ignored).
      let busy = self.shift || self.win || e.alt || ctx.mouse_down;
      self.dirty = busy;
      self.press_at = e.time;
      if self.armed && (busy || e.time.wrapping_sub(self.first_up) > max_gap_ms() || ctx.clicked_since(self.first_up)) {
        self.armed = false;
      }
    } else if !e.down && was_down {
      let clean = !self.dirty && e.time.wrapping_sub(self.press_at) <= MAX_HOLD_MS && !ctx.clicked_since(self.press_at);
      if !clean {
        self.armed = false;
      } else if self.armed && self.press_at.wrapping_sub(self.first_up) <= max_gap_ms() {
        self.armed = false;
        r.hotkey = Some("switcher-ctrl");
      } else {
        self.armed = true;
        self.first_up = e.time;
      }
    }
  }

  fn on_win(&mut self, e: KeyEvent, r: &mut Reaction) {
    if e.down {
      if !self.win {
        self.win = true;
        self.win_combo = false;
        // Mask the key the moment it goes DOWN, so Windows always sees "Win + another key" and never
        // opens its own Start on release. Masking only on release was too late some of the time: Start
        // would still open, most visibly when Udaan's Start was already showing and Win was pressed to
        // close it. (Win+<key> shortcuts are unaffected: the extra key is one nothing is assigned to.)
        r.mask_win = true;
      }
    } else {
      self.win = false;
      if !std::mem::take(&mut self.win_combo) {
        // A lone Win tap opens (or closes) Udaan's Start.
        r.hotkey = Some("start");
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------------------

static ENABLED: AtomicBool = AtomicBool::new(false);
static HOOK: Mutex<Option<isize>> = Mutex::new(None);
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
static STATE: Mutex<Option<Keys>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();

const WM_HOOK_ON: u32 = WM_APP + 1;
const WM_HOOK_OFF: u32 = WM_APP + 2;

#[derive(Serialize, Clone)]
struct HotkeyEvent {
  id: String,
}

/// Tells the shell windows a hotkey or gesture happened (`shell://hotkey`).
pub fn emit_hotkey(id: &'static str) {
  if let Some(app) = APP.get() {
    let _ = app.emit("shell://hotkey", HotkeyEvent { id: id.to_string() });
  }
}

fn mouse_button_down() -> bool {
  unsafe { [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|&b| GetAsyncKeyState(b.0 as i32) as u16 & 0x8000 != 0) }
}

fn foreground_is_own_process() -> bool {
  let mut pid = 0u32;
  unsafe {
    GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
  }
  pid == std::process::id()
}

unsafe extern "system" fn on_key(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  if code == HC_ACTION as i32 && ENABLED.load(Ordering::Relaxed) {
    let k = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
    // Keys we pressed ourselves (the Win-key mask) are not the user's.
    if k.flags.0 & LLKHF_INJECTED.0 == 0 {
      let msg = wparam.0 as u32;
      let event = KeyEvent { vk: k.vkCode, down: msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN, time: k.time, alt: k.flags.0 & LLKHF_ALTDOWN.0 != 0 };
      let click = crate::shell::gesture::LAST_CLICK_MS.load(Ordering::Relaxed);
      let ctx = Context { mouse_down: mouse_button_down(), last_click: (click != 0).then_some(click), own_foreground: foreground_is_own_process() };
      let reaction = STATE.lock().map(|mut s| s.get_or_insert_with(Keys::default).handle(event, &ctx)).unwrap_or_default();
      if reaction.mask_win {
        // An unassigned key press between the Win press and release stops Explorer's Start menu
        // (the technique AutoHotkey uses).
        super::window_actions::tap_virtual_key(0xE8);
      }
      if let Some(id) = reaction.hotkey {
        emit_hotkey(id);
      }
      if reaction.swallow {
        return LRESULT(1);
      }
    }
  }
  CallNextHookEx(None, code, wparam, lparam)
}

fn install() {
  let mut g = HOOK.lock().unwrap_or_else(|e| e.into_inner());
  if g.is_some() {
    return;
  }
  unsafe {
    let hmod = GetModuleHandleW(None).ok();
    if let Ok(h) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(on_key), hmod.map(|m| windows::Win32::Foundation::HINSTANCE(m.0)), 0) {
      *g = Some(h.0 as isize);
    }
  }
}

fn remove() {
  let mut g = HOOK.lock().unwrap_or_else(|e| e.into_inner());
  if let Some(h) = g.take() {
    unsafe {
      let _ = UnhookWindowsHookEx(HHOOK(h as *mut core::ffi::c_void));
    }
  }
}

/// Whether the low-level hook is currently installed (for the doctor).
pub fn is_installed() -> bool {
  HOOK.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// Whether the hook is meant to be on.
pub fn is_enabled() -> bool {
  ENABLED.load(Ordering::Relaxed)
}

/// Turns the keyboard hook on or off.
pub fn set_enabled(enabled: bool) {
  ENABLED.store(enabled, Ordering::Relaxed);
  let t = HOOK_THREAD.load(Ordering::Relaxed);
  if t != 0 {
    unsafe {
      let _ = PostThreadMessageW(t, if enabled { WM_HOOK_ON } else { WM_HOOK_OFF }, WPARAM(0), LPARAM(0));
    }
  }
}

/// Starts the hook thread. A low-level hook is delivered through its installing thread's message loop,
/// so this thread does nothing else.
pub fn start(app: AppHandle) {
  let _ = APP.set(app);
  let _ = std::thread::Builder::new().name("udaan-keyboard-hook".into()).spawn(|| unsafe {
    HOOK_THREAD.store(GetCurrentThreadId(), Ordering::Relaxed);
    if ENABLED.load(Ordering::Relaxed) {
      install();
    }
    let mut msg = MSG::default();
    while GetMessageW(&mut msg, Some(HWND::default()), 0, 0).0 > 0 {
      match msg.message {
        WM_HOOK_ON => install(),
        WM_HOOK_OFF => remove(),
        _ => {
          let _ = TranslateMessage(&msg);
          DispatchMessageW(&msg);
        }
      }
    }
    remove();
  });
}

/// Turns the hook on or off. While it is on, its undo is registered with the guard, so the hook can
/// never outlive an exit or a main-thread panic.
#[tauri::command]
pub fn shell_set_keyboard_hook(enabled: bool) {
  set_enabled(enabled);
  if enabled {
    super::guard::register("keyboard-hook", || set_enabled(false));
  } else {
    super::guard::cancel("keyboard-hook");
  }
}

/// Undo on exit.
pub fn restore_on_exit() {
  set_enabled(false);
}

#[cfg(test)]
mod tests {
  use super::*;

  const CTRL: u32 = 0xA2;
  const WIN: u32 = 0x5B;
  const SHIFT: u32 = 0xA0;

  fn ev(vk: u32, down: bool, time: u32) -> KeyEvent {
    KeyEvent { vk, down, time, alt: false }
  }
  /// A clean Ctrl tap: down at `t`, up `hold` ms later.
  fn tap(k: &mut Keys, t: u32, hold: u32, ctx: &Context) -> Reaction {
    k.handle(ev(CTRL, true, t), ctx);
    k.handle(ev(CTRL, false, t + hold), ctx)
  }
  fn fired(r: Reaction) -> bool {
    r.hotkey == Some("switcher-ctrl")
  }

  #[test]
  fn two_quick_lone_ctrl_taps_open_the_switcher_once() {
    let (mut k, ctx) = (Keys::default(), Context::default());
    assert!(!fired(tap(&mut k, 1000, 80, &ctx)), "one tap does nothing yet");
    assert!(fired(tap(&mut k, 1200, 80, &ctx)), "the second, soon after, fires");
    // a third tap right after is a new first tap, not another firing
    assert!(!fired(tap(&mut k, 1400, 80, &ctx)));
    assert!(fired(tap(&mut k, 1600, 80, &ctx)));
  }

  #[test]
  fn taps_too_far_apart_or_held_too_long_do_not_count() {
    let (mut k, ctx) = (Keys::default(), Context::default());
    tap(&mut k, 1000, 80, &ctx);
    assert!(!fired(tap(&mut k, 2000, 80, &ctx)), "a second tap a second later is a new first tap");
    let mut k = Keys::default();
    assert!(!fired(tap(&mut k, 1000, 500, &ctx)), "held 500 ms is not a tap");
    assert!(!fired(tap(&mut k, 1700, 80, &ctx)), "so the next one is only a first tap");
  }

  #[test]
  fn ordinary_ctrl_shortcuts_never_trigger_it() {
    let (mut k, ctx) = (Keys::default(), Context::default());
    // Ctrl+C then Ctrl+V quickly: another key was pressed during each Ctrl hold
    k.handle(ev(CTRL, true, 1000), &ctx);
    k.handle(ev(0x43, true, 1030), &ctx);
    k.handle(ev(0x43, false, 1060), &ctx);
    assert!(!fired(k.handle(ev(CTRL, false, 1090), &ctx)));
    k.handle(ev(CTRL, true, 1150), &ctx);
    k.handle(ev(0x56, true, 1180), &ctx);
    k.handle(ev(0x56, false, 1210), &ctx);
    assert!(!fired(k.handle(ev(CTRL, false, 1240), &ctx)));
  }

  #[test]
  fn clicks_and_modifiers_spoil_a_tap() {
    let mut k = Keys::default();
    // Ctrl+click: the mouse is down at the press
    let down = Context { mouse_down: true, ..Context::default() };
    tap(&mut k, 1000, 80, &down);
    assert!(!fired(tap(&mut k, 1200, 80, &down)));
    // a click BETWEEN the two taps breaks the pair
    let mut k = Keys::default();
    let none = Context::default();
    tap(&mut k, 1000, 80, &none);
    let clicked = Context { last_click: Some(1150), ..none };
    assert!(!fired(tap(&mut k, 1200, 80, &clicked)));
    // Shift held while tapping
    let mut k = Keys::default();
    k.handle(ev(SHIFT, true, 900), &none);
    assert!(!fired(tap(&mut k, 1000, 80, &none)));
    // a repeat of a held key is not a fresh press
    let mut k = Keys::default();
    k.handle(ev(CTRL, true, 1000), &none);
    k.handle(ev(CTRL, true, 1030), &none);
    k.handle(ev(CTRL, true, 1060), &none);
    assert!(!fired(k.handle(ev(CTRL, false, 1090), &none)), "one press, however long it auto-repeated");
  }

  #[test]
  fn a_lone_win_tap_masks_on_press_and_opens_start_on_release() {
    let (mut k, ctx) = (Keys::default(), Context::default());
    // the mask goes in as the key goes down, before Windows can decide to open its own Start
    assert_eq!(k.handle(ev(WIN, true, 0), &ctx), Reaction { hotkey: None, mask_win: true, swallow: false });
    // holding Win (auto-repeat) does not mask again
    assert_eq!(k.handle(ev(WIN, true, 30), &ctx), Reaction::default());
    let up = k.handle(ev(WIN, false, 60), &ctx);
    assert_eq!(up, Reaction { hotkey: Some("start"), mask_win: false, swallow: false });
    // and pressing it again to close Udaan's Start behaves identically every time
    assert_eq!(k.handle(ev(WIN, true, 900), &ctx).mask_win, true);
    assert_eq!(k.handle(ev(WIN, false, 940), &ctx).hotkey, Some("start"));
  }

  #[test]
  fn win_plus_a_key_is_a_shortcut_and_does_not_open_start() {
    let (mut k, ctx) = (Keys::default(), Context::default());
    assert!(k.handle(ev(WIN, true, 0), &ctx).mask_win);
    let d = k.handle(ev(0x44, true, 30), &ctx);
    assert_eq!(d, Reaction { hotkey: Some("show-desktop"), mask_win: false, swallow: true });
    k.handle(ev(0x44, false, 60), &ctx);
    assert_eq!(k.handle(ev(WIN, false, 90), &ctx), Reaction::default(), "releasing Win after a combo is not a Start tap");
    // dock slots
    k.handle(ev(WIN, true, 200), &ctx);
    assert_eq!(k.handle(ev(0x33, true, 230), &ctx).hotkey, Some("dock-3"));
  }

  #[test]
  fn win_shortcuts_udaan_does_not_own_pass_through_to_windows() {
    let (mut k, ctx) = (Keys::default(), Context::default());
    k.handle(ev(WIN, true, 0), &ctx);
    let l = k.handle(ev(0x4C, true, 30), &ctx); // Win+L
    assert_eq!(l, Reaction::default(), "Win+L passes through");
    assert_eq!(k.handle(ev(WIN, false, 90), &ctx), Reaction::default(), "and was a combo, so no Start");
    // Win+Shift+<key> and Win+Ctrl+<key> belong to Windows
    let mut k = Keys::default();
    k.handle(ev(WIN, true, 0), &ctx);
    k.handle(ev(SHIFT, true, 20), &ctx);
    assert_eq!(k.handle(ev(0x44, true, 40), &ctx).hotkey, None);
    let mut k = Keys::default();
    k.handle(ev(WIN, true, 0), &ctx);
    k.handle(ev(CTRL, true, 20), &ctx);
    assert_eq!(k.handle(ev(0x44, true, 40), &ctx).hotkey, None);
    assert_eq!(k.handle(ev(WIN, false, 90), &ctx), Reaction::default());
  }

  #[test]
  fn win_z_is_snap_layouts_only_for_udaans_own_windows() {
    let mut k = Keys::default();
    let foreign = Context { own_foreground: false, ..Context::default() };
    k.handle(ev(WIN, true, 0), &foreign);
    assert_eq!(k.handle(ev(0x5A, true, 30), &foreign), Reaction::default(), "left to Windows");
    let mut k = Keys::default();
    let own = Context { own_foreground: true, ..Context::default() };
    k.handle(ev(WIN, true, 0), &own);
    assert_eq!(k.handle(ev(0x5A, true, 30), &own).hotkey, Some("snap-layouts"));
  }

  #[test]
  fn alt_backtick_cycles_the_front_apps_windows_and_is_swallowed() {
    let (mut k, ctx) = (Keys::default(), Context::default());
    let alt = |vk, down, time| KeyEvent { vk, down, time, alt: true };
    assert_eq!(k.handle(alt(0xC0, true, 0), &ctx), Reaction { hotkey: Some("next-app-window"), mask_win: false, swallow: true });
    k.handle(ev(SHIFT, true, 100), &ctx);
    assert_eq!(k.handle(alt(0xC0, true, 120), &ctx).hotkey, Some("prev-app-window"));
  }
}
