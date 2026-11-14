//! Scene primitives: the small vocabulary every shell surface is built from.
//!
//! Rounded rectangles, glass panels, soft shadows, image tiles and hit-test rects.
//! Glass here uses the material the spike proved on this machine (see the
//! `win10-glass-material` note): accent blur-behind on the WINDOW, plus a composition
//! rounded clip on the CONTENT. `CreateHostBackdropBrush` is never used: on Windows 10
//! it paints black.

use crate::engine::Engine;
use crate::gfx::{col, Surface};
use crate::theme::{Palette, Shadow};
use windows::{
    core::{Interface, Result},
    UI::{
        Color,
        Composition::{CompositionBrush, ContainerVisual, SpriteVisual, Visual},
    },
    Win32::{
        Foundation::RECT,
        Graphics::Direct2D::{
            Common::{D2D1_BORDER_MODE_SOFT, D2D1_COLOR_F, D2D1_COMPOSITE_MODE_SOURCE_OVER, D2D_RECT_F, D2D_SIZE_F},
            CLSID_D2D1GaussianBlur, D2D1_COMPATIBLE_RENDER_TARGET_OPTIONS_NONE, D2D1_GAUSSIANBLUR_OPTIMIZATION_SPEED,
            D2D1_GAUSSIANBLUR_PROP_BORDER_MODE, D2D1_GAUSSIANBLUR_PROP_OPTIMIZATION,
            D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION, D2D1_INTERPOLATION_MODE_LINEAR, D2D1_PROPERTY_TYPE_ENUM,
            D2D1_PRIMITIVE_BLEND_COPY, D2D1_PRIMITIVE_BLEND_SOURCE_OVER, D2D1_PROPERTY_TYPE_FLOAT, D2D1_ROUNDED_RECT,
        },
    },
};
use windows_numerics::{Vector2, Vector3};

/// A rectangle in a window's device-pixel space, used for hit testing.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }
    pub fn contains(&self, px: f32, py: f32) -> bool {
        px >= self.x && px < self.x + self.w && py >= self.y && py < self.y + self.h
    }
    /// Grow on every side (a forgiving hit target).
    pub fn inflate(&self, by: f32) -> Rect {
        Rect::new(self.x - by, self.y - by, self.w + by * 2.0, self.h + by * 2.0)
    }
    pub fn centre_x(&self) -> f32 {
        self.x + self.w / 2.0
    }
    pub fn from_win(r: RECT) -> Rect {
        Rect::new(r.left as f32, r.top as f32, (r.right - r.left) as f32, (r.bottom - r.top) as f32)
    }
}

pub fn color_brush(e: &Engine, c: Color) -> Result<CompositionBrush> {
    Ok(e.compositor.CreateColorBrushWithColor(c)?.cast()?)
}

pub fn sprite(e: &Engine, brush: &CompositionBrush, r: Rect) -> Result<SpriteVisual> {
    let s = e.compositor.CreateSpriteVisual()?;
    s.SetBrush(brush)?;
    s.SetSize(Vector2 { X: r.w, Y: r.h })?;
    s.SetOffset(Vector3 { X: r.x, Y: r.y, Z: 0.0 })?;
    Ok(s)
}

pub fn fill(e: &Engine, c: Color, r: Rect) -> Result<SpriteVisual> {
    sprite(e, &color_brush(e, c)?, r)
}

pub fn container(e: &Engine, r: Rect) -> Result<ContainerVisual> {
    let v = e.compositor.CreateContainerVisual()?;
    v.SetSize(Vector2 { X: r.w, Y: r.h })?;
    v.SetOffset(Vector3 { X: r.x, Y: r.y, Z: 0.0 })?;
    Ok(v)
}

/// A container whose children are clipped to a rounded rectangle. This is what makes
/// the window's accent blur appear rounded.
pub fn rounded(e: &Engine, r: Rect, radius: f32) -> Result<ContainerVisual> {
    let v = container(e, r)?;
    let geo = e.compositor.CreateRoundedRectangleGeometry()?;
    geo.SetSize(Vector2 { X: r.w, Y: r.h })?;
    geo.SetCornerRadius(Vector2 { X: radius, Y: radius })?;
    v.SetClip(&e.compositor.CreateGeometricClipWithGeometry(&geo)?)?;
    Ok(v)
}

/// A circular clip (running dots, avatars).
pub fn circle(e: &Engine, c: Color, cx: f32, cy: f32, d: f32) -> Result<SpriteVisual> {
    let s = fill(e, c, Rect::new(cx - d / 2.0, cy - d / 2.0, d, d))?;
    let geo = e.compositor.CreateEllipseGeometry()?;
    geo.SetRadius(Vector2 { X: d / 2.0, Y: d / 2.0 })?;
    geo.SetCenter(Vector2 { X: d / 2.0, Y: d / 2.0 })?;
    s.SetClip(&e.compositor.CreateGeometricClipWithGeometry(&geo)?)?;
    s.SetCenterPoint(Vector3 { X: d / 2.0, Y: d / 2.0, Z: 0.0 })?;
    Ok(s)
}

/// A blurred rounded-rect shadow, drawn once into a surface. Returns the surface and
/// the padding around the shape, so the caller offsets it by `-pad`.
pub fn shadow(e: &Engine, w: f32, h: f32, radius: f32, sh: Shadow, color: Color) -> Result<(Surface, f32)> {
    shadow_ex(e, w, h, radius, sh, color, false)
}

/// `cutout` erases the shape's own footprint, leaving only the soft halo around it.
/// Needed when the shadow lives in a window ABOVE the glass it belongs to.
pub fn shadow_ex(e: &Engine, w: f32, h: f32, radius: f32, sh: Shadow, color: Color, cutout: bool) -> Result<(Surface, f32)> {
    let pad = (sh.blur * 2.0).ceil();
    let s = e.gpu.surface(&e.compositor, (w + pad * 2.0) as u32, (h + pad * 2.0) as u32)?;
    let [r, g, b, _] = col(color);
    s.draw(|ctx, _, _| unsafe {
        let size = D2D_SIZE_F { width: w + pad * 2.0, height: h + pad * 2.0 };
        let target = ctx.CreateCompatibleRenderTarget(Some(&size), None, None, D2D1_COMPATIBLE_RENDER_TARGET_OPTIONS_NONE)?;
        target.BeginDraw();
        target.Clear(Some(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }));
        let brush = target.CreateSolidColorBrush(&D2D1_COLOR_F { r, g, b, a: sh.opacity }, None)?;
        target.FillRoundedRectangle(
            &D2D1_ROUNDED_RECT {
                rect: D2D_RECT_F { left: pad, top: pad, right: pad + w, bottom: pad + h },
                radiusX: radius,
                radiusY: radius,
            },
            &brush,
        );
        target.EndDraw(None, None)?;
        let bmp = target.GetBitmap()?;
        let fx = ctx.CreateEffect(&CLSID_D2D1GaussianBlur)?;
        fx.SetInput(0, &bmp, true);
        let sd = (sh.blur / 2.0).max(0.5);
        fx.SetValue(D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION.0 as u32, D2D1_PROPERTY_TYPE_FLOAT, &sd.to_le_bytes())?;
        fx.SetValue(D2D1_GAUSSIANBLUR_PROP_OPTIMIZATION.0 as u32, D2D1_PROPERTY_TYPE_ENUM, &(D2D1_GAUSSIANBLUR_OPTIMIZATION_SPEED.0 as u32).to_le_bytes())?;
        fx.SetValue(D2D1_GAUSSIANBLUR_PROP_BORDER_MODE.0 as u32, D2D1_PROPERTY_TYPE_ENUM, &(D2D1_BORDER_MODE_SOFT.0 as u32).to_le_bytes())?;
        let out = fx.GetOutput()?;
        ctx.DrawImage(&out, Some(&Vector2 { X: 0.0, Y: 0.0 }), None, D2D1_INTERPOLATION_MODE_LINEAR, D2D1_COMPOSITE_MODE_SOURCE_OVER);
        if cutout {
            // The shadow is offset downward, so erase the shape at its OFFSET position
            // (the halo above the shape is what we keep thin).
            ctx.SetPrimitiveBlend(D2D1_PRIMITIVE_BLEND_COPY);
            let clear = ctx.CreateSolidColorBrush(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }, None)?;
            let dy = sh.offset_y;
            ctx.FillRoundedRectangle(
                &D2D1_ROUNDED_RECT {
                    rect: D2D_RECT_F { left: pad, top: pad - dy, right: pad + w, bottom: pad - dy + h },
                    radiusX: radius,
                    radiusY: radius,
                },
                &clear,
            );
            ctx.SetPrimitiveBlend(D2D1_PRIMITIVE_BLEND_SOURCE_OVER);
        }
        Ok(())
    })?;
    Ok((s, pad))
}

/// A 1 px antialiased rounded border.
pub fn border(e: &Engine, w: f32, h: f32, radius: f32, px: f32, color: Color) -> Result<Surface> {
    let s = e.gpu.surface(&e.compositor, w as u32, h as u32)?;
    let c = col(color);
    s.draw(move |ctx, _, _| unsafe {
        let brush = ctx.CreateSolidColorBrush(&crate::gfx::d2d_color(c), None)?;
        let half = px / 2.0;
        ctx.DrawRoundedRectangle(
            &D2D1_ROUNDED_RECT {
                rect: D2D_RECT_F { left: half, top: half, right: w - half, bottom: h - half },
                radiusX: (radius - half).max(0.0),
                radiusY: (radius - half).max(0.0),
            },
            &brush,
            px,
            None,
        );
        Ok(())
    })?;
    Ok(s)
}

/// How a glass surface gets its blur.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Backdrop {
    /// The window carries accent blur-behind; we only tint and round it.
    WindowBlur,
    /// No blur available (transparency off, or a solid surface): paint opaque.
    Opaque,
}

pub struct GlassSpec<'a> {
    pub rect: Rect,
    pub radius: f32,
    pub pal: &'a Palette,
    pub backdrop: Backdrop,
    pub shadow: Option<Shadow>,
    pub border_px: f32,
    pub highlight: bool,
}

pub struct Panel {
    /// Place this. Holds shadow (drawn outside the shape) and the rounded glass.
    pub root: ContainerVisual,
    /// Put content here; it is clipped to the rounded shape.
    pub content: ContainerVisual,
}

/// A glass panel. With `Backdrop::WindowBlur` the caller must have enabled accent blur
/// on the host window, and the window rectangle must be exactly this panel's bounds
/// (the blur fills the whole window; the rounded clip is what shapes it).
pub fn glass(e: &Engine, spec: GlassSpec) -> Result<Panel> {
    let GlassSpec { rect, radius, pal, backdrop, shadow: sh, border_px, highlight } = spec;
    let (w, h) = (rect.w, rect.h);
    let root = container(e, rect)?;

    if let Some(s) = sh {
        let (surf, pad) = shadow(e, w, h, radius, s, pal.shadow)?;
        surf.visual.SetOffset(Vector3 { X: -pad, Y: -pad + s.offset_y, Z: 0.0 })?;
        root.Children()?.InsertAtTop(&surf.visual)?;
    }

    let clip = rounded(e, Rect::new(0.0, 0.0, w, h), radius)?;
    root.Children()?.InsertAtTop(&clip)?;

    // The tint. Over a real blur this is a thin film; opaque fallback is a solid fill.
    let tint = match backdrop {
        Backdrop::WindowBlur => pal.glass_tint,
        Backdrop::Opaque => pal.glass_opaque,
    };
    clip.Children()?.InsertAtTop(&fill(e, tint, Rect::new(0.0, 0.0, w, h))?)?;

    // A soft top-edge highlight: light catching the lip of the glass.
    if highlight {
        let grad = e.compositor.CreateLinearGradientBrush()?;
        grad.SetStartPoint(Vector2 { X: 0.0, Y: 0.0 })?;
        grad.SetEndPoint(Vector2 { X: 0.0, Y: 1.0 })?;
        let mut clear = pal.glass_edge;
        clear.A = 0;
        grad.ColorStops()?.Append(&e.compositor.CreateColorGradientStopWithOffsetAndColor(0.0, pal.glass_edge)?)?;
        grad.ColorStops()?.Append(&e.compositor.CreateColorGradientStopWithOffsetAndColor(1.0, clear)?)?;
        let hl = sprite(e, &grad.cast()?, Rect::new(0.0, 0.0, w, (h * 0.5).min(24.0)))?;
        clip.Children()?.InsertAtTop(&hl)?;
    }

    let content = container(e, Rect::new(0.0, 0.0, w, h))?;
    clip.Children()?.InsertAtTop(&content)?;

    if border_px > 0.0 {
        let b = border(e, w, h, radius, border_px, pal.glass_border)?;
        root.Children()?.InsertAtTop(&b.visual)?;
    }

    Ok(Panel { root, content })
}

pub fn as_visual<T: Interface>(v: &T) -> Visual {
    v.cast().expect("composition object is a Visual")
}
