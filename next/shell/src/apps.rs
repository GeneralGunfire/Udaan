//! Which apps are running, which one is in front, and launching/activating them.
//! A WinEvent hook (out of context, so no injection) posts a message to the core
//! window on window show/hide/destroy and foreground changes; the core debounces that
//! and rescans. Nothing polls.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use windows::{
    core::{w, PCWSTR, PWSTR, BOOL, HSTRING},
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
        Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::{
            Accessibility::{SetWinEventHook, HWINEVENTHOOK},
            Shell::ShellExecuteW,
            WindowsAndMessaging::*,
        },
    },
};

pub const WM_WINDOWS_CHANGED: u32 = WM_APP + 2;
const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;
const EVENT_OBJECT_DESTROY: u32 = 0x8001;
const EVENT_OBJECT_SHOW: u32 = 0x8002;
const EVENT_OBJECT_HIDE: u32 = 0x8003;
const WINEVENT_OUTOFCONTEXT: u32 = 0;
const WINEVENT_SKIPOWNPROCESS: u32 = 2;

thread_local! {
    static CORE: std::cell::Cell<HWND> = const { std::cell::Cell::new(HWND(std::ptr::null_mut())) };
    static PATHS: RefCell<HashMap<u32, Option<PathBuf>>> = RefCell::new(HashMap::new());
    static DESCRIPTIONS: RefCell<HashMap<PathBuf, String>> = RefCell::new(HashMap::new());
}

unsafe extern "system" fn hook_proc(_h: HWINEVENTHOOK, _ev: u32, hwnd: HWND, id_object: i32, id_child: i32, _tid: u32, _time: u32) {
    if id_object != 0 || id_child != 0 || hwnd.0.is_null() {
        return;
    }
    let core = CORE.with(|c| c.get());
    if !core.0.is_null() {
        let _ = PostMessageW(Some(core), WM_WINDOWS_CHANGED, windows::Win32::Foundation::WPARAM(0), LPARAM(0));
    }
}

/// Start watching top-level window changes; notifications arrive on `core`.
pub fn install_hooks(core: HWND) -> Vec<HWINEVENTHOOK> {
    CORE.with(|c| c.set(core));
    unsafe {
        vec![
            SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(hook_proc), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS),
            SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, None, Some(hook_proc), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS),
        ]
    }
}

fn process_path(pid: u32) -> Option<PathBuf> {
    PATHS.with(|p| {
        if let Some(v) = p.borrow().get(&pid) {
            return v.clone();
        }
        let v = unsafe {
            let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return None };
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_FORMAT(0), PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
            let _ = CloseHandle(h);
            if ok { Some(PathBuf::from(String::from_utf16_lossy(&buf[..len as usize]))) } else { None }
        };
        p.borrow_mut().insert(pid, v.clone());
        v
    })
}

/// A window the user would call "open": visible, not a tool window, not cloaked,
/// top-level, with a title.
fn is_app_window(hwnd: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
            return false;
        }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            return false;
        }
        if ex & WS_EX_APPWINDOW.0 == 0 && !GetWindow(hwnd, GW_OWNER).map(|o| o.0.is_null()).unwrap_or(true) {
            return false;
        }
        let mut cloaked: u32 = 0;
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4);
        cloaked == 0
    }
}

#[derive(Clone, Debug)]
pub struct AppWindow {
    pub hwnd: HWND,
    pub path: PathBuf,
}

unsafe extern "system" fn enum_proc(hwnd: HWND, data: LPARAM) -> BOOL {
    let v = &mut *(data.0 as *mut Vec<AppWindow>);
    if is_app_window(hwnd) {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if let Some(path) = process_path(pid) {
            v.push(AppWindow { hwnd, path });
        }
    }
    BOOL(1)
}

/// All open app windows, front to back.
pub fn scan() -> Vec<AppWindow> {
    let mut v: Vec<AppWindow> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut v as *mut _ as isize));
    }
    // Forget cached paths of processes that are gone.
    PATHS.with(|p| {
        let mut p = p.borrow_mut();
        if p.len() > 256 {
            p.clear();
        }
    });
    v
}

/// The foreground app's window and path, if it is an app window.
pub fn foreground() -> Option<AppWindow> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() || !is_app_window(hwnd) {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        process_path(pid).map(|path| AppWindow { hwnd, path })
    }
}

pub fn same_exe(a: &Path, b: &Path) -> bool {
    a.as_os_str().eq_ignore_ascii_case(b.as_os_str())
}

/// The executable's FileDescription ("Microsoft Edge"), else its file stem.
pub fn description(path: &Path) -> String {
    DESCRIPTIONS.with(|d| {
        if let Some(s) = d.borrow().get(path) {
            return s.clone();
        }
        let s = version_description(path).unwrap_or_else(|| {
            path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
        });
        d.borrow_mut().insert(path.to_path_buf(), s.clone());
        s
    })
}

fn version_description(path: &Path) -> Option<String> {
    unsafe {
        let wide = HSTRING::from(path.as_os_str());
        let size = GetFileVersionInfoSizeW(&wide, None);
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        GetFileVersionInfoW(&wide, None, size, buf.as_mut_ptr() as *mut _).ok()?;
        let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        if !VerQueryValueW(buf.as_ptr() as *const _, w!(r"\VarFileInfo\Translation"), &mut ptr, &mut len).as_bool() || len < 4 {
            return None;
        }
        let langs = std::slice::from_raw_parts(ptr as *const u16, (len / 2) as usize);
        for pair in langs.chunks_exact(2) {
            let key = format!("\\StringFileInfo\\{:04x}{:04x}\\FileDescription", pair[0], pair[1]);
            let key_w: Vec<u16> = key.encode_utf16().chain(std::iter::once(0)).collect();
            let mut p: *mut core::ffi::c_void = std::ptr::null_mut();
            let mut l = 0u32;
            if VerQueryValueW(buf.as_ptr() as *const _, PCWSTR(key_w.as_ptr()), &mut p, &mut l).as_bool() && l > 1 {
                let s = std::slice::from_raw_parts(p as *const u16, l as usize);
                let s = String::from_utf16_lossy(s).trim_end_matches('\0').trim().to_string();
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
        None
    }
}

pub fn launch(path: &Path) {
    unsafe {
        let wide = HSTRING::from(path.as_os_str());
        ShellExecuteW(None, w!("open"), &wide, None, None, SW_SHOWNORMAL);
    }
}

/// Bring an app's window to the front (restoring it if minimised).
pub fn activate(hwnd: HWND) {
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
}
