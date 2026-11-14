//! The dock: a floating glass pill near the bottom of each monitor.
//!
//! Geometry is measured from the macOS reference (55 px icons, 6 px gaps, 17 px off
//! the bottom, a near-invisible plate). The window is exactly the pill's bounds plus
//! headroom for magnified icons, and carries accent blur-behind; the composition
//! rounded clip is what shapes that blur (proven by the spike).
//!
//! Magnification is computed DIRECTLY on each mouse move: scale and offset are set,
//! not sprung, so the row tracks the cursor exactly like macOS. Springs carry only
//! the wave's entry and exit, and the press feedback. That avoids the "spring storm"
//! of the first attempt, which retargeted dozens of animations per mouse move and
//! felt mushy on this hardware.

use crate::apps::{self, AppWindow};
use crate::engine::Engine;
use crate::gfx::{bitmap_from_pixels, col, Align, Gpu, Surface, TextStyle};
use crate::motion;
use crate::scene::{self, as_visual, Backdrop, GlassSpec, Rect};
use crate::theme::{DockApp, Theme};
use crate::win::{self, Edge};
use std::path::PathBuf;
use std::rc::Rc;
use windows::{
    core::{w, Interface, Result, HSTRING},
    UI::Composition::{ContainerVisual, Desktop::DesktopWindowTarget, SpriteVisual},
    Win32::{
        Foundation::{HWND, RECT},
        Graphics::Direct2D::{Common::D2D_RECT_F, D2D1_INTERPOLATION_MODE_LINEAR, D2D1_ROUNDED_RECT},
        System::WinRT::Composition::ICompositorDesktopInterop,
        UI::{
            Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT},
            WindowsAndMessaging::*,
        },
    },
};
use windows_numerics::{Vector2, Vector3};

pub const CLASS: windows::core::PCWSTR = w!("UdaanNextDock");
pub const TIMER_HIDE: usize = 10;
pub const TIMER_SHRINK: usize = 11;
const TRIGGER_PX: i32 = 2;

struct Item {
    root: ContainerVisual,
    _icon: Surface,
    dot: SpriteVisual,
    /// Left edge at rest, in panel coordinates.
    rest_x: f32,
    /// Magnification factor applied right now (1.0 at rest).
    scale: f32,
    path: PathBuf,
    name: String,
    running: Vec<HWND>,
}

struct Vis {
    e: Rc<Engine>,
    _target: DesktopWindowTarget,
    /// Everything; slides as one for auto-hide.
    content: ContainerVisual,
    items: Vec<Item>,
    tag: crate::gfx::Label,
    tag_bg: ContainerVisual,
    tag_for: Option<usize>,
    tag_h: f32,
    tracking: bool,
    pressed: Option<usize>,
    /// True while the magnification wave is active.
    waving: bool,
    s: f32,
    icon: f32,
    gap: f32,
    /// The glass pill inside the window.
    plate: Rect,
    /// Icons sit with their bottom edge on this line.
    row_bottom: f32,
    win_h: f32,
}

pub struct Dock {
    pub hwnd: HWND,
    pub mon: RECT,
    pub autohide: bool,
    pub shown: bool,
    vis: Option<Vis>,
    width_px: i32,
    height_px: i32,
}

/// Pill size in device pixels for `n` icons.
fn plate_size(t: &Theme, s: f32, n: usize) -> (f32, f32) {
    let n = n.max(1) as f32;
    let w = (2.0 * t.dock_pad_x + n * t.dock_icon + (n - 1.0) * t.dock_gap) * s;
    let h = (2.0 * t.dock_pad_y + t.dock_icon) * s;
    (w.round(), h.round())
}

/// Headroom above the pill for magnified icons.
fn headroom(t: &Theme, s: f32) -> f32 {
    ((t.dock_icon * (t.magnify_max - 1.0) + t.magnify_rise + 30.0) * s).round()
}

fn side_room(t: &Theme, s: f32) -> f32 {
    (t.dock_icon * (t.magnify_max - 1.0) * s + 10.0 * s).round()
}

impl Dock {
    pub fn create(e: &Rc<Engine>, mon: RECT, t: &Theme, apps: &[DockApp], want_autohide: bool, dark: bool, transparent: bool) -> Result<Dock> {
        let hwnd = win::create_window(CLASS, w!("Udaan dock"), WS_EX_TOPMOST | WS_EX_TOOLWINDOW, mon.left, mon.bottom - 10, 10, 10)?;
        let autohide = win::appbar_register(hwnd, Edge::Bottom, want_autohide);
        if want_autohide && !autohide {
            println!("dock: autohide not granted on monitor ({},{}); docked instead", mon.left, mon.top);
        }
        let mut d = Dock { hwnd, mon, autohide, shown: !autohide, vis: None, width_px: 10, height_px: 10 };
        d.rebuild(e, t, apps, dark, transparent)?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNA);
        }
        Ok(d)
    }

    pub fn rebuild(&mut self, e: &Rc<Engine>, t: &Theme, apps: &[DockApp], dark: bool, transparent: bool) -> Result<()> {
        self.vis = None;
        let s = win::scale(self.hwnd);
        let (pw, ph) = plate_size(t, s, apps.len());
        let head = headroom(t, s);
        let side = side_room(t, s);
        self.width_px = (pw + 2.0 * side) as i32;
        self.height_px = (ph + head) as i32;
        self.place(t);

        // Accent blur on the window; the composition rounded clip shapes it (measured:
        // the clip IS respected on this machine). The headroom stays transparent.
        let blurred = transparent && t.material != "none";
        win::set_material(self.hwnd, if blurred { win::Material::Blur } else { win::Material::None }, 0);

        self.vis = Some(build(e, self.hwnd, t, apps, dark, blurred, self.shown, s, (pw, ph, head, side))?);
        Ok(())
    }

    fn reserve_px(&self, t: &Theme) -> i32 {
        let s = win::scale(self.hwnd);
        let (_, ph) = plate_size(t, s, 1);
        (ph + t.dock_bottom * s) as i32
    }

    pub fn place(&self, t: &Theme) {
        unsafe {
            let mon = self.mon;
            let s = win::scale(self.hwnd);
            let bottom_gap = (t.dock_bottom * s) as i32;
            let x = mon.left + (mon.right - mon.left - self.width_px) / 2;
            if self.autohide {
                if self.shown {
                    let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), x, mon.bottom - bottom_gap - self.height_px, self.width_px, self.height_px, SWP_NOACTIVATE);
                } else {
                    let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), mon.left, mon.bottom - TRIGGER_PX, mon.right - mon.left, TRIGGER_PX, SWP_NOACTIVATE);
                }
            } else {
                let strip = if t.dock_reserve {
                    win::appbar_reserve(self.hwnd, Edge::Bottom, mon, self.reserve_px(t))
                } else {
                    RECT { bottom: mon.bottom, ..mon }
                };
                let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), x, strip.bottom - bottom_gap - self.height_px, self.width_px, self.height_px, SWP_NOACTIVATE);
            }
        }
    }

    pub fn re_register(&self) {
        win::appbar_register(self.hwnd, Edge::Bottom, self.autohide);
    }

    pub fn unregister(&self) {
        win::appbar_unregister(self.hwnd, Edge::Bottom, self.autohide);
    }

    pub fn destroy(mut self) {
        self.unregister();
        self.vis = None;
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
    }

    pub fn slide(&mut self, t: &Theme, show: bool) {
        if self.shown == show {
            return;
        }
        self.shown = show;
        unsafe {
            let _ = KillTimer(Some(self.hwnd), TIMER_HIDE);
            let _ = KillTimer(Some(self.hwnd), TIMER_SHRINK);
        }
        if show {
            self.place(t);
        }
        if let Some(v) = &self.vis {
            motion::offset_to(&v.e.compositor, &as_visual(&v.content), Vector3 { X: 0.0, Y: if show { 0.0 } else { v.win_h }, Z: 0.0 }, t.slide);
        }
        if !show {
            unsafe {
                SetTimer(Some(self.hwnd), TIMER_SHRINK, (t.slide.period_ms * 1.3) as u32, None);
            }
        }
    }

    pub fn shrink_if_hidden(&self, t: &Theme) {
        if !self.shown {
            self.place(t);
        }
    }

    pub fn set_running(&mut self, windows: &[AppWindow], t: &Theme) {
        let Some(v) = self.vis.as_mut() else { return };
        for it in v.items.iter_mut() {
            let now: Vec<HWND> = windows.iter().filter(|w| apps::same_exe(&w.path, &it.path)).map(|w| w.hwnd).collect();
            let was = !it.running.is_empty();
            let is = !now.is_empty();
            it.running = now;
            if was != is {
                motion::opacity_to(&v.e.compositor, &as_visual(&it.dot), if is { 1.0 } else { 0.0 }, t.enter);
            }
        }
    }

    pub fn mouse_move(&mut self, t: &Theme, x: i32, y: i32) {
        if self.autohide {
            if !self.shown {
                self.slide(t, true);
                return;
            }
            unsafe {
                let _ = KillTimer(Some(self.hwnd), TIMER_HIDE);
            }
        }
        let Some(v) = self.vis.as_mut() else { return };
        if !v.tracking {
            v.tracking = true;
            let mut tm = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: self.hwnd, dwHoverTime: 0 };
            unsafe {
                let _ = TrackMouseEvent(&mut tm);
            }
        }
        v.update_wave(t, Some((x as f32, y as f32)));
    }

    pub fn mouse_leave(&mut self, t: &Theme) {
        if let Some(v) = self.vis.as_mut() {
            v.tracking = false;
            v.pressed = None;
            v.update_wave(t, None);
        }
        if self.autohide && self.shown {
            unsafe {
                SetTimer(Some(self.hwnd), TIMER_HIDE, 450, None);
            }
        }
    }

    pub fn button_down(&mut self, t: &Theme, x: i32, y: i32) {
        let Some(v) = self.vis.as_mut() else { return };
        if let Some(i) = v.hit(x as f32, y as f32) {
            v.pressed = Some(i);
            let sc = v.items[i].scale * t.press_scale;
            motion::scale_to(&v.e.compositor, &as_visual(&v.items[i].root), sc, t.tap);
        }
    }

    pub fn button_up(&mut self, t: &Theme, x: i32, y: i32) {
        let Some(v) = self.vis.as_mut() else { return };
        let Some(i) = v.pressed.take() else { return };
        motion::scale_to(&v.e.compositor, &as_visual(&v.items[i].root), v.items[i].scale, t.hover);
        if v.hit(x as f32, y as f32) != Some(i) {
            return;
        }
        let it = &v.items[i];
        if let Some(h) = it.running.first() {
            apps::activate(*h);
        } else {
            apps::launch(&it.path);
        }
    }
}

impl Vis {
    fn hit(&self, x: f32, y: f32) -> Option<usize> {
        // Test against where items are drawn right now, so a magnified icon is
        // clickable at its grown size.
        for (i, it) in self.items.iter().enumerate() {
            let off = it.root.Offset().unwrap_or_default();
            let sc = it.scale;
            let (w, h) = (self.icon * sc, self.icon * sc);
            let left = off.X + self.icon / 2.0 - w / 2.0;
            let top = off.Y + self.icon - h;
            if Rect::new(left, top, w, h).inflate(2.0).contains(x, y) {
                return Some(i);
            }
        }
        None
    }

    /// Recompute every icon's scale and position for the cursor, directly.
    /// `cursor` is None at rest. Only the wave's arrival and departure are sprung.
    fn update_wave(&mut self, t: &Theme, cursor: Option<(f32, f32)>) {
        let icon = self.icon;
        let n = self.items.len();
        if n == 0 {
            return;
        }
        let max = t.magnify_max;
        let sigma = t.magnify_sigma.max(0.2);

        // The wave only lives while the cursor is in the pill's band (plus the
        // headroom directly above it, so a magnified icon stays magnified).
        let active = cursor.filter(|(_, y)| *y >= self.plate.y - icon * 0.75 && *y <= self.plate.y + self.plate.h);
        let now_waving = active.is_some();
        // Arriving or leaving: spring, so it does not snap. Inside: direct, so it tracks.
        let transition = now_waving != self.waving;
        self.waving = now_waving;

        let mut scales = vec![1.0f32; n];
        let mut growth = vec![0.0f32; n];
        let mut hover: Option<usize> = None;
        let mut anchor = 0.0;

        if let Some((cx, _)) = active {
            let xr = cx - self.plate.x;
            for (i, it) in self.items.iter().enumerate() {
                let centre = it.rest_x + icon / 2.0;
                let d = (xr - centre) / icon;
                scales[i] = 1.0 + (max - 1.0) * (-(d * d) / (2.0 * sigma * sigma)).exp();
                growth[i] = (scales[i] - 1.0) * icon;
                if xr >= it.rest_x - self.gap / 2.0 && xr < it.rest_x + icon + self.gap / 2.0 {
                    hover = Some(i);
                }
            }
            // Anchor the icon under the cursor: growth spreads outward from that point,
            // so the icon you are pointing at does not slide away from the pointer.
            let h = hover.unwrap_or(if xr < 0.0 { 0 } else { n - 1 });
            let frac = ((xr - self.items[h].rest_x) / icon).clamp(0.0, 1.0);
            anchor = growth[..h].iter().sum::<f32>() + growth[h] * frac;
        }

        let mut pre = 0.0;
        for i in 0..n {
            let sc = scales[i];
            let left = self.items[i].rest_x + pre - anchor;
            pre += growth[i];
            let rise = t.magnify_rise * self.s * (sc - 1.0) / (max - 1.0).max(0.01);
            let ox = self.plate.x + left + growth[i] / 2.0;
            let oy = self.row_bottom - icon - rise;
            self.items[i].scale = sc;
            let it = &self.items[i];
            let v = as_visual(&it.root);
            if transition {
                motion::scale_to(&self.e.compositor, &v, sc, t.magnify);
                motion::offset_to(&self.e.compositor, &v, Vector3 { X: ox, Y: oy, Z: 0.0 }, t.magnify);
            } else {
                // Direct: stop any spring still running, then set the value.
                for p in ["Scale", "Offset"] {
                    let _ = v.StopAnimation(&HSTRING::from(p));
                }
                let _ = it.root.SetScale(Vector3 { X: sc, Y: sc, Z: 1.0 });
                let _ = it.root.SetOffset(Vector3 { X: ox, Y: oy, Z: 0.0 });
            }
        }

        // Name tag above the hovered icon.
        if hover != self.tag_for {
            self.tag_for = hover;
            let bg = as_visual(&self.tag_bg);
            match hover {
                Some(i) => {
                    let name = self.items[i].name.clone();
                    let _ = self.tag.set_text(&self.e.gpu, &name);
                    let tw = self.tag.surface.w as f32;
                    let cx = self.plate.x + self.items[i].rest_x + icon / 2.0 + (growth[..i].iter().sum::<f32>() + growth[i] / 2.0 - anchor);
                    // Clear of the tallest magnified icon, with a little air.
                    let grown = icon * (max - 1.0) + t.magnify_rise * self.s;
                    let ty = self.row_bottom - icon - grown - self.tag_h - 8.0 * self.s;
                    let _ = self.tag_bg.SetOffset(Vector3 { X: cx - tw / 2.0, Y: ty.max(0.0), Z: 0.0 });
                    motion::opacity_to(&self.e.compositor, &bg, 1.0, t.enter);
                }
                None => motion::opacity_to(&self.e.compositor, &bg, 0.0, t.exit),
            }
        }
    }
}

fn build(
    e: &Rc<Engine>,
    hwnd: HWND,
    t: &Theme,
    apps: &[DockApp],
    dark: bool,
    blurred: bool,
    shown: bool,
    s: f32,
    geo: (f32, f32, f32, f32),
) -> Result<Vis> {
    let (pw, ph, head, side) = geo;
    let pal = t.palette(dark);
    let (win_w, win_h) = (pw + 2.0 * side, ph + head);
    let c = &e.compositor;
    let interop: ICompositorDesktopInterop = c.cast()?;
    let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, true)? };
    let root = c.CreateContainerVisual()?;
    root.SetSize(Vector2 { X: win_w, Y: win_h })?;
    target.SetRoot(&root)?;

    let content = scene::container(e, Rect::new(0.0, if shown { 0.0 } else { win_h }, win_w, win_h))?;
    root.Children()?.InsertAtTop(&content)?;

    let plate = Rect::new(side, head, pw, ph);
    let panel = scene::glass(
        e,
        GlassSpec {
            rect: plate,
            radius: t.r_dock * s,
            pal,
            backdrop: if blurred { Backdrop::WindowBlur } else { Backdrop::Opaque },
            shadow: Some(t.el_float),
            border_px: t.border_px * s,
            highlight: true,
        },
    )?;
    content.Children()?.InsertAtTop(&panel.root)?;

    // The icon row lives ABOVE the glass, outside its clip, so magnified icons rise
    // out of the pill instead of being cut off by it.
    let row = scene::container(e, Rect::new(0.0, 0.0, win_w, win_h))?;
    content.Children()?.InsertAtTop(&row)?;

    let icon = (t.dock_icon * s).round();
    let gap = (t.dock_gap * s).round();
    let pad_x = (t.dock_pad_x * s).round();
    let pad_y = (t.dock_pad_y * s).round();
    let row_bottom = plate.y + ph - pad_y;
    let dot_d = (t.indicator * s).round().max(2.0);

    let mut items = Vec::with_capacity(apps.len());
    for (i, app) in apps.iter().enumerate() {
        let rest_x = pad_x + i as f32 * (icon + gap);
        let item = scene::container(e, Rect::new(plate.x + rest_x, row_bottom - icon, icon, icon))?;
        // Scale about the bottom centre, so icons grow upward out of the dock.
        item.SetCenterPoint(Vector3 { X: icon / 2.0, Y: icon, Z: 0.0 })?;

        // The real icon at full tile size. No plate behind it: the reference shows app
        // artwork directly on the glass.
        let surf = e.gpu.surface(c, icon as u32, icon as u32)?;
        let px_data = match Gpu::icon_pixels(&app.path.to_string_lossy(), icon as u32) {
            Ok(p) => Some(p),
            Err(err) => {
                println!("dock: no icon for {} ({err}); monogram", app.name);
                None
            }
        };
        let plate_col = col(pal.icon_plate);
        let accent = col(pal.accent);
        let accent_text = col(pal.accent_text);
        let initial: String = app.name.chars().next().map(|ch| ch.to_uppercase().to_string()).unwrap_or_else(|| "?".into());
        let family = t.family.clone();
        let r_icon = t.r_icon * s;
        let engine = e.clone();
        surf.draw(move |ctx, cw, ch| unsafe {
            let rr = D2D1_ROUNDED_RECT { rect: D2D_RECT_F { left: 0.0, top: 0.0, right: cw, bottom: ch }, radiusX: r_icon, radiusY: r_icon };
            match &px_data {
                Some((buf, bw, bh)) => {
                    if plate_col[3] > 0.003 {
                        let pb = ctx.CreateSolidColorBrush(&crate::gfx::d2d_color(plate_col), None)?;
                        ctx.FillRoundedRectangle(&rr, &pb);
                    }
                    let bmp = bitmap_from_pixels(ctx, buf, *bw, *bh)?;
                    ctx.DrawBitmap(&bmp, Some(&D2D_RECT_F { left: 0.0, top: 0.0, right: cw, bottom: ch }), 1.0, D2D1_INTERPOLATION_MODE_LINEAR, None, None);
                }
                None => {
                    let ab = ctx.CreateSolidColorBrush(&crate::gfx::d2d_color(accent), None)?;
                    ctx.FillRoundedRectangle(&rr, &ab);
                    let style = TextStyle { family: family.clone(), size: ch * 0.44, weight: 600, align: Align::Center, color: accent_text };
                    let fmt = engine.format(&style)?;
                    let tb = ctx.CreateSolidColorBrush(&crate::gfx::d2d_color(accent_text), None)?;
                    let wide: Vec<u16> = initial.encode_utf16().collect();
                    ctx.DrawText(
                        &wide,
                        &fmt,
                        &D2D_RECT_F { left: 0.0, top: 0.0, right: cw, bottom: ch },
                        &tb,
                        windows::Win32::Graphics::Direct2D::D2D1_DRAW_TEXT_OPTIONS_NONE,
                        windows::Win32::Graphics::DirectWrite::DWRITE_MEASURING_MODE_NATURAL,
                    );
                }
            }
            Ok(())
        })?;
        item.Children()?.InsertAtTop(&surf.visual)?;

        // Running dot, centred under the icon in the pill's bottom padding.
        let dot = scene::circle(e, pal.indicator, icon / 2.0, icon + pad_y / 2.0 + 1.0 * s, dot_d)?;
        dot.SetOpacity(0.0)?;
        item.Children()?.InsertAtTop(&dot)?;

        row.Children()?.InsertAtTop(&item)?;
        items.push(Item { root: item, _icon: surf, dot, rest_x, scale: 1.0, path: app.path.clone(), name: app.name.clone(), running: Vec::new() });
    }

    // Name tag: a small dark pill above the hovered icon.
    let tag_style = TextStyle { family: t.family.clone(), size: t.label * s, weight: 600, align: Align::Center, color: col(pal.text) };
    let (tag_w, tag_h) = ((130.0 * s).round(), (24.0 * s).round());
    let tag_bg = scene::rounded(e, Rect::new(0.0, 0.0, tag_w, tag_h), 6.0 * s)?;
    tag_bg.Children()?.InsertAtTop(&scene::fill(e, pal.widget_tint, Rect::new(0.0, 0.0, tag_w, tag_h))?)?;
    let tag = e.gpu.label(c, tag_w as u32, tag_h as u32, tag_style)?;
    tag_bg.Children()?.InsertAtTop(tag.visual())?;
    tag_bg.SetOpacity(0.0)?;
    content.Children()?.InsertAtTop(&tag_bg)?;

    // Entrance: the dock rises once and settles.
    if shown {
        let cv = as_visual(&content);
        cv.SetOffset(Vector3 { X: 0.0, Y: ph * 0.8, Z: 0.0 })?;
        cv.SetOpacity(0.0)?;
        motion::offset_to(&e.compositor, &cv, Vector3 { X: 0.0, Y: 0.0, Z: 0.0 }, t.enter);
        motion::opacity_to(&e.compositor, &cv, 1.0, t.enter);
    }

    Ok(Vis {
        e: e.clone(),
        _target: target,
        content,
        items,
        tag,
        tag_bg,
        tag_for: None,
        tag_h: tag_h,
        tracking: false,
        pressed: None,
        waving: false,
        s,
        icon,
        gap,
        plate,
        row_bottom,
        win_h,
    })
}
