//! Text for the composition tree.
//!
//! DirectWrite shapes it, Direct2D draws it into a composition drawing surface (a GPU
//! texture owned by the compositor), and the compositor then moves, scales and blends
//! that texture with no further work from us. A label is redrawn only when its text
//! changes, so an idle label costs nothing.

use windows::{
    core::{w, Interface, Result},
    Foundation::Size,
    Graphics::DirectX::{DirectXAlphaMode, DirectXPixelFormat},
    UI::Composition::{CompositionDrawingSurface, CompositionGraphicsDevice, Compositor, SpriteVisual},
    Win32::{
        Foundation::{HMODULE, POINT},
        Graphics::{
            Direct2D::{
                Common::{D2D1_COLOR_F, D2D_RECT_F},
                D2D1CreateDevice, ID2D1Device, ID2D1DeviceContext, D2D1_DRAW_TEXT_OPTIONS_NONE,
            },
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION},
            DirectWrite::{
                DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL,
                DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD,
                DWRITE_MEASURING_MODE_NATURAL, DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_TEXT_ALIGNMENT_CENTER,
                DWRITE_TEXT_ALIGNMENT_LEADING, DWRITE_TEXT_ALIGNMENT_TRAILING, DWRITE_WORD_WRAPPING_NO_WRAP,
            },
            Dxgi::IDXGIDevice,
        },
        System::WinRT::Composition::{ICompositionDrawingSurfaceInterop, ICompositorInterop},
    },
};
use windows_numerics::{Matrix3x2, Vector2};

#[derive(Clone, Copy)]
pub enum Align {
    Left,
    Center,
    Right,
}

/// Everything that has to stay alive for as long as any label is shown.
pub struct TextGpu {
    _d3d: ID3D11Device,
    _d2d: ID2D1Device,
    gfx: CompositionGraphicsDevice,
    dw: IDWriteFactory,
}

impl TextGpu {
    pub fn new(compositor: &Compositor) -> Result<Self> {
        unsafe {
            let mut dev: Option<ID3D11Device> = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut dev),
                None,
                None,
            )?;
            let d3d = dev.expect("D3D11CreateDevice returned no device");
            let dxgi: IDXGIDevice = d3d.cast()?;
            let d2d: ID2D1Device = D2D1CreateDevice(&dxgi, None)?;
            let interop: ICompositorInterop = compositor.cast()?;
            let gfx = interop.CreateGraphicsDevice(&d2d)?;
            let dw: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
            Ok(Self { _d3d: d3d, _d2d: d2d, gfx, dw })
        }
    }

    /// A text label whose pixel size is `w` x `h` (device pixels) and whose font size
    /// is `size` (device pixels).
    pub fn label(&self, compositor: &Compositor, w: u32, h: u32, size: f32, bold: bool, align: Align, color: [f32; 4]) -> Result<Label> {
        let surface = self.gfx.CreateDrawingSurface(
            Size { Width: w as f32, Height: h as f32 },
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            DirectXAlphaMode::Premultiplied,
        )?;
        let visual = compositor.CreateSpriteVisual()?;
        visual.SetBrush(&compositor.CreateSurfaceBrushWithSurface(&surface)?)?;
        visual.SetSize(Vector2 { X: w as f32, Y: h as f32 })?;
        Ok(Label { visual, surface, w, h, size, bold, align, color })
    }
}

pub struct Label {
    pub visual: SpriteVisual,
    surface: CompositionDrawingSurface,
    w: u32,
    h: u32,
    size: f32,
    bold: bool,
    align: Align,
    color: [f32; 4],
}

impl Label {
    pub fn set_text(&self, gpu: &TextGpu, text: &str) -> Result<()> {
        unsafe {
            let interop: ICompositionDrawingSurfaceInterop = self.surface.cast()?;
            let mut offset = POINT::default();
            let ctx: ID2D1DeviceContext = interop.BeginDraw(None, &mut offset)?;
            ctx.SetTransform(&Matrix3x2::translation(offset.x as f32, offset.y as f32));
            ctx.Clear(Some(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }));
            let [r, g, b, a] = self.color;
            let brush = ctx.CreateSolidColorBrush(&D2D1_COLOR_F { r, g, b, a }, None)?;
            let fmt = gpu.dw.CreateTextFormat(
                w!("Segoe UI Variable Text"),
                None,
                if self.bold { DWRITE_FONT_WEIGHT_SEMI_BOLD } else { DWRITE_FONT_WEIGHT_NORMAL },
                DWRITE_FONT_STYLE_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                self.size,
                w!("en-us"),
            )?;
            fmt.SetTextAlignment(match self.align {
                Align::Left => DWRITE_TEXT_ALIGNMENT_LEADING,
                Align::Center => DWRITE_TEXT_ALIGNMENT_CENTER,
                Align::Right => DWRITE_TEXT_ALIGNMENT_TRAILING,
            })?;
            fmt.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER)?;
            fmt.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP)?;
            let wide: Vec<u16> = text.encode_utf16().collect();
            ctx.DrawText(
                &wide,
                &fmt,
                &D2D_RECT_F { left: 0.0, top: 0.0, right: self.w as f32, bottom: self.h as f32 },
                &brush,
                D2D1_DRAW_TEXT_OPTIONS_NONE,
                DWRITE_MEASURING_MODE_NATURAL,
            );
            interop.EndDraw()
        }
    }
}
