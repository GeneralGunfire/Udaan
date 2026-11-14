//! Text for the composition tree: DirectWrite shapes it, Direct2D draws it into a
//! composition drawing surface (a GPU texture owned by the compositor), and the
//! compositor then moves, rotates and blends that texture with no further work
//! from us. Redrawing happens only when the text changes.

use windows::{
    core::{w, Interface, Result},
    Foundation::Size,
    Graphics::DirectX::{DirectXAlphaMode, DirectXPixelFormat},
    UI::Composition::{CompositionGraphicsDevice, Compositor, SpriteVisual},
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
                DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_MEASURING_MODE_NATURAL,
            },
            Dxgi::IDXGIDevice,
        },
        System::WinRT::Composition::{ICompositionDrawingSurfaceInterop, ICompositorInterop},
    },
};
use windows_numerics::{Matrix3x2, Vector2};

/// Everything that has to stay alive for as long as any text surface is shown.
pub struct TextGpu {
    _d3d: ID3D11Device,
    _d2d: ID2D1Device,
    gfx: CompositionGraphicsDevice,
    dw: IDWriteFactory,
    pub feature_level: u32,
}

pub fn init(compositor: &Compositor) -> Result<TextGpu> {
    unsafe {
        let mut dev: Option<ID3D11Device> = None;
        let mut level = Default::default();
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut dev),
            Some(&mut level),
            None,
        )?;
        let d3d = dev.expect("D3D11CreateDevice returned no device");
        let dxgi: IDXGIDevice = d3d.cast()?;
        let d2d: ID2D1Device = D2D1CreateDevice(&dxgi, None)?;
        let interop: ICompositorInterop = compositor.cast()?;
        let gfx = interop.CreateGraphicsDevice(&d2d)?;
        let dw: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
        Ok(TextGpu { _d3d: d3d, _d2d: d2d, gfx, dw, feature_level: level.0 as u32 })
    }
}

/// Draws `text` once into a GPU surface and returns a sprite showing it.
pub fn text_sprite(t: &TextGpu, compositor: &Compositor, text: &str, w: u32, h: u32, size: f32, bold: bool) -> Result<SpriteVisual> {
    unsafe {
        let surface = t.gfx.CreateDrawingSurface(
            Size { Width: w as f32, Height: h as f32 },
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            DirectXAlphaMode::Premultiplied,
        )?;
        let interop: ICompositionDrawingSurfaceInterop = surface.cast()?;
        let mut offset = POINT::default();
        let ctx: ID2D1DeviceContext = interop.BeginDraw(None, &mut offset)?;
        ctx.SetTransform(&Matrix3x2::translation(offset.x as f32, offset.y as f32));
        ctx.Clear(Some(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }));
        let brush = ctx.CreateSolidColorBrush(&D2D1_COLOR_F { r: 0.94, g: 0.96, b: 1.0, a: 1.0 }, None)?;
        let fmt = t.dw.CreateTextFormat(
            w!("Segoe UI"),
            None,
            if bold { DWRITE_FONT_WEIGHT_SEMI_BOLD } else { DWRITE_FONT_WEIGHT_NORMAL },
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            size,
            w!("en-us"),
        )?;
        let wide: Vec<u16> = text.encode_utf16().collect();
        ctx.DrawText(
            &wide,
            &fmt,
            &D2D_RECT_F { left: 0.0, top: 0.0, right: w as f32, bottom: h as f32 },
            &brush,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
            DWRITE_MEASURING_MODE_NATURAL,
        );
        interop.EndDraw()?;

        let sprite = compositor.CreateSpriteVisual()?;
        sprite.SetBrush(&compositor.CreateSurfaceBrushWithSurface(&surface)?)?;
        sprite.SetSize(Vector2 { X: w as f32, Y: h as f32 })?;
        Ok(sprite)
    }
}
