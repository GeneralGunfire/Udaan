//! The shared engine: ONE Compositor and ONE D3D11/D2D/DirectWrite device for the
//! whole process, plus a text-format cache.
//!
//! Every shell window (dock, top bar, desktop layer) hangs its own
//! `DesktopWindowTarget` off this single compositor. Before this existed each window
//! created its own compositor and its own GPU device, which multiplied the driver
//! allocations on a 2012 Intel HD and meant brushes and surfaces could not be shared.
//!
//! Cheap to clone: everything inside is a refcounted COM object.

use crate::gfx::{Gpu, TextStyle};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use windows::{
    core::Result,
    UI::Composition::Compositor,
    Win32::Graphics::DirectWrite::IDWriteTextFormat,
};

/// Key for the text-format cache. Font size is quantised to 1/4 px: DirectWrite
/// formats are expensive to build and a dock redraw asks for the same few sizes.
#[derive(Clone, PartialEq, Eq, Hash)]
struct FormatKey {
    family: String,
    size_q: u32,
    weight: u32,
    align: u8,
}

pub struct Engine {
    pub compositor: Compositor,
    pub gpu: Gpu,
    formats: RefCell<HashMap<FormatKey, IDWriteTextFormat>>,
}

impl Engine {
    pub fn new() -> Result<Rc<Self>> {
        let compositor = Compositor::new()?;
        let gpu = Gpu::new(&compositor)?;
        // Bundled Montserrat, as a private font: never installed, never touches the
        // user's system fonts. If it fails, text falls back to the system face.
        let font = crate::theme::dir().join("fonts").join("Montserrat-Variable.ttf");
        if let Err(e) = gpu.load_private_font(&font.to_string_lossy(), "Montserrat") {
            println!("font: Montserrat not loaded ({e}); falling back to system fonts");
        }
        Ok(Rc::new(Self { compositor, gpu, formats: RefCell::new(HashMap::new()) }))
    }

    /// A DirectWrite format for this style, built once and reused.
    pub fn format(&self, style: &TextStyle) -> Result<IDWriteTextFormat> {
        let key = FormatKey {
            family: style.family.clone(),
            size_q: (style.size * 4.0).round() as u32,
            weight: style.weight,
            align: style.align as u8,
        };
        if let Some(f) = self.formats.borrow().get(&key) {
            return Ok(f.clone());
        }
        let f = self.gpu.format(style)?;
        self.formats.borrow_mut().insert(key, f.clone());
        Ok(f)
    }

    /// Drop cached formats (after a theme or DPI change, so stale sizes do not pile up).
    pub fn clear_format_cache(&self) {
        self.formats.borrow_mut().clear();
    }

    pub fn cached_format_count(&self) -> usize {
        self.formats.borrow().len()
    }
}
