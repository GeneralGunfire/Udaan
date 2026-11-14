//! Thin Win32 layer: monitors, AppBar registration, the DWM backdrop material, window
//! shape, system theme state. Everything here is a small safe wrapper over one or two
//! calls so the UI modules stay readable.

use windows::{
    core::{w, Result, BOOL, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, RECT, WPARAM},
        Graphics::Gdi::{CreateRoundRectRgn, EnumDisplayMonitors, SetWindowRgn, HDC, HMONITOR},
        System::{
            LibraryLoader::{GetModuleHandleW, GetProcAddress},
            ProcessStatus::K32GetProcessMemoryInfo,
            Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
            Threading::GetCurrentProcess,
        },
        UI::{
            HiDpi::GetDpiForWindow,
            Shell::{SHAppBarMessage, ABE_BOTTOM, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETAUTOHIDEBAR, ABM_SETPOS, APPBARDATA},
            WindowsAndMessaging::*,
        },
    },
};

pub const WM_APPBAR: u32 = WM_APP + 1;
pub const WM_MOUSELEAVE: u32 = 0x02A3;
pub const WM_DPICHANGED: u32 = 0x02E0;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Edge {
    Top,
    Bottom,
}

impl Edge {
    fn abe(self) -> u32 {
        match self {
            Edge::Top => ABE_TOP,
            Edge::Bottom => ABE_BOTTOM,
        }
    }
}

unsafe extern "system" fn collect_monitor(_m: HMONITOR, _dc: HDC, rc: *mut RECT, data: LPARAM) -> BOOL {
    let v = &mut *(data.0 as *mut Vec<RECT>);
    v.push(*rc);
    BOOL(1)
}

/// Monitor rectangles, primary first.
pub fn monitors() -> Vec<RECT> {
    let mut v: Vec<RECT> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect_monitor), LPARAM(&mut v as *mut _ as isize));
    }
    v.sort_by_key(|r| !(r.left == 0 && r.top == 0));
    v
}

pub fn virtual_screen() -> RECT {
    unsafe {
        let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
        RECT { left: x, top: y, right: x + GetSystemMetrics(SM_CXVIRTUALSCREEN), bottom: y + GetSystemMetrics(SM_CYVIRTUALSCREEN) }
    }
}

/// Device pixels per logical pixel for a window.
pub fn scale(hwnd: HWND) -> f32 {
    unsafe { GetDpiForWindow(hwnd) }.max(96) as f32 / 96.0
}

fn appbar_data(hwnd: HWND) -> APPBARDATA {
    APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, ..Default::default() }
}

/// Register an AppBar window. Returns whether an auto-hide slot was granted when asked.
pub fn appbar_register(hwnd: HWND, edge: Edge, want_autohide: bool) -> bool {
    unsafe {
        let mut abd = appbar_data(hwnd);
        abd.uCallbackMessage = WM_APPBAR;
        SHAppBarMessage(ABM_NEW, &mut abd);
        if want_autohide {
            abd.uEdge = edge.abe();
            abd.lParam = LPARAM(1);
            return SHAppBarMessage(ABM_SETAUTOHIDEBAR, &mut abd) != 0;
        }
        false
    }
}

/// Claim a strip of `thickness` device pixels on `edge` of `mon`. Returns the strip the
/// OS granted (it can move it if another bar already owns that edge).
/// Claim a strip of `thickness` device pixels on `edge` of `mon`.
///
/// The requested rect is always the strip we WANT, measured from the monitor edge, not
/// from whatever `ABM_QUERYPOS` hands back. `ABM_QUERYPOS` excludes bars that are
/// already registered, INCLUDING our own previous reservation, so feeding its result
/// back in makes the bar walk further from the edge on every rebuild (measured: the
/// top bar ended up at y=26 instead of y=0). We let the shell adjust the rect via
/// `ABM_SETPOS` and then honour whatever it returns.
pub fn appbar_reserve(hwnd: HWND, edge: Edge, mon: RECT, thickness: i32) -> RECT {
    unsafe {
        let mut abd = appbar_data(hwnd);
        abd.uEdge = edge.abe();
        abd.rc = match edge {
            Edge::Top => RECT { bottom: mon.top + thickness, ..mon },
            Edge::Bottom => RECT { top: mon.bottom - thickness, ..mon },
        };
        // SETPOS both reserves the space and returns the rect we actually got.
        SHAppBarMessage(ABM_SETPOS, &mut abd);
        abd.rc
    }
}

pub fn appbar_unregister(hwnd: HWND, edge: Edge, autohide: bool) {
    unsafe {
        let mut abd = appbar_data(hwnd);
        if autohide {
            abd.uEdge = edge.abe();
            abd.lParam = LPARAM(0);
            SHAppBarMessage(ABM_SETAUTOHIDEBAR, &mut abd);
        }
        SHAppBarMessage(ABM_REMOVE, &mut abd);
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Material {
    None,
    Blur,
    Acrylic,
    /// DWM supplies a blurred backdrop to a CreateHostBackdropBrush visual.
    Host,
}

impl Material {
    pub fn from_name(s: &str) -> Self {
        match s {
            "acrylic" => Material::Acrylic,
            "none" => Material::None,
            _ => Material::Blur,
        }
    }
}

/// DWM backdrop behind the window (undocumented but stable since 1803). `tint_abgr`
/// only matters for acrylic, where DWM blends it itself.
pub fn set_material(hwnd: HWND, m: Material, tint_abgr: u32) {
    #[repr(C)]
    struct Accent {
        state: u32,
        flags: u32,
        color_abgr: u32,
        anim: u32,
    }
    #[repr(C)]
    struct Data {
        attr: u32,
        data: *mut core::ffi::c_void,
        size: usize,
    }
    type F = unsafe extern "system" fn(HWND, *mut Data) -> i32;
    unsafe {
        let Ok(lib) = GetModuleHandleW(w!("user32.dll")) else { return };
        let Some(f) = GetProcAddress(lib, windows::core::s!("SetWindowCompositionAttribute")) else { return };
        let f: F = std::mem::transmute(f);
        let (state, flags, color) = match m {
            Material::None => (0, 0, 0),
            Material::Blur => (3, 2, 0),
            Material::Acrylic => (4, 2, tint_abgr),
            Material::Host => (5, 0, 0),
        };
        let mut a = Accent { state, flags, color_abgr: color, anim: 0 };
        let mut d = Data { attr: 19, data: &mut a as *mut _ as *mut _, size: std::mem::size_of::<Accent>() };
        f(hwnd, &mut d);
    }
}

/// Clip the window (and its DWM backdrop) to a rounded rectangle of its client size.
pub fn set_rounded_shape(hwnd: HWND, w: i32, h: i32, radius: i32) {
    unsafe {
        let d = (radius * 2).max(1);
        let rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, d, d);
        let _ = SetWindowRgn(hwnd, Some(rgn), true);
    }
}

pub fn clear_shape(hwnd: HWND) {
    unsafe {
        let _ = SetWindowRgn(hwnd, None, true);
    }
}

fn reg_dword(sub: PCWSTR, name: PCWSTR) -> Option<u32> {
    unsafe {
        let mut v: u32 = 0;
        let mut size = 4u32;
        let r = RegGetValueW(HKEY_CURRENT_USER, sub, name, RRF_RT_REG_DWORD, None, Some(&mut v as *mut _ as *mut _), Some(&mut size));
        if r.is_ok() { Some(v) } else { None }
    }
}

/// Windows "Choose your default app mode" setting.
pub fn system_dark() -> bool {
    reg_dword(w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"), w!("AppsUseLightTheme")).unwrap_or(0) == 0
}

/// Windows "Transparency effects" setting.
pub fn transparency_enabled() -> bool {
    reg_dword(w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"), w!("EnableTransparency")).unwrap_or(1) != 0
}

pub fn memory_mb() -> (f64, f64) {
    unsafe {
        let mut c = windows::Win32::System::ProcessStatus::PROCESS_MEMORY_COUNTERS_EX::default();
        c.cb = std::mem::size_of::<windows::Win32::System::ProcessStatus::PROCESS_MEMORY_COUNTERS_EX>() as u32;
        if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c as *mut _ as *mut _, c.cb).as_bool() {
            (c.WorkingSetSize as f64 / 1_048_576.0, c.PrivateUsage as f64 / 1_048_576.0)
        } else {
            (0.0, 0.0)
        }
    }
}

pub fn lparam_xy(lp: LPARAM) -> (i32, i32) {
    ((lp.0 & 0xffff) as i16 as i32, ((lp.0 >> 16) & 0xffff) as i16 as i32)
}

pub fn post(hwnd: HWND, msg: u32, wp: usize, lp: isize) {
    unsafe {
        let _ = PostMessageW(Some(hwnd), msg, WPARAM(wp), LPARAM(lp));
    }
}

pub fn window_rect(hwnd: HWND) -> RECT {
    let mut r = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd, &mut r);
    }
    r
}

/// Create one of our popup windows (composition-hosted, never activated).
pub fn create_window(class: PCWSTR, title: PCWSTR, ex: WINDOW_EX_STYLE, x: i32, y: i32, w: i32, h: i32) -> Result<HWND> {
    unsafe {
        let hinst = GetModuleHandleW(None)?;
        CreateWindowExW(WS_EX_NOREDIRECTIONBITMAP | ex, class, title, WS_POPUP, x, y, w, h, None, None, Some(hinst.into()), None)
    }
}

pub fn register_class(name: PCWSTR, proc: WNDPROC) {
    unsafe {
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        RegisterClassW(&WNDCLASSW {
            hInstance: hinst.into(),
            lpszClassName: name,
            lpfnWndProc: proc,
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            ..Default::default()
        });
    }
}
