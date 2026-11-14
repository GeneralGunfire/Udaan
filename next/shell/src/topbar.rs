//! The top menu bar: a full-width AppBar at the top of each monitor.
//!
//! Measured from the reference: there is NO slab and NO separator line. The bar is
//! text sitting on the wallpaper, with the strip very slightly darkened so white text
//! stays legible over a bright sky. Left: the Udaan mark, the front app's name in
//! bold, then menus. Right: status glyphs and the clock.

use crate::engine::Engine;
use crate::gfx::{col, Align, Label, TextStyle};
use crate::motion;
use crate::scene::{self, as_visual, Rect};
use crate::theme::Theme;
use crate::win::{self, Edge};
use std::rc::Rc;
use windows::{
    core::{w, Interface, Result},
    UI::Composition::{ContainerVisual, Desktop::DesktopWindowTarget, SpriteVisual},
    Win32::{
        Foundation::{HWND, RECT},
        System::WinRT::Composition::ICompositorDesktopInterop,
        UI::{
            Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT},
            WindowsAndMessaging::*,
        },
    },
};
use windows_numerics::{Vector2, Vector3};

pub const CLASS: windows::core::PCWSTR = w!("UdaanNextTopBar");
const MENUS: [&str; 5] = ["File", "Edit", "View", "Window", "Help"];

struct MenuItem {
    _label: Label,
    highlight: SpriteVisual,
    x: f32,
    w: f32,
}

struct Vis {
    e: Rc<Engine>,
    _target: DesktopWindowTarget,
    content: ContainerVisual,
    app: Label,
    menus: Vec<MenuItem>,
    clock: Label,
    status: Vec<Label>,
    hot: Option<usize>,
    tracking: bool,
    h: f32,
    s: f32,
}

pub struct TopBar {
    pub hwnd: HWND,
    pub mon: RECT,
    vis: Option<Vis>,
    height_px: i32,
}

impl TopBar {
    pub fn create(e: &Rc<Engine>, mon: RECT, t: &Theme, dark: bool, app_name: &str) -> Result<TopBar> {
        let hwnd = win::create_window(CLASS, w!("Udaan menu bar"), WS_EX_TOPMOST | WS_EX_TOOLWINDOW, mon.left, mon.top, mon.right - mon.left, 26)?;
        win::appbar_register(hwnd, Edge::Top, false);
        let mut b = TopBar { hwnd, mon, vis: None, height_px: 26 };
        b.rebuild(e, t, dark, app_name)?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNA);
        }
        Ok(b)
    }

    pub fn rebuild(&mut self, e: &Rc<Engine>, t: &Theme, dark: bool, app_name: &str) -> Result<()> {
        self.vis = None;
        let s = win::scale(self.hwnd);
        self.height_px = (t.topbar_height * s).round() as i32;
        self.place();
        // No blur: the bar is text on a faint darkening, so the wallpaper reads through
        // sharply, exactly like the reference.
        win::set_material(self.hwnd, win::Material::None, 0);
        self.vis = Some(build(e, self.hwnd, t, dark, s, app_name)?);
        Ok(())
    }

    pub fn place(&self) {
        // Reserve the strip, but place the window from the monitor edge ourselves. The
        // rect SETPOS hands back is shifted by stale registrations (e.g. a previous
        // instance that was killed), which collapsed the bar to zero height at y=26.
        win::appbar_reserve(self.hwnd, Edge::Top, self.mon, self.height_px);
        unsafe {
            let _ = SetWindowPos(self.hwnd, Some(HWND_TOPMOST), self.mon.left, self.mon.top, self.mon.right - self.mon.left, self.height_px, SWP_NOACTIVATE);
        }
    }

    pub fn re_register(&self) {
        win::appbar_register(self.hwnd, Edge::Top, false);
    }

    pub fn unregister(&self) {
        win::appbar_unregister(self.hwnd, Edge::Top, false);
    }

    pub fn destroy(mut self) {
        self.unregister();
        self.vis = None;
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
    }

    pub fn set_clock(&mut self, text: &str) {
        if let Some(v) = self.vis.as_mut() {
            let gpu = &v.e.gpu;
            let _ = v.clock.set_text(gpu, text);
        }
    }

    pub fn set_app(&mut self, t: &Theme, name: &str) {
        let Some(v) = self.vis.as_mut() else { return };
        if v.app.text == name {
            return;
        }
        let s = v.s;
        let style = v.app.style.clone();
        let name_w = v.e.gpu.measure(name, &style).ceil();
        // A new surface sized to the name: a surface brush would otherwise stretch.
        let old = v.app.visual().clone();
        let Ok(mut l) = v.e.gpu.label(&v.e.compositor, (name_w + 4.0) as u32, v.h as u32, style) else { return };
        if l.set_text(&v.e.gpu, name).is_err() {
            return;
        }
        let off = old.Offset().unwrap_or_default();
        let _ = l.visual().SetOffset(off);
        if let Ok(ch) = v.content.Children() {
            let _ = ch.InsertAtTop(l.visual());
            let _ = ch.Remove(&old);
        }
        v.app = l;

        // Menus follow the name's width.
        let mut x = off.X + name_w + t.topbar_item_gap * s;
        for m in v.menus.iter_mut() {
            m.x = x;
            let _ = m._label.visual().SetOffset(Vector3 { X: x, Y: 0.0, Z: 0.0 });
            let _ = m.highlight.SetOffset(Vector3 { X: x - 7.0 * s, Y: 3.0 * s, Z: 0.0 });
            x += m.w + t.topbar_item_gap * s;
        }
        let av = as_visual(v.app.visual());
        let _ = av.SetOpacity(0.0);
        motion::opacity_to(&v.e.compositor, &av, 1.0, t.enter);
    }

    pub fn mouse_move(&mut self, t: &Theme, x: i32, y: i32) {
        let Some(v) = self.vis.as_mut() else { return };
        if !v.tracking {
            v.tracking = true;
            let mut tm = TRACKMOUSEEVENT { cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: self.hwnd, dwHoverTime: 0 };
            unsafe {
                let _ = TrackMouseEvent(&mut tm);
            }
        }
        let s = v.s;
        let hit = v.menus.iter().position(|m| Rect::new(m.x - 7.0 * s, 0.0, m.w + 14.0 * s, v.h).contains(x as f32, y as f32));
        if hit != v.hot {
            if let Some(i) = v.hot {
                motion::opacity_to(&v.e.compositor, &as_visual(&v.menus[i].highlight), 0.0, t.exit);
            }
            if let Some(i) = hit {
                motion::opacity_to(&v.e.compositor, &as_visual(&v.menus[i].highlight), 1.0, t.hover);
            }
            v.hot = hit;
        }
    }

    pub fn mouse_leave(&mut self, t: &Theme) {
        let Some(v) = self.vis.as_mut() else { return };
        v.tracking = false;
        if let Some(i) = v.hot.take() {
            motion::opacity_to(&v.e.compositor, &as_visual(&v.menus[i].highlight), 0.0, t.exit);
        }
    }
}

fn build(e: &Rc<Engine>, hwnd: HWND, t: &Theme, dark: bool, s: f32, app_name: &str) -> Result<Vis> {
    let pal = t.palette(dark);
    let mut rc = RECT::default();
    unsafe {
        GetClientRect(hwnd, &mut rc)?;
    }
    let w = (rc.right - rc.left) as f32;
    let h = (t.topbar_height * s).round();
    let c = &e.compositor;
    let interop: ICompositorDesktopInterop = c.cast()?;
    let target = unsafe { interop.CreateDesktopWindowTarget(hwnd, true)? };
    let root = c.CreateContainerVisual()?;
    root.SetSize(Vector2 { X: w, Y: h })?;
    target.SetRoot(&root)?;

    let content = scene::container(e, Rect::new(0.0, 0.0, w, h))?;
    root.Children()?.InsertAtTop(&content)?;

    // The only background: a soft top-down darkening so white text stays readable on a
    // bright wallpaper. No slab, no border, no separator.
    if t.topbar_darken > 0.0 {
        let grad = c.CreateLinearGradientBrush()?;
        grad.SetStartPoint(Vector2 { X: 0.0, Y: 0.0 })?;
        grad.SetEndPoint(Vector2 { X: 0.0, Y: 1.0 })?;
        let a = (t.topbar_darken * 255.0).clamp(0.0, 255.0) as u8;
        grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(0.0, crate::theme::rgba(0, 0, 0, a))?)?;
        grad.ColorStops()?.Append(&c.CreateColorGradientStopWithOffsetAndColor(1.0, crate::theme::rgba(0, 0, 0, (a as f32 * 0.25) as u8))?)?;
        content.Children()?.InsertAtTop(&scene::sprite(e, &grad.cast()?, Rect::new(0.0, 0.0, w, h))?)?;
    }

    let pad = t.topbar_pad_x * s;

    // Udaan mark: a small accent square with the monogram, standing in for the Apple
    // logo's position. A monogram, never a fake brand mark.
    let mark = (14.0 * s).round();
    let tile = scene::rounded(e, Rect::new(pad, ((h - mark) / 2.0).round(), mark, mark), 3.0 * s)?;
    tile.Children()?.InsertAtTop(&scene::fill(e, pal.accent, Rect::new(0.0, 0.0, mark, mark))?)?;
    let mut mono = e.gpu.label(c, mark as u32, mark as u32, TextStyle { family: t.family.clone(), size: 9.0 * s, weight: 700, align: Align::Center, color: col(pal.accent_text) })?;
    mono.set_text(&e.gpu, "U")?;
    tile.Children()?.InsertAtTop(mono.visual())?;
    content.Children()?.InsertAtTop(&tile)?;

    let body = TextStyle { family: t.family.clone(), size: t.body * s, weight: 400, align: Align::Left, color: col(pal.text) };
    let strong = TextStyle { weight: 700, ..body.clone() };

    let app_x = pad + mark + 10.0 * s;
    let name_w = e.gpu.measure(app_name, &strong).ceil();
    let mut app = e.gpu.label(c, (name_w + 4.0) as u32, h as u32, strong)?;
    app.set_text(&e.gpu, app_name)?;
    app.visual().SetOffset(Vector3 { X: app_x, Y: 0.0, Z: 0.0 })?;
    content.Children()?.InsertAtTop(app.visual())?;

    let mut x = app_x + name_w + t.topbar_item_gap * s;
    let mut menus = Vec::new();
    for m in MENUS {
        let mw = e.gpu.measure(m, &body).ceil();
        // Hover highlight: a soft rounded wash, hidden until hovered.
        let hl = scene::fill(e, pal.icon_plate_hover(), Rect::new(x - 7.0 * s, 3.0 * s, mw + 14.0 * s, h - 6.0 * s))?;
        let geo = c.CreateRoundedRectangleGeometry()?;
        geo.SetSize(Vector2 { X: mw + 14.0 * s, Y: h - 6.0 * s })?;
        geo.SetCornerRadius(Vector2 { X: 4.0 * s, Y: 4.0 * s })?;
        hl.SetClip(&c.CreateGeometricClipWithGeometry(&geo)?)?;
        hl.SetOpacity(0.0)?;
        content.Children()?.InsertAtTop(&hl)?;

        let mut label = e.gpu.label(c, (mw + 2.0) as u32, h as u32, body.clone())?;
        label.set_text(&e.gpu, m)?;
        label.visual().SetOffset(Vector3 { X: x, Y: 0.0, Z: 0.0 })?;
        content.Children()?.InsertAtTop(label.visual())?;
        menus.push(MenuItem { _label: label, highlight: hl, x, w: mw });
        x += mw + t.topbar_item_gap * s;
    }

    // Right side: clock at the edge, status glyphs to its left.
    let clock_style = TextStyle { family: t.family.clone(), size: t.clock_bar * s, weight: 600, align: Align::Right, color: col(pal.text) };
    let cw = (190.0 * s) as u32;
    let clock = e.gpu.label(c, cw, h as u32, clock_style)?;
    clock.visual().SetOffset(Vector3 { X: w - cw as f32 - pad, Y: 0.0, Z: 0.0 })?;
    content.Children()?.InsertAtTop(clock.visual())?;

    let glyph_style = TextStyle { family: t.icons.clone(), size: 12.0 * s, weight: 400, align: Align::Center, color: col(pal.text) };
    // Segoe MDL2: battery, wifi, search, control centre.
    let glyphs = ["\u{EBA6}", "\u{E701}", "\u{E721}", "\u{E700}"];
    let mut gx = w - cw as f32 - pad - 6.0 * s;
    let mut status = Vec::new();
    for g in glyphs.iter().rev() {
        let gw = (24.0 * s) as u32;
        gx -= gw as f32;
        let mut l = e.gpu.label(c, gw, h as u32, glyph_style.clone())?;
        l.set_text(&e.gpu, g)?;
        l.visual().SetOffset(Vector3 { X: gx, Y: 0.0, Z: 0.0 })?;
        content.Children()?.InsertAtTop(l.visual())?;
        status.push(l);
    }

    // Entrance: fade in from slightly above.
    let cv = as_visual(&content);
    cv.SetOpacity(0.0)?;
    cv.SetOffset(Vector3 { X: 0.0, Y: -h * 0.6, Z: 0.0 })?;
    motion::opacity_to(c, &cv, 1.0, t.enter);
    motion::offset_to(c, &cv, Vector3 { X: 0.0, Y: 0.0, Z: 0.0 }, t.enter);

    Ok(Vis { e: e.clone(), _target: target, content, app, menus, clock, status, hot: None, tracking: false, h, s })
}
