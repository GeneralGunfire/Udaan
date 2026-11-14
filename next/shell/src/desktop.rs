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
//! Widgets (calendar, weather, photo) are frosted cards drawn on top, laid out from
//! the top-left like the macOS reference. They are static: drawn once, then the
//! compositor owns them and the layer idles at zero cost.

use crate::engine::Engine;
use crate::gfx::{col, Align, TextStyle};
use crate::scene::{self, Backdrop, GlassSpec, Rect};
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

        // Walk top-level windows for the WorkerW that is a sibling of the icon host.
        let mut found = HWND(std::ptr::null_mut());
        unsafe extern "system" fn enum_proc(hwnd: HWND, data: LPARAM) -> BOOL {
            let out = &mut *(data.0 as *mut HWND);
            // The WorkerW we want has a SHELLDLL_DefView child... its NEXT sibling is
            // the wallpaper host.
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
        // Layout B: icons are hosted directly by Progman.
        if FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None).is_ok() {
            println!("desktop: WorkerW layout B, parenting to Progman");
            return Some(progman);
        }
        println!("desktop: no WorkerW found; falling back to a bottom-most window");
        None
    }
}

struct Vis {
    _target: DesktopWindowTarget,
    _root: ContainerVisual,
}

pub struct Desktop {
    pub hwnd: HWND,
    pub area: RECT,
    vis: Option<Vis>,
    embedded: bool,
}

impl Desktop {
    pub fn create(e: &Rc<Engine>, t: &Theme, dark: bool) -> Result<Desktop> {
        let area = win::virtual_screen();
        let (w, h) = (area.right - area.left, area.bottom - area.top);
        let hwnd = win::create_window(CLASS, w!("Udaan desktop"), WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, area.left, area.top, w, h)?;

        let parent = find_worker_w();
        let embedded = match parent {
            Some(p) => unsafe { SetParent(hwnd, Some(p)).is_ok() },
            None => false,
        };
        if !embedded {
            // Not embedded: sit at the very bottom of the z-order instead, so we never
            // cover the user's windows.
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

fn month_name(m: u16) -> &'static str {
    const M: [&str; 12] = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    M[((m as usize).max(1) - 1) % 12]
}

/// Days in a month, with leap years.
fn days_in_month(y: u16, m: u16) -> u32 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                29
            } else {
                28
            }
        }
    }
}

/// Day of week (0=Sunday) for the 1st of a month, via Zeller.
fn first_weekday(y: u16, m: u16) -> u32 {
    let (mut y, mut m) = (y as i32, m as i32);
    if m < 3 {
        m += 12;
        y -= 1;
    }
    let k = y % 100;
    let j = y / 100;
    let h = (1 + (13 * (m + 1)) / 5 + k + k / 4 + j / 4 + 5 * j) % 7;
    (((h + 6) % 7) as u32) % 7
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

    // 2. A gentle vignette so widgets and the dock have something to sit against.
    if t.vignette > 0.0 {
        let grad = c.CreateLinearGradientBrush()?;
        grad.SetStartPoint(windows_numerics::Vector2 { X: 0.0, Y: 0.0 })?;
        grad.SetEndPoint(windows_numerics::Vector2 { X: 0.0, Y: 1.0 })?;
        let top = crate::theme::rgba(0, 0, 0, (t.vignette * 90.0) as u8);
        let mid = crate::theme::rgba(0, 0, 0, 0);
        let bot = crate::theme::rgba(0, 0, 0, (t.vignette * 150.0) as u8);
        grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(0.0, top)?)?;
        grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(0.45, mid)?)?;
        grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(1.0, bot)?)?;
        root.Children()?.InsertAtTop(&scene::sprite(e, &grad.cast()?, Rect::new(0.0, 0.0, w, h))?)?;
    }

    // 3. Widgets, top-left, like the reference: calendar and weather side by side,
    // then a photo card beneath them.
    let m = t.widget_margin * s;
    let gap = t.widget_gap * s;
    let top = t.topbar_height * s + m;
    let cal_w = t.widget_width * s;
    let cal_h = cal_w * 0.80;
    let wx = m;

    widget_calendar(e, t, dark, s, &root, Rect::new(wx, top, cal_w, cal_h))?;
    widget_weather(e, t, dark, s, &root, Rect::new(wx + cal_w + gap, top, cal_w * 0.86, cal_h))?;
    widget_photo(e, t, s, &root, Rect::new(wx, top + cal_h + gap, cal_w * 1.40, cal_h * 0.86))?;

    Ok(Vis { _target: target, _root: root })
}

/// Calendar: month name in accent, weekday initials, the day grid, today highlighted.
fn widget_calendar(e: &Rc<Engine>, t: &Theme, dark: bool, s: f32, root: &ContainerVisual, r: Rect) -> Result<()> {
    let pal = t.palette(dark);
    let panel = scene::glass(
        e,
        GlassSpec {
            rect: r,
            radius: t.r_widget * s,
            pal,
            backdrop: Backdrop::Opaque,
            shadow: Some(t.el_float),
            border_px: t.border_px * s,
            highlight: true,
        },
    )?;
    root.Children()?.InsertAtTop(&panel.root)?;

    let now = unsafe { GetLocalTime() };
    let pad = t.space[2] * s;
    let surf = e.gpu.surface(&e.compositor, r.w as u32, r.h as u32)?;
    let family = t.family.clone();
    let accent = col(pal.accent);
    let text = col(pal.text);
    let dim = col(pal.text_tertiary);
    let onacc = col(pal.accent_text);
    let (year, month, today) = (now.wYear, now.wMonth, now.wDay as u32);
    let engine = e.clone();
    surf.draw(move |ctx, cw, _ch| unsafe {
        use windows::Win32::Graphics::Direct2D::{Common::D2D_RECT_F, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_ROUNDED_RECT};
        use windows::Win32::Graphics::DirectWrite::DWRITE_MEASURING_MODE_NATURAL;
        let draw = |txt: &str, st: &TextStyle, x: f32, y: f32, w: f32, h: f32| -> Result<()> {
            let fmt = engine.format(st)?;
            let brush = ctx.CreateSolidColorBrush(&crate::gfx::d2d_color(st.color), None)?;
            let wide: Vec<u16> = txt.encode_utf16().collect();
            ctx.DrawText(&wide, &fmt, &D2D_RECT_F { left: x, top: y, right: x + w, bottom: y + h }, &brush, D2D1_DRAW_TEXT_OPTIONS_NONE, DWRITE_MEASURING_MODE_NATURAL);
            Ok(())
        };
        // Month header.
        let head = TextStyle { family: family.clone(), size: t_caption(s), weight: 700, align: Align::Left, color: accent };
        draw(month_name(month), &head, pad, pad * 0.6, cw - pad * 2.0, 16.0 * s)?;

        // Grid metrics.
        let gx = pad;
        let gy = pad * 0.6 + 20.0 * s;
        let cellw = (cw - pad * 2.0) / 7.0;
        let cellh = cellw * 0.78;

        // Weekday initials.
        let wd = TextStyle { family: family.clone(), size: 9.0 * s, weight: 600, align: Align::Center, color: dim };
        for (i, d) in ["S", "M", "T", "W", "T", "F", "S"].iter().enumerate() {
            draw(d, &wd, gx + i as f32 * cellw, gy, cellw, cellh * 0.8)?;
        }

        // Days.
        let daystyle = TextStyle { family: family.clone(), size: 10.0 * s, weight: 400, align: Align::Center, color: text };
        let todaystyle = TextStyle { color: onacc, weight: 700, ..daystyle.clone() };
        let start = first_weekday(year, month);
        let count = days_in_month(year, month);
        let rowtop = gy + cellh * 0.85;
        for day in 1..=count {
            let idx = start + day - 1;
            let (cx, cy) = (gx + (idx % 7) as f32 * cellw, rowtop + (idx / 7) as f32 * cellh);
            if day == today {
                // Accent disc behind today's number.
                let d = cellh.min(cellw) * 0.78;
                let b = ctx.CreateSolidColorBrush(&crate::gfx::d2d_color(accent), None)?;
                let rr = D2D1_ROUNDED_RECT {
                    rect: D2D_RECT_F {
                        left: cx + (cellw - d) / 2.0,
                        top: cy + (cellh - d) / 2.0,
                        right: cx + (cellw + d) / 2.0,
                        bottom: cy + (cellh + d) / 2.0,
                    },
                    radiusX: d / 2.0,
                    radiusY: d / 2.0,
                };
                ctx.FillRoundedRectangle(&rr, &b);
                draw(&day.to_string(), &todaystyle, cx, cy, cellw, cellh)?;
            } else {
                draw(&day.to_string(), &daystyle, cx, cy, cellw, cellh)?;
            }
        }
        Ok(())
    })?;
    panel.content.Children()?.InsertAtTop(&surf.visual)?;
    std::mem::forget(surf);
    Ok(())
}

fn t_caption(s: f32) -> f32 {
    11.0 * s
}

/// Weather: place, big temperature, condition and range. Static placeholder data until
/// a provider is wired up; the layout is what matters now.
fn widget_weather(e: &Rc<Engine>, t: &Theme, dark: bool, s: f32, root: &ContainerVisual, r: Rect) -> Result<()> {
    let pal = t.palette(dark);
    let panel = scene::glass(
        e,
        GlassSpec {
            rect: r,
            radius: t.r_widget * s,
            pal,
            backdrop: Backdrop::Opaque,
            shadow: Some(t.el_float),
            border_px: t.border_px * s,
            highlight: true,
        },
    )?;
    // A cool blue wash so the card reads as sky, like the reference weather widget.
    let grad = e.compositor.CreateLinearGradientBrush()?;
    grad.SetStartPoint(windows_numerics::Vector2 { X: 0.0, Y: 0.0 })?;
    grad.SetEndPoint(windows_numerics::Vector2 { X: 0.0, Y: 1.0 })?;
    grad.ColorStops()?.Append(&e.compositor.CreateColorGradientStopWithOffsetAndColor(0.0, crate::theme::rgba(74, 134, 214, 235))?)?;
    grad.ColorStops()?.Append(&e.compositor.CreateColorGradientStopWithOffsetAndColor(1.0, crate::theme::rgba(42, 92, 168, 235))?)?;
    panel.content.Children()?.InsertAtTop(&scene::sprite(e, &grad.cast()?, Rect::new(0.0, 0.0, r.w, r.h))?)?;
    root.Children()?.InsertAtTop(&panel.root)?;

    let pad = t.space[2] * s;
    let surf = e.gpu.surface(&e.compositor, r.w as u32, r.h as u32)?;
    let family = t.family.clone();
    let white = [1.0, 1.0, 1.0, 1.0];
    let soft = [1.0, 1.0, 1.0, 0.82];
    let engine = e.clone();
    surf.draw(move |ctx, cw, ch| unsafe {
        use windows::Win32::Graphics::Direct2D::{Common::D2D_RECT_F, D2D1_DRAW_TEXT_OPTIONS_NONE};
        use windows::Win32::Graphics::DirectWrite::DWRITE_MEASURING_MODE_NATURAL;
        let draw = |txt: &str, st: &TextStyle, x: f32, y: f32, w: f32, h: f32| -> Result<()> {
            let fmt = engine.format(st)?;
            let brush = ctx.CreateSolidColorBrush(&crate::gfx::d2d_color(st.color), None)?;
            let wide: Vec<u16> = txt.encode_utf16().collect();
            ctx.DrawText(&wide, &fmt, &D2D_RECT_F { left: x, top: y, right: x + w, bottom: y + h }, &brush, D2D1_DRAW_TEXT_OPTIONS_NONE, DWRITE_MEASURING_MODE_NATURAL);
            Ok(())
        };
        let place = TextStyle { family: family.clone(), size: 13.0 * s, weight: 700, align: Align::Left, color: white };
        draw("Johannesburg", &place, pad, pad * 0.5, cw - pad * 2.0, 18.0 * s)?;
        let temp = TextStyle { family: family.clone(), size: 40.0 * s, weight: 300, align: Align::Left, color: white };
        draw("24°", &temp, pad - 2.0 * s, pad * 0.5 + 16.0 * s, cw - pad, 48.0 * s)?;
        let cond = TextStyle { family: family.clone(), size: 12.0 * s, weight: 600, align: Align::Left, color: white };
        draw("Sunny", &cond, pad, ch - pad - 32.0 * s, cw - pad * 2.0, 16.0 * s)?;
        let range = TextStyle { family: family.clone(), size: 11.0 * s, weight: 400, align: Align::Left, color: soft };
        draw("H:27°  L:14°", &range, pad, ch - pad - 16.0 * s, cw - pad * 2.0, 16.0 * s)?;
        Ok(())
    })?;
    panel.content.Children()?.InsertAtTop(&surf.visual)?;
    std::mem::forget(surf);
    Ok(())
}

/// Photo: a rounded image card, like the reference's photo widget.
fn widget_photo(e: &Rc<Engine>, t: &Theme, s: f32, root: &ContainerVisual, r: Rect) -> Result<()> {
    let holder = scene::rounded(e, r, t.r_widget * s)?;
    let path = t.resolved_photo();
    match e.gpu.image(&e.compositor, &path, r.w as u32, r.h as u32) {
        Ok(img) => {
            holder.Children()?.InsertAtTop(&img.visual)?;
            std::mem::forget(img);
        }
        Err(err) => {
            println!("desktop: photo widget {path} failed ({err})");
            return Ok(());
        }
    }
    // Shadow under the card, matching the other widgets.
    let (sh, pad) = scene::shadow(e, r.w, r.h, t.r_widget * s, t.el_float, t.palette(true).shadow)?;
    sh.visual.SetOffset(Vector3 { X: r.x - pad, Y: r.y - pad + t.el_float.offset_y, Z: 0.0 })?;
    root.Children()?.InsertAtTop(&sh.visual)?;
    std::mem::forget(sh);
    root.Children()?.InsertAtTop(&holder)?;
    Ok(())
}
