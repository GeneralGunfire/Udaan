//! GPU drawing into the composition tree.
//!
//! Direct2D/DirectWrite draw into composition drawing surfaces (GPU textures owned by
//! the compositor). The compositor then moves, scales and blends those textures with no
//! further work from us: a surface is redrawn only when its content changes, so an
//! idle surface costs nothing. This module owns the D3D11/D2D/DWrite/WIC devices and
//! gives out labels, image surfaces, app icons and a free-form canvas.

use windows::{
    core::{Interface, Result, HSTRING, PCWSTR},
    Foundation::Size,
    Graphics::DirectX::{DirectXAlphaMode, DirectXPixelFormat},
    UI::Composition::{CompositionDrawingSurface, CompositionGraphicsDevice, Compositor, SpriteVisual},
    Win32::{
        Foundation::{GENERIC_READ, HMODULE, POINT, SIZE},
        Graphics::{
            Direct2D::{
                Common::{D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_PIXEL_FORMAT, D2D_RECT_F, D2D_SIZE_U},
                D2D1CreateDevice, ID2D1Bitmap1, ID2D1Device, ID2D1DeviceContext, D2D1_BITMAP_OPTIONS_NONE, D2D1_BITMAP_PROPERTIES1,
                D2D1_DRAW_TEXT_OPTIONS_NONE,
            },
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{D3D11CreateDevice, ID3D11Device, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION},
            DirectWrite::{
                DWriteCreateFactory, IDWriteFactory, IDWriteFactory5, IDWriteFactory6, IDWriteFontCollection, IDWriteTextFormat,
                DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_FAMILY_MODEL_TYPOGRAPHIC,
                DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT, DWRITE_MEASURING_MODE_NATURAL,
                DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_TEXT_ALIGNMENT_LEADING,
                DWRITE_TEXT_ALIGNMENT_TRAILING, DWRITE_WORD_WRAPPING_NO_WRAP,
            },
            Dxgi::{Common::DXGI_FORMAT_B8G8R8A8_UNORM, IDXGIDevice},
            Gdi::{DeleteObject, GetObjectW, BITMAP, HBITMAP},
            Imaging::{
                CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICBitmapSource, IWICImagingFactory,
                WICBitmapDitherTypeNone, WICBitmapInterpolationModeFant, WICBitmapPaletteTypeMedianCut,
                WICDecodeMetadataCacheOnDemand,
            },
        },
        System::{
            Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
            WinRT::Composition::{ICompositionDrawingSurfaceInterop, ICompositorInterop},
        },
        UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY},
    },
};
use windows_numerics::{Matrix3x2, Vector2};

#[derive(Clone, Copy, PartialEq)]
pub enum Align {
    Left,
    Center,
    Right,
}

#[derive(Clone)]
pub struct TextStyle {
    pub family: String,
    pub size: f32,
    pub weight: u32,
    pub align: Align,
    pub color: [f32; 4],
}

pub fn col(c: windows::UI::Color) -> [f32; 4] {
    [c.R as f32 / 255.0, c.G as f32 / 255.0, c.B as f32 / 255.0, c.A as f32 / 255.0]
}

pub fn d2d_color(c: [f32; 4]) -> D2D1_COLOR_F {
    D2D1_COLOR_F { r: c[0], g: c[1], b: c[2], a: c[3] }
}

/// Everything that has to stay alive for as long as any surface is shown.
pub struct Gpu {
    _d3d: ID3D11Device,
    _d2d: ID2D1Device,
    gfx: CompositionGraphicsDevice,
    pub dw: IDWriteFactory,
    wic: IWICImagingFactory,
    /// A private font collection (our bundled Montserrat), if it loaded.
    fonts: std::cell::RefCell<Option<(String, IDWriteFontCollection)>>,
}

impl Gpu {
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
            let wic: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            Ok(Self { _d3d: d3d, _d2d: d2d, gfx, dw, wic, fonts: std::cell::RefCell::new(None) })
        }
    }

    /// A drawing surface of `w` x `h` device pixels with a sprite visual showing it.
    pub fn surface(&self, compositor: &Compositor, w: u32, h: u32) -> Result<Surface> {
        let surface = self.gfx.CreateDrawingSurface(
            Size { Width: w.max(1) as f32, Height: h.max(1) as f32 },
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            DirectXAlphaMode::Premultiplied,
        )?;
        let visual = compositor.CreateSpriteVisual()?;
        visual.SetBrush(&compositor.CreateSurfaceBrushWithSurface(&surface)?)?;
        visual.SetSize(Vector2 { X: w as f32, Y: h as f32 })?;
        Ok(Surface { visual, surface, w, h })
    }

    /// Register a font file as a private collection (never installed system-wide) under
    /// `family`. Variable fonts are expanded into their named instances, so weights
    /// 300/400/600/700 all resolve from the one file. On failure the caller's family
    /// name simply resolves against system fonts instead.
    pub fn load_private_font(&self, path: &str, family: &str) -> Result<()> {
        unsafe {
            let f5: IDWriteFactory5 = self.dw.cast()?;
            let f6: IDWriteFactory6 = self.dw.cast()?;
            let builder = f5.CreateFontSetBuilder()?; // IDWriteFontSetBuilder1: file-based AddFontFile
            let file = f5.CreateFontFileReference(&HSTRING::from(path), None)?;
            builder.AddFontFile(&file)?;
            let set = builder.CreateFontSet()?;
            let coll = f6.CreateFontCollectionFromFontSet(&set, DWRITE_FONT_FAMILY_MODEL_TYPOGRAPHIC)?;
            let n = coll.GetFontFamilyCount();
            println!("font: private collection from {path}: {n} family/families");
            *self.fonts.borrow_mut() = Some((family.to_string(), coll.cast()?));
            Ok(())
        }
    }

    pub fn format(&self, style: &TextStyle) -> Result<IDWriteTextFormat> {
        unsafe {
            let private = self.fonts.borrow().as_ref().filter(|(fam, _)| *fam == style.family).map(|(_, c)| c.clone());
            let fmt = self.dw.CreateTextFormat(
                &HSTRING::from(&style.family),
                private.as_ref(),
                DWRITE_FONT_WEIGHT(style.weight as i32),
                DWRITE_FONT_STYLE_NORMAL,
                DWRITE_FONT_STRETCH_NORMAL,
                style.size,
                windows::core::w!("en-us"),
            )?;
            fmt.SetTextAlignment(match style.align {
                Align::Left => DWRITE_TEXT_ALIGNMENT_LEADING,
                Align::Center => DWRITE_TEXT_ALIGNMENT_CENTER,
                Align::Right => DWRITE_TEXT_ALIGNMENT_TRAILING,
            })?;
            fmt.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER)?;
            fmt.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP)?;
            Ok(fmt)
        }
    }

    /// Width in device pixels of `text` in `style` (single line).
    pub fn measure(&self, text: &str, style: &TextStyle) -> f32 {
        let go = || -> Result<f32> {
            unsafe {
                let fmt = self.format(style)?;
                let wide: Vec<u16> = text.encode_utf16().collect();
                let layout = self.dw.CreateTextLayout(&wide, &fmt, 4096.0, 256.0)?;
                let mut m = Default::default();
                layout.GetMetrics(&mut m)?;
                Ok(m.widthIncludingTrailingWhitespace)
            }
        };
        go().unwrap_or(0.0)
    }

    /// A text label of `w` x `h` device pixels.
    pub fn label(&self, compositor: &Compositor, w: u32, h: u32, style: TextStyle) -> Result<Label> {
        Ok(Label { surface: self.surface(compositor, w, h)?, style, text: String::new(), shadow: None })
    }

    /// Decode an image file to a premultiplied BGRA WIC source scaled so it covers
    /// `w` x `h` (aspect kept, centre crop happens at draw time).
    fn decode(&self, path: &str, w: u32, h: u32) -> Result<(IWICBitmapSource, u32, u32)> {
        unsafe {
            let dec = self.wic.CreateDecoderFromFilename(
                &HSTRING::from(path),
                None,
                GENERIC_READ,
                WICDecodeMetadataCacheOnDemand,
            )?;
            let frame = dec.GetFrame(0)?;
            let (mut sw, mut sh) = (0u32, 0u32);
            frame.GetSize(&mut sw, &mut sh)?;
            let scale = (w as f32 / sw.max(1) as f32).max(h as f32 / sh.max(1) as f32).min(1.0);
            let (tw, th) = (((sw as f32) * scale).round().max(1.0) as u32, ((sh as f32) * scale).round().max(1.0) as u32);
            let scaler = self.wic.CreateBitmapScaler()?;
            scaler.Initialize(&frame, tw, th, WICBitmapInterpolationModeFant)?;
            let conv = self.wic.CreateFormatConverter()?;
            conv.Initialize(&scaler, &GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeMedianCut)?;
            Ok((conv.cast()?, tw, th))
        }
    }

    /// Draw an image file into a new surface, scaled to cover and centre-cropped.
    pub fn image(&self, compositor: &Compositor, path: &str, w: u32, h: u32) -> Result<Surface> {
        let (src, sw, sh) = self.decode(path, w, h)?;
        let s = self.surface(compositor, w, h)?;
        s.draw(|ctx, _, _| unsafe {
            let bmp = ctx.CreateBitmapFromWicBitmap(&src, None)?;
            let scale = (w as f32 / sw as f32).max(h as f32 / sh as f32);
            let (dw, dh) = (sw as f32 * scale, sh as f32 * scale);
            let (x, y) = ((w as f32 - dw) / 2.0, (h as f32 - dh) / 2.0);
            ctx.DrawBitmap(&bmp, Some(&D2D_RECT_F { left: x, top: y, right: x + dw, bottom: y + dh }), 1.0, windows::Win32::Graphics::Direct2D::D2D1_INTERPOLATION_MODE_LINEAR, None, None);
            Ok(())
        })?;
        Ok(s)
    }

    /// A blurred crop of the wallpaper, for glass. `region` is (x, y, w, h) in screen
    /// pixels. The wallpaper is scaled to cover the screen exactly as `image` does, so
    /// the crop lines up with what the desktop layer draws. Blurred once, at build time;
    /// hard border mode so the screen edge does not fade to transparent.
    pub fn glass_backdrop(&self, compositor: &Compositor, path: &str, screen: (u32, u32), region: (f32, f32, f32, f32), sigma: f32) -> Result<Surface> {
        let (sw, sh) = screen;
        let (src, tw, th) = self.decode(path, sw, sh)?;
        let (rw, rh) = (region.2.ceil().max(1.0), region.3.ceil().max(1.0));
        let surf = self.surface(compositor, rw as u32, rh as u32)?;
        surf.draw(move |ctx, w, h| unsafe {
            use windows::Win32::Graphics::Direct2D::{
                Common::{D2D1_BORDER_MODE_HARD, D2D1_COMPOSITE_MODE_SOURCE_OVER}, CLSID_D2D1GaussianBlur, D2D1_ANTIALIAS_MODE_ALIASED,
                D2D1_GAUSSIANBLUR_PROP_BORDER_MODE, D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION, D2D1_PROPERTY_TYPE_ENUM,
                D2D1_PROPERTY_TYPE_FLOAT,
            };
            let bmp = ctx.CreateBitmapFromWicBitmap(&src, None)?;
            let scale = (sw as f32 / tw as f32).max(sh as f32 / th as f32);
            let (dw, dh) = (tw as f32 * scale, th as f32 * scale);
            let (x0, y0) = ((sw as f32 - dw) / 2.0, (sh as f32 - dh) / 2.0);
            let mut base = Matrix3x2::default();
            ctx.GetTransform(&mut base);
            // Never draw outside this surface's own rectangle in the shared atlas.
            ctx.SetTransform(&Matrix3x2::identity());
            ctx.PushAxisAlignedClip(&D2D_RECT_F { left: base.M31, top: base.M32, right: base.M31 + w, bottom: base.M32 + h }, D2D1_ANTIALIAS_MODE_ALIASED);
            let fx = ctx.CreateEffect(&CLSID_D2D1GaussianBlur)?;
            fx.SetInput(0, &bmp, true);
            let sd = (sigma / scale).max(0.5);
            fx.SetValue(D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION.0 as u32, D2D1_PROPERTY_TYPE_FLOAT, &sd.to_le_bytes())?;
            fx.SetValue(D2D1_GAUSSIANBLUR_PROP_BORDER_MODE.0 as u32, D2D1_PROPERTY_TYPE_ENUM, &(D2D1_BORDER_MODE_HARD.0 as u32).to_le_bytes())?;
            let out = fx.GetOutput()?;
            // image px -> surface px: scale to cover, then shift so the region's corner
            // lands on the surface origin.
            ctx.SetTransform(&Matrix3x2 { M11: scale, M12: 0.0, M21: 0.0, M22: scale, M31: x0 - region.0 + base.M31, M32: y0 - region.1 + base.M32 });
            ctx.DrawImage(&out, None, None, windows::Win32::Graphics::Direct2D::D2D1_INTERPOLATION_MODE_LINEAR, D2D1_COMPOSITE_MODE_SOURCE_OVER);
            ctx.SetTransform(&Matrix3x2::identity());
            ctx.PopAxisAlignedClip();
            ctx.SetTransform(&base);
            Ok(())
        })?;
        Ok(surf)
    }

    /// The icon of an executable (or any shell item) as premultiplied BGRA pixels,
    /// `size` x `size`. Uses the shell's image factory, so it is the same icon Explorer
    /// shows, at the best available resolution.
    pub fn icon_pixels(path: &str, size: u32) -> Result<(Vec<u8>, u32, u32)> {
        unsafe {
            let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let item: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None::<&windows::Win32::System::Com::IBindCtx>)
                .map_err(|e| { println!("icon: SHCreateItemFromParsingName: {e}"); e })?;
            let hbm: HBITMAP = item.GetImage(SIZE { cx: size as i32, cy: size as i32 }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK)
                .map_err(|e| { println!("icon: GetImage: {e}"); e })?;
            // The shell hands back a 32 bpp DIB section: read its bits directly.
            let mut bm = BITMAP::default();
            let got = GetObjectW(hbm.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut _));
            let result = if got == 0 || bm.bmBits.is_null() || bm.bmBitsPixel != 32 {
                println!("icon: GetObject failed or not a 32bpp DIB (bits {:p}, bpp {})", bm.bmBits, bm.bmBitsPixel);
                Err(windows::core::Error::from_win32())
            } else {
                let (w, h) = (bm.bmWidth.max(1) as u32, bm.bmHeight.unsigned_abs().max(1));
                let stride = bm.bmWidthBytes as usize;
                let src = std::slice::from_raw_parts(bm.bmBits as *const u8, stride * h as usize);
                let mut buf = vec![0u8; (w * h * 4) as usize];
                let bottom_up = bm.bmHeight > 0;
                for y in 0..h as usize {
                    let sy = if bottom_up { h as usize - 1 - y } else { y };
                    let row = &src[sy * stride..sy * stride + (w * 4) as usize];
                    buf[y * (w * 4) as usize..(y + 1) * (w * 4) as usize].copy_from_slice(row);
                }
                Ok((buf, w, h))
            };
            let _ = DeleteObject(hbm.into());
            let (mut buf, w, h) = result?;
            // The shell gives straight alpha; Direct2D wants premultiplied.
            for px in buf.chunks_exact_mut(4) {
                let a = px[3] as u32;
                if a < 255 {
                    px[0] = (px[0] as u32 * a / 255) as u8;
                    px[1] = (px[1] as u32 * a / 255) as u8;
                    px[2] = (px[2] as u32 * a / 255) as u8;
                }
            }
            Ok((buf, w, h))
        }
    }
}

pub fn bitmap_from_pixels(ctx: &ID2D1DeviceContext, px: &[u8], w: u32, h: u32) -> Result<ID2D1Bitmap1> {
    unsafe {
        let props = D2D1_BITMAP_PROPERTIES1 {
            pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
            dpiX: 96.0,
            dpiY: 96.0,
            bitmapOptions: D2D1_BITMAP_OPTIONS_NONE,
            colorContext: std::mem::ManuallyDrop::new(None),
        };
        ctx.CreateBitmap(D2D_SIZE_U { width: w, height: h }, Some(px.as_ptr() as *const _), w * 4, &props)
    }
}

/// A composition drawing surface plus the sprite that shows it.
pub struct Surface {
    pub visual: SpriteVisual,
    surface: CompositionDrawingSurface,
    pub w: u32,
    pub h: u32,
}

impl Surface {
    /// Redraw the whole surface. The closure gets a cleared, transparent context
    /// whose origin is the surface's top-left, and the size in device pixels.
    pub fn draw(&self, f: impl FnOnce(&ID2D1DeviceContext, f32, f32) -> Result<()>) -> Result<()> {
        unsafe {
            let interop: ICompositionDrawingSurfaceInterop = self.surface.cast()?;
            let mut offset = POINT::default();
            let ctx: ID2D1DeviceContext = interop.BeginDraw(None, &mut offset)?;
            ctx.SetTransform(&Matrix3x2::translation(offset.x as f32, offset.y as f32));
            ctx.Clear(Some(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }));
            let r = f(&ctx, self.w as f32, self.h as f32);
            interop.EndDraw()?;
            r
        }
    }
}

pub struct Label {
    pub surface: Surface,
    pub style: TextStyle,
    pub text: String,
    /// Soft neutral shadow under the glyphs, for legibility straight on a wallpaper
    /// (the design uses a text shadow instead of a scrim behind the text).
    pub shadow: Option<f32>,
}

impl Label {
    /// Give the label a soft shadow of the given strength (0..1).
    pub fn with_shadow(mut self, strength: f32) -> Self {
        self.shadow = Some(strength);
        self
    }

    pub fn visual(&self) -> &SpriteVisual {
        &self.surface.visual
    }

    /// Redraw only if the text changed.
    pub fn set_text(&mut self, gpu: &Gpu, text: &str) -> Result<()> {
        if self.text == text {
            return Ok(());
        }
        self.text = text.to_string();
        let fmt = gpu.format(&self.style)?;
        let color = self.style.color;
        let (shadow, size) = (self.shadow, self.style.size);
        let (w, h) = (self.surface.w as f32, self.surface.h as f32);
        self.surface.draw(|ctx, _, _| unsafe {
            let wide: Vec<u16> = text.encode_utf16().collect();
            if let Some(k) = shadow {
                // Two offset passes read as a soft shadow without a blur effect.
                let d = (size * 0.045).max(1.0);
                for (dy, a) in [(d * 1.6, 0.16 * k), (d, 0.30 * k)] {
                    let sb = ctx.CreateSolidColorBrush(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a }, None)?;
                    ctx.DrawText(&wide, &fmt, &D2D_RECT_F { left: 0.0, top: dy, right: w, bottom: h + dy }, &sb, D2D1_DRAW_TEXT_OPTIONS_NONE, DWRITE_MEASURING_MODE_NATURAL);
                }
            }
            let brush = ctx.CreateSolidColorBrush(&d2d_color(color), None)?;
            ctx.DrawText(
                &wide,
                &fmt,
                &D2D_RECT_F { left: 0.0, top: 0.0, right: w, bottom: h },
                &brush,
                D2D1_DRAW_TEXT_OPTIONS_NONE,
                DWRITE_MEASURING_MODE_NATURAL,
            );
            Ok(())
        })
    }
}
