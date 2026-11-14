//! The desktop layer: our own window behind the desktop icons.
//!
//! Windows keeps the wallpaper on a `WorkerW` window that sits behind
//! `SHELLDLL_DefView` (the icon host). Sending the undocumented `0x052C` to Progman
//! makes Explorer create that WorkerW; we then parent our window to it. The result
//! sits above Explorer's wallpaper but below the desktop icons, so icons, right-click
//! and Win+D keep working.
//!
//! We render our own scenic wallpaper here. The user's Windows wallpaper setting is
//! never touched: if our layer goes away, their own wallpaper is simply visible again.
//!
//! Design: content sits directly on the wallpaper, no cards. A large, light clock and
//! the date are typeset at the top left, with a soft text shadow for legibility
//! instead of a scrim. Everything is static and redrawn only when the minute changes,
//! so the layer idles at zero cost.

use crate::engine::Engine;
use crate::gfx::{col, Align, Label, TextStyle};
use crate::scene::{self, Rect};
use crate::theme::Theme;
use crate::win;
use std::rc::Rc;
use windows::{
    core::{w, Interface, Result, BOOL, PCWSTR},
    UI::Composition::{ContainerVisual, Desktop::DesktopWindowTarget},
    Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::Gdi::UpdateWindow,
        System::{SystemInformation::GetLocalTime, WinRT::Composition::ICompositorDesktopInterop},
        UI::WindowsAndMessaging::*,
    },
};
use windows_numerics::Vector3;

pub const CLASS: PCWSTR = w!("UdaanNextDesktop");

/// Ask Progman to spawn the wallpaper WorkerW, then find it.
/// Layout A (Win10): Progman -> [WorkerW, SHELLDLL_DefView], the WorkerW we want is the
/// sibling that does NOT contain SHELLDLL_DefView.
/// Layout B (some builds / Win11 24H2): SHELLDLL_DefView lives under Progman itself,
/// and we parent to Progman.
fn find_worker_w() -> Option<HWND> {
    unsafe {
        let progman = FindWindowW(w!("Progman"), None).ok()?;
        // 0x052C: undocumented "spawn the wallpaper worker" message.
        let mut result = 0usize;
        let _ = SendMessageTimeoutW(
            progman,
            0x052C,
            windows::Win32::Foundation::WPARAM(0),
            LPARAM(0),
            SMTO_NORMAL,
            1000,
            Some(&mut result as *mut usize),
        );

        let mut found = HWND(std::ptr::null_mut());
        unsafe extern "system" fn enum_proc(hwnd: HWND, data: LPARAM) -> BOOL {
            let out = &mut *(data.0 as *mut HWND);
            if FindWindowExW(Some(hwnd), None, w!("SHELLDLL_DefView"), None).is_ok() {
                if let Ok(next) = FindWindowExW(None, Some(hwnd), w!("WorkerW"), None) {
                    if !next.0.is_null() {
                        *out = next;
                    }
                }
            }
            BOOL(1)
        }
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut found as *mut _ as isize));
        if !found.0.is_null() {
            println!("desktop: WorkerW layout A, parent {:?}", found.0);
            return Some(found);
        }
        if FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None).is_ok() {
            println!("desktop: WorkerW layout B, parenting to Progman");
            return Some(progman);
        }
        println!("desktop: no WorkerW found; falling back to a bottom-most window");
        None
    }
}

struct Vis {
    e: Rc<Engine>,
    _target: DesktopWindowTarget,
    _root: ContainerVisual,
    time: Label,
    date: Label,
}

pub struct Desktop {
    pub hwnd: HWND,
    pub area: RECT,
    vis: Option<Vis>,
    embedded: bool,
}

/// ("13:21", "Saturday 14 November"), 24-hour like the user's locale.
pub fn time_strings() -> (String, String) {
    const DAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    let t = unsafe { GetLocalTime() };
    (
        format!("{:02}:{:02}", t.wHour, t.wMinute),
        format!("{} {} {}", DAYS[(t.wDayOfWeek as usize) % 7], t.wDay, MONTHS[((t.wMonth as usize).max(1) - 1) % 12]),
    )
}

impl Desktop {
    pub fn create(e: &Rc<Engine>, t: &Theme, dark: bool) -> Result<Desktop> {
        let area = win::virtual_screen();
        let (w, h) = (area.right - area.left, area.bottom - area.top);
        let hwnd = win::create_window(CLASS, w!("Udaan desktop"), WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, area.left, area.top, w, h)?;

        let embedded = match find_worker_w() {
            Some(p) => unsafe { SetParent(hwnd, Some(p)).is_ok() },
            None => false,
        };
        if !embedded {
            // Not embedded: sit at the very bottom of the z-order, so we never cover
            // the user's windows.
            unsafe {
                let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), area.left, area.top, w, h, SWP_NOACTIVATE);
            }
        }

        let mut d = Desktop { hwnd, area, vis: None, embedded };
        d.rebuild(e, t, dark)?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNA);
            let _ = UpdateWindow(hwnd);
        }
        println!("desktop: {}x{} embedded={}", w, h, embedded);
        Ok(d)
    }

    pub fn rebuild(&mut self, e: &Rc<Engine>, t: &Theme, dark: bool) -> Result<()> {
        self.vis = None;
        let s = win::scale(self.hwnd);
        self.vis = Some(build(e, self.hwnd, t, dark, s, self.area)?);
        Ok(())
    }

    /// Redraws a label only when its text changed, so calling this every tick is free.
    pub fn set_clock(&mut self, time: &str, date: &str) {
        if let Some(v) = self.vis.as_mut() {
            let gpu = &v.e.gpu;
            let _ = v.time.set_text(gpu, time);
            let _ = v.date.set_text(gpu, date);
        }
    }

    /// Explorer restarted: the old WorkerW is gone, so re-parent.
    pub fn re_embed(&mut self) {
        if let Some(p) = find_worker_w() {
            unsafe {
                self.embedded = SetParent(self.hwnd, Some(p)).is_ok();
                let (w, h) = (self.area.right - self.area.left, self.area.bottom - self.area.top);
                let _ = SetWindowPos(self.hwnd, None, self.area.left, self.area.top, w, h, SWP_NOACTIVATE | SWP_NOZORDER);
                let _ = ShowWindow(self.hwnd, SW_SHOWNA);
            }
        }
    }

    pub fn destroy(mut self) {
        self.vis = None;
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
    }
}

/// The top-to-bottom darkening over the wallpaper. Also used inside dock glass, so the
/// blurred slice behind the dock matches the pixels around it.
pub fn vignette_brush(e: &Engine, t: &Theme) -> Result<Option<windows::UI::Composition::CompositionBrush>> {
    if t.vignette <= 0.0 {
        return Ok(None);
    }
    let c = &e.compositor;
    let grad = c.CreateLinearGradientBrush()?;
    grad.SetStartPoint(windows_numerics::Vector2 { X: 0.0, Y: 0.0 })?;
    grad.SetEndPoint(windows_numerics::Vector2 { X: 0.0, Y: 1.0 })?;
    let top = crate::theme::rgba(10, 10, 12, (t.vignette * 200.0) as u8);
    let mid = crate::theme::rgba(10, 10, 12, 0);
    let bot = crate::theme::rgba(10, 10, 12, (t.vignette * 260.0).min(255.0) as u8);
    grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(0.0, top)?)?;
    grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(0.40, mid)?)?;
    grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(1.0, bot)?)?;
    Ok(Some(grad.cast()?))
}

fn build(e: &Rc<Engine>, hwnd: HWND, t: &Theme, dark: bool, s: f32, area: RECT) -> Result<Vis> {
    let pal = t.palette(dark);
    let (w, h) = ((area.right - area.left) as f32, (area.bottom - area.top) as f32);
    let c = &e.compositor;
    let interop: ICompositorDesktopInterop = c.cast()?;
    let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, true)? };
    let root = c.CreateContainerVisual()?;
    root.SetSize(windows_numerics::Vector2 { X: w, Y: h })?;
    target.SetRoot(&root)?;

    // 1. The wallpaper, scaled to cover.
    let path = t.resolved_wallpaper();
    match e.gpu.image(c, &path, w as u32, h as u32) {
        Ok(img) => {
            root.Children()?.InsertAtTop(&img.visual)?;
            println!("desktop: wallpaper {path}");
            std::mem::forget(img); // the visual tree owns the surface from here
        }
        Err(err) => {
            println!("desktop: wallpaper {path} failed ({err}); using a flat fill");
            root.Children()?.InsertAtTop(&scene::fill(e, pal.glass_opaque, Rect::new(0.0, 0.0, w, h))?)?;
        }
    }

    // 2. A gentle vignette: darker at the top and bottom so the bar, clock and dock all
    // have a calm ground to sit on. It is the only thing between wallpaper and content.
    if let Some(brush) = vignette_brush(e, t)? {
        root.Children()?.InsertAtTop(&scene::sprite(e, &brush, Rect::new(0.0, 0.0, w, h))?)?;
    }

    // 3. Typography straight on the wallpaper. Asymmetric: anchored to the left edge
    // under the menu bar, not centred.
    let left = t.widget_margin * 3.0 * s;
    let top = t.topbar_height * s + t.widget_margin * 2.2 * s;
    let (time_str, date_str) = time_strings();

    let time_size = t.display * s;
    let time_style = TextStyle { family: t.family.clone(), size: time_size, weight: t.display_weight as u32, align: Align::Left, color: col(pal.text) };
    let (tw, th) = ((time_size * 3.4).ceil(), (time_size * 1.25).ceil());
    let mut time = e.gpu.label(c, tw as u32, th as u32, time_style)?.with_shadow(1.0);
    time.set_text(&e.gpu, &time_str)?;
    time.visual().SetOffset(Vector3 { X: left - time_size * 0.05, Y: top, Z: 0.0 })?;
    root.Children()?.InsertAtTop(time.visual())?;

    let date_size = t.title * 1.25 * s;
    let date_style = TextStyle { family: t.family.clone(), size: date_size, weight: 500, align: Align::Left, color: col(pal.text_secondary) };
    let (dw, dh) = ((date_size * 18.0).ceil(), (date_size * 2.0).ceil());
    let mut date = e.gpu.label(c, dw as u32, dh as u32, date_style)?.with_shadow(1.0);
    date.set_text(&e.gpu, &date_str)?;
    date.visual().SetOffset(Vector3 { X: left, Y: top + th * 0.78, Z: 0.0 })?;
    root.Children()?.InsertAtTop(date.visual())?;

    // Entrance: the type eases in once.
    for v in [crate::scene::as_visual(time.visual()), crate::scene::as_visual(date.visual())] {
        v.SetOpacity(0.0)?;
        crate::motion::opacity_to(c, &v, 1.0, t.settle);
    }

    Ok(Vis { e: e.clone(), _target: target, _root: root, time, date })
}
