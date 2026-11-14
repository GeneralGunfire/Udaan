//! The dock: a floating glass pill near the bottom of each monitor.
//!
//! Sizing is measured from the macOS reference (55 px icons, 6 px gaps, 17 px off the
//! bottom). The look is Udaan's own: very light glass, no border, no slab, one blue dot
//! for running apps, a soft shadow below and a highlight on the top edge.
//!
//! Glass material. Windows 10's accent blur fills its whole window rectangle and
//! ignores any rounded clip (measured: the corners stayed blurred), so it cannot make a
//! rounded pill. Instead the glass is built from OUR OWN wallpaper: a slice of the
//! scenic wallpaper behind the dock is blurred once on the GPU and shown inside a
//! composition rounded clip, which antialiases correctly and costs nothing at rest. The
//! dock reserves its screen strip, so what is behind it really is our wallpaper.
//!
//! Motion. Magnification is computed directly from the cursor, not sprung. While the
//! pointer moves, a short per-frame ramp eases the wave in or out (a 16 ms timer that
//! stops by itself); at rest nothing runs. The pill widens with the wave so icons never
//! spill out of it, and icons tilt in 3D toward the cursor under a perspective
//! transform.

use crate::apps::{self, AppWindow};
use crate::engine::Engine;
use crate::gfx::{bitmap_from_pixels, col, Align, Gpu, Surface, TextStyle};
use crate::motion;
use crate::scene::{self, as_visual, Rect};
use crate::theme::{DockApp, Theme};
use crate::win::{self, Edge};
use std::path::PathBuf;
use std::rc::Rc;
use windows::{
    core::{w, Interface, Result, HSTRING},
    UI::Composition::{CompositionRoundedRectangleGeometry, ContainerVisual, Desktop::DesktopWindowTarget, SpriteVisual},
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
pub const TIMER_REGION: usize = 12;
pub const TIMER_RAMP: usize = 13;
const TRIGGER_PX: i32 = 2;
/// ~60 Hz, but only while the wave is easing in or out.
const RAMP_MS: u32 = 16;

struct Item {
    root: ContainerVisual,
    _icon: Surface,
    dot: SpriteVisual,
    /// Left edge at rest, in window coordinates.
    rest_x: f32,
    /// Current drawn box: left edge, width factor, rise above the row.
    cur_left: f32,
    scale: f32,
    rise: f32,
    /// A press/release spring is running on this item.
    springy: bool,
    path: PathBuf,
    name: String,
    running: Vec<HWND>,
}

struct Vis {
    e: Rc<Engine>,
    _target: DesktopWindowTarget,
    /// Everything; slides as one for auto-hide.
    content: ContainerVisual,
    /// The pill's shape, resized as the wave widens it.
    shape: CompositionRoundedRectangleGeometry,
    shadow: SpriteVisual,
    shadow_w: f32,
    items: Vec<Item>,
    tag: crate::gfx::Label,
    tag_bg: ContainerVisual,
    tag_for: Option<usize>,
    tracking: bool,
    pressed: Option<usize>,
    /// Wave strength 0..1 (eased), where it is heading, and the last cursor position.
    amp: f32,
    amp_target: f32,
    cursor: Option<(f32, f32)>,
    s: f32,
    icon: f32,
    gap: f32,
    pad_x: f32,
    /// The resting glass pill, in window coordinates.
    plate: Rect,
    /// The area the glass layers cover (pill plus room to widen).
    extent: Rect,
    row_bottom: f32,
    win_h: f32,
}

pub struct Dock {
    pub hwnd: HWND,
    geo: (i32, i32, i32, i32), // plate w, plate h, headroom, side room (device px)
    region_full: bool,
    ramping: bool,
    pub mon: RECT,
    pub autohide: bool,
    pub shown: bool,
    vis: Option<Vis>,
    width_px: i32,
    height_px: i32,
}

fn plate_size(t: &Theme, s: f32, n: usize) -> (f32, f32) {
    let n = n.max(1) as f32;
    let w = (2.0 * t.dock_pad_x + n * t.dock_icon + (n - 1.0) * t.dock_gap) * s;
    let h = (2.0 * t.dock_pad_y + t.dock_icon) * s;
    (w.round(), h.round())
}

/// Headroom above the pill for magnified icons and the name tag.
fn headroom(t: &Theme, s: f32) -> f32 {
    ((t.dock_icon * (t.magnify_max - 1.0) + t.magnify_rise + 34.0) * s).round()
}

/// Room each side for the pill to widen: the wave's total growth is about
/// icon * (max-1) * 2.6 * sigma.
fn side_room(t: &Theme, s: f32) -> f32 {
    (t.dock_icon * (t.magnify_max - 1.0) * t.magnify_sigma * 2.6 * s + 8.0 * s).round()
}

impl Dock {
    pub fn create(e: &Rc<Engine>, mon: RECT, t: &Theme, apps: &[DockApp], want_autohide: bool, dark: bool, transparent: bool) -> Result<Dock> {
        let hwnd = win::create_window(CLASS, w!("Udaan dock"), WS_EX_TOPMOST | WS_EX_TOOLWINDOW, mon.left, mon.bottom - 10, 10, 10)?;
        let autohide = win::appbar_register(hwnd, Edge::Bottom, want_autohide);
        if want_autohide && !autohide {
            println!("dock: autohide not granted on monitor ({},{}); docked instead", mon.left, mon.top);
        }
        let mut d = Dock { hwnd, geo: (0, 0, 0, 0), region_full: false, ramping: false, mon, autohide, shown: !autohide, vis: None, width_px: 10, height_px: 10 };
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
        self.geo = (pw as i32, ph as i32, head as i32, side as i32);
        self.place(t);
        // No accent blur anywhere: the glass is our own blurred wallpaper slice.
        win::set_material(self.hwnd, win::Material::None, 0);

        // Where the plate sits on the screen, so the wallpaper slice lines up.
        let bottom_gap = (t.dock_bottom * s) as i32;
        let wx = self.mon.left + (self.mon.right - self.mon.left - self.width_px) / 2;
        let wy = self.mon.bottom - bottom_gap - self.height_px;
        let vs = win::virtual_screen();
        let origin = ((wx - vs.left) as f32, (wy - vs.top) as f32); // window top-left, in the desktop layer's pixels
        let screen = ((vs.right - vs.left) as u32, (vs.bottom - vs.top) as u32);

        self.vis = Some(build(e, self.hwnd, t, apps, dark, transparent, self.shown, s, (pw, ph, head, side), origin, screen)?);
        self.set_region(false);
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
                    let y = mon.bottom - bottom_gap - self.height_px;
                    let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), x, y, self.width_px, self.height_px, SWP_NOACTIVATE);
                } else {
                    let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), mon.left, mon.bottom - TRIGGER_PX, mon.right - mon.left, TRIGGER_PX, SWP_NOACTIVATE);
                }
                return;
            }
            // Reserve the strip, but place from the monitor edge ourselves: the rect the
            // shell hands back is skewed by stale registrations.
            if t.dock_reserve {
                win::appbar_reserve(self.hwnd, Edge::Bottom, mon, self.reserve_px(t));
            }
            let y = mon.bottom - bottom_gap - self.height_px;
            let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), x, y, self.width_px, self.height_px, SWP_NOACTIVATE);
        }
    }

    /// The window is transparent but would still swallow clicks over its empty
    /// headroom. Keep its hit area to the pill, and widen it only while the wave is up.
    fn set_region(&mut self, full: bool) {
        if self.autohide && !self.shown {
            return;
        }
        let (pw, ph, head, side) = self.geo;
        if full {
            win::clear_shape(self.hwnd);
        } else {
            win::set_rect_shape(self.hwnd, side, head, side + pw, head + ph);
        }
        self.region_full = full;
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
            self.set_region(false);
        }
        if let Some(v) = &self.vis {
            let y = if show { 0.0 } else { v.win_h };
            motion::offset_to(&v.e.compositor, &as_visual(&v.content), Vector3 { X: 0.0, Y: y, Z: 0.0 }, t.slide);
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

    pub fn shrink_region(&mut self) {
        unsafe {
            let _ = KillTimer(Some(self.hwnd), TIMER_REGION);
        }
        let idle = self.vis.as_ref().map(|v| v.amp <= 0.001 && v.amp_target <= 0.001).unwrap_or(true);
        if idle && self.region_full {
            self.set_region(false);
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

    fn start_ramp(&mut self) {
        if !self.ramping {
            self.ramping = true;
            unsafe {
                SetTimer(Some(self.hwnd), TIMER_RAMP, RAMP_MS, None);
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
        // The wave lives only while the cursor is in the pill's band (plus the headroom
        // directly above, so a magnified icon stays magnified).
        let in_band = (y as f32) >= v.plate.y - v.icon * 0.75 && (y as f32) <= v.plate.y + v.plate.h;
        v.cursor = Some((x as f32, y as f32));
        v.amp_target = if in_band { 1.0 } else { 0.0 };
        let want = v.amp_target > 0.0;
        v.apply(t);
        if want {
            unsafe {
                let _ = KillTimer(Some(self.hwnd), TIMER_REGION);
            }
            if !self.region_full {
                self.set_region(true);
            }
        }
        self.start_ramp();
    }

    pub fn mouse_leave(&mut self, t: &Theme) {
        if let Some(v) = self.vis.as_mut() {
            v.tracking = false;
            v.pressed = None;
            v.amp_target = 0.0;
            v.apply(t);
        }
        self.start_ramp();
        unsafe {
            SetTimer(Some(self.hwnd), TIMER_REGION, 520, None);
        }
        if self.autohide && self.shown {
            unsafe {
                SetTimer(Some(self.hwnd), TIMER_HIDE, 450, None);
            }
        }
    }

    /// One step of the wave easing in or out. Stops its own timer when settled.
    pub fn tick_ramp(&mut self, t: &Theme) {
        let Some(v) = self.vis.as_mut() else {
            self.stop_ramp();
            return;
        };
        let diff = v.amp_target - v.amp;
        if diff.abs() < 0.008 {
            v.amp = v.amp_target;
            v.apply(t);
            self.stop_ramp();
            return;
        }
        // Exponential approach: fast at first, soft landing; about 130 ms to settle.
        v.amp += diff * 0.34;
        v.apply(t);
    }

    fn stop_ramp(&mut self) {
        self.ramping = false;
        unsafe {
            let _ = KillTimer(Some(self.hwnd), TIMER_RAMP);
        }
    }

    pub fn button_down(&mut self, t: &Theme, x: i32, y: i32) {
        let Some(v) = self.vis.as_mut() else { return };
        if let Some(i) = v.hit(x as f32, y as f32) {
            v.pressed = Some(i);
            v.items[i].springy = true;
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
            let size = self.icon * it.scale;
            let top = self.row_bottom - size - it.rise;
            if Rect::new(it.cur_left, top, size, size).inflate(2.0).contains(x, y) {
                return Some(i);
            }
        }
        None
    }

    /// Lay out every icon, the pill, its shadow and the name tag for the current cursor
    /// and wave strength. All direct sets: no springs, so everything stays in lockstep.
    fn apply(&mut self, t: &Theme) {
        let icon = self.icon;
        let n = self.items.len();
        if n == 0 {
            return;
        }
        let max = t.magnify_max;
        let sigma = t.magnify_sigma.max(0.2);
        let amp = self.amp;

        let mut scales = vec![1.0f32; n];
        let mut growth = vec![0.0f32; n];
        let mut hover: Option<usize> = None;
        let mut anchor = 0.0;

        if let (Some((cx, _)), true) = (self.cursor, amp > 0.001) {
            let xr = cx - self.plate.x;
            for (i, it) in self.items.iter().enumerate() {
                let centre = it.rest_x - self.plate.x + icon / 2.0;
                let d = (xr - centre) / icon;
                let g = (-(d * d) / (2.0 * sigma * sigma)).exp();
                scales[i] = 1.0 + (max - 1.0) * g * amp;
                growth[i] = (scales[i] - 1.0) * icon;
                if xr >= it.rest_x - self.plate.x - self.gap / 2.0 && xr < it.rest_x - self.plate.x + icon + self.gap / 2.0 {
                    hover = Some(i);
                }
            }
            // Anchor the point under the cursor: growth spreads outward from it, so the
            // icon you are pointing at stays under the pointer.
            let h = hover.unwrap_or(if xr < 0.0 { 0 } else { n - 1 });
            let frac = ((xr - (self.items[h].rest_x - self.plate.x)) / icon).clamp(0.0, 1.0);
            anchor = growth[..h].iter().sum::<f32>() + growth[h] * frac;
        }

        let mut pre = 0.0;
        let (mut first_left, mut last_right) = (f32::MAX, f32::MIN);
        for i in 0..n {
            let sc = scales[i];
            let left = self.items[i].rest_x + pre - anchor;
            pre += growth[i];
            let rise = t.magnify_rise * self.s * (sc - 1.0) / (max - 1.0).max(0.01);
            let ox = left + growth[i] / 2.0;
            let oy = self.row_bottom - icon - rise;
            // Tilt toward the cursor, strongest on the icons nearest it, zero at rest.
            let tilt = match self.cursor {
                Some((cx, _)) if amp > 0.001 => {
                    let d = (cx - (left + growth[i] / 2.0 + icon / 2.0)) / icon;
                    (d * t.tilt * 0.55).clamp(-t.tilt, t.tilt) * amp
                }
                _ => 0.0,
            };
            let it = &mut self.items[i];
            it.scale = sc;
            it.cur_left = left;
            it.rise = rise;
            first_left = first_left.min(left);
            last_right = last_right.max(left + icon * sc);
            let v = as_visual(&it.root);
            if it.springy {
                for p in ["Scale", "Offset", "RotationAngleInDegrees"] {
                    let _ = v.StopAnimation(&HSTRING::from(p));
                }
                it.springy = false;
            }
            let _ = it.root.SetScale(Vector3 { X: sc, Y: sc, Z: 1.0 });
            let _ = it.root.SetOffset(Vector3 { X: ox, Y: oy, Z: 0.0 });
            let _ = it.root.SetRotationAngleInDegrees(tilt);
        }

        // The pill grows to hold the magnified row, and its shadow follows.
        let pill_l = (first_left - self.pad_x).min(self.plate.x).max(self.extent.x);
        let pill_r = (last_right + self.pad_x).max(self.plate.x + self.plate.w).min(self.extent.x + self.extent.w);
        let _ = self.shape.SetOffset(Vector2 { X: pill_l - self.extent.x, Y: 0.0 });
        let _ = self.shape.SetSize(Vector2 { X: pill_r - pill_l, Y: self.plate.h });
        let plate_cx = self.plate.x + self.plate.w / 2.0;
        let pill_cx = (pill_l + pill_r) / 2.0;
        let (so, sh_h) = (self.shadow.Offset().unwrap_or_default(), 0.0);
        let _ = sh_h;
        let _ = self.shadow.SetOffset(Vector3 { X: self.plate.x - (self.shadow_w - self.plate.w) / 2.0 + (pill_cx - plate_cx), Y: so.Y, Z: 0.0 });
        let _ = self.shadow.SetScale(Vector3 { X: (pill_r - pill_l) / self.plate.w, Y: 1.0, Z: 1.0 });

        // Name tag above the hovered icon.
        if hover != self.tag_for {
            self.tag_for = hover;
            let bg = as_visual(&self.tag_bg);
            match hover {
                Some(i) => {
                    let name = self.items[i].name.clone();
                    let _ = self.tag.set_text(&self.e.gpu, &name);
                    let tw = self.tag.surface.w as f32;
                    let it = &self.items[i];
                    let cx = it.cur_left + icon * it.scale / 2.0;
                    let grown = icon * (max - 1.0) + t.magnify_rise * self.s;
                    let ty = self.row_bottom - icon - grown - self.tag.surface.h as f32 - 6.0 * self.s;
                    let _ = self.tag_bg.SetOffset(Vector3 { X: cx - tw / 2.0, Y: ty.max(0.0), Z: 0.0 });
                    motion::opacity_to(&self.e.compositor, &bg, 1.0, t.enter);
                }
                None => motion::opacity_to(&self.e.compositor, &bg, 0.0, t.exit),
            }
        } else if let (Some(i), true) = (hover, amp > 0.001) {
            // Keep the tag riding with its icon while the cursor slides across it.
            let tw = self.tag.surface.w as f32;
            let it = &self.items[i];
            let cx = it.cur_left + icon * it.scale / 2.0;
            let off = self.tag_bg.Offset().unwrap_or_default();
            let _ = self.tag_bg.SetOffset(Vector3 { X: cx - tw / 2.0, Y: off.Y, Z: 0.0 });
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn build(
    e: &Rc<Engine>,
    hwnd: HWND,
    t: &Theme,
    apps: &[DockApp],
    dark: bool,
    transparent: bool,
    shown: bool,
    s: f32,
    geo: (f32, f32, f32, f32),
    origin: (f32, f32),
    screen: (u32, u32),
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
    let extent = Rect::new(0.0, head, win_w, ph);
    let radius = t.r_dock * s;

    // Shadow: neutral dark, below the pill, with the pill's own footprint cut out so it
    // never darkens the glass.
    let (sh_surf, pad) = scene::shadow_ex(e, pw, ph, radius, t.el_float, pal.shadow, true)?;
    let shadow = sh_surf.visual.clone();
    shadow.SetOffset(Vector3 { X: plate.x - pad, Y: plate.y - pad + t.el_float.offset_y, Z: 0.0 })?;
    shadow.SetCenterPoint(Vector3 { X: (pw + 2.0 * pad) / 2.0, Y: (ph + 2.0 * pad) / 2.0, Z: 0.0 })?;
    content.Children()?.InsertAtTop(&shadow)?;
    std::mem::forget(sh_surf);

    // Glass: layers cover the whole extent; the rounded clip decides how much shows.
    let glass = scene::container(e, extent)?;
    let shape = c.CreateRoundedRectangleGeometry()?;
    shape.SetOffset(Vector2 { X: side, Y: 0.0 })?;
    shape.SetSize(Vector2 { X: pw, Y: ph })?;
    shape.SetCornerRadius(Vector2 { X: radius, Y: radius })?;
    glass.SetClip(&c.CreateGeometricClipWithGeometry(&shape)?)?;
    content.Children()?.InsertAtTop(&glass)?;

    let blurred = transparent && t.material != "none";
    let mut got_backdrop = false;
    if blurred {
        // The wallpaper slice behind the dock, blurred once, plus the same vignette the
        // desktop layer draws over the wallpaper so the glass matches its surroundings.
        let region = (origin.0 + extent.x, origin.1 + extent.y, extent.w, extent.h);
        match e.gpu.glass_backdrop(c, &t.resolved_wallpaper(), screen, region, t.glass_blur * s) {
            Ok(surf) => {
                glass.Children()?.InsertAtTop(&surf.visual)?;
                std::mem::forget(surf);
                if let Some(brush) = crate::desktop::vignette_brush(e, t)? {
                    let v = scene::sprite(e, &brush, Rect::new(-region.0, -region.1, screen.0 as f32, screen.1 as f32))?;
                    glass.Children()?.InsertAtTop(&v)?;
                }
                got_backdrop = true;
            }
            Err(err) => println!("dock: glass backdrop failed ({err}); using an opaque pill"),
        }
    }
    let tint = if got_backdrop { pal.glass_tint } else { pal.glass_opaque };
    glass.Children()?.InsertAtTop(&scene::fill(e, tint, Rect::new(0.0, 0.0, extent.w, extent.h))?)?;

    // Light from above: a soft highlight along the top edge, fading downward.
    let grad = c.CreateLinearGradientBrush()?;
    grad.SetStartPoint(Vector2 { X: 0.0, Y: 0.0 })?;
    grad.SetEndPoint(Vector2 { X: 0.0, Y: 1.0 })?;
    let mut clear = pal.glass_edge;
    clear.A = 0;
    grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(0.0, pal.glass_edge)?)?;
    grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(1.0, clear)?)?;
    glass.Children()?.InsertAtTop(&scene::sprite(e, &grad.cast()?, Rect::new(0.0, 0.0, extent.w, (ph * 0.5).min(26.0 * s)))?)?;

    // The icon row lives ABOVE the glass, outside its clip, so magnified icons rise out
    // of the pill instead of being cut off by it. A perspective transform makes the
    // per-icon tilt read as depth.
    let row = scene::container(e, Rect::new(0.0, 0.0, win_w, win_h))?;
    {
        let mut m = windows_numerics::Matrix4x4::translation(0.0, 0.0, 0.0);
        m.M34 = -1.0 / (1100.0 * s);
        row.SetTransformMatrix(m)?;
        row.SetCenterPoint(Vector3 { X: win_w / 2.0, Y: head + ph / 2.0, Z: 0.0 })?;
    }
    content.Children()?.InsertAtTop(&row)?;

    let icon = (t.dock_icon * s).round();
    let gap = (t.dock_gap * s).round();
    let pad_x = (t.dock_pad_x * s).round();
    let pad_y = (t.dock_pad_y * s).round();
    let row_bottom = plate.y + ph - pad_y;
    let dot_d = (t.indicator * s).round().max(2.0);

    let mut items = Vec::with_capacity(apps.len());
    for (i, app) in apps.iter().enumerate() {
        let rest_x = plate.x + pad_x + i as f32 * (icon + gap);
        let item = scene::container(e, Rect::new(rest_x, row_bottom - icon, icon, icon))?;
        // Scale about the bottom centre, so icons grow upward out of the dock.
        item.SetCenterPoint(Vector3 { X: icon / 2.0, Y: icon, Z: 0.0 })?;
        item.SetRotationAxis(Vector3 { X: 0.0, Y: 1.0, Z: 0.0 })?;

        // The real icon at full tile size, directly on the glass: no plate behind it.
        let surf = e.gpu.surface(c, icon as u32, icon as u32)?;
        let px_data = match Gpu::icon_pixels(&app.path.to_string_lossy(), icon as u32) {
            Ok(p) => Some(p),
            Err(err) => {
                println!("dock: no icon for {} ({err}); monogram", app.name);
                None
            }
        };
        let accent = col(pal.accent);
        let accent_text = col(pal.accent_text);
        let initial: String = app.name.chars().next().map(|ch| ch.to_uppercase().to_string()).unwrap_or_else(|| "?".into());
        let family = t.family.clone();
        let r_icon = t.r_icon * s;
        let engine = e.clone();
        surf.draw(move |ctx, cw, ch| unsafe {
            match &px_data {
                Some((buf, bw, bh)) => {
                    let bmp = bitmap_from_pixels(ctx, buf, *bw, *bh)?;
                    ctx.DrawBitmap(&bmp, Some(&D2D_RECT_F { left: 0.0, top: 0.0, right: cw, bottom: ch }), 1.0, D2D1_INTERPOLATION_MODE_LINEAR, None, None);
                }
                None => {
                    // A monogram tile, never a hand-drawn brand mark.
                    let rr = D2D1_ROUNDED_RECT { rect: D2D_RECT_F { left: 0.0, top: 0.0, right: cw, bottom: ch }, radiusX: r_icon, radiusY: r_icon };
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

        // Running dot in the logo blue: the one place the accent appears here.
        let dot = scene::circle(e, pal.indicator, icon / 2.0, icon + pad_y / 2.0 + 1.0 * s, dot_d)?;
        dot.SetOpacity(0.0)?;
        item.Children()?.InsertAtTop(&dot)?;

        row.Children()?.InsertAtTop(&item)?;
        items.push(Item {
            root: item,
            _icon: surf,
            dot,
            rest_x,
            cur_left: rest_x,
            scale: 1.0,
            rise: 0.0,
            springy: false,
            path: app.path.clone(),
            name: app.name.clone(),
            running: Vec::new(),
        });
    }

    // Name tag: a small charcoal pill above the hovered icon.
    let tag_style = TextStyle { family: t.family.clone(), size: t.label * s, weight: 600, align: Align::Center, color: col(pal.text) };
    let (tag_w, tag_h) = ((130.0 * s).round(), (24.0 * s).round());
    let tag_bg = scene::rounded(e, Rect::new(0.0, 0.0, tag_w, tag_h), 7.0 * s)?;
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
        shape,
        shadow,
        shadow_w: pw + 2.0 * pad,
        items,
        tag,
        tag_bg,
        tag_for: None,
        tracking: false,
        pressed: None,
        amp: 0.0,
        amp_target: 0.0,
        cursor: None,
        s,
        icon,
        gap,
        pad_x,
        plate,
        extent,
        row_bottom,
        win_h,
    })
}
