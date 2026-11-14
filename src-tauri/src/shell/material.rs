//! Real window materials: acrylic and mica, applied by the Desktop Window
//! Manager to Udaan's transparent shell windows.
//!
//! WHY THIS EXISTS
//! ---------------
//! A webview cannot blur what is behind its own window. `backdrop-filter`
//! only samples pixels inside the same page, and every Udaan shell surface
//! (menu bar, dock, flyouts, widgets) is a transparent OS window with the
//! real desktop behind it — so CSS blur there samples nothing and costs GPU
//! every frame for the privilege.
//!
//! The only way to blur the actual desktop behind a window is to ask the
//! compositor, which owns those pixels. Two routes exist:
//!
//!   * `DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE)` — the documented
//!     Windows 11 build 22621+ path. Gives Mica, Acrylic and Mica Alt, and
//!     is what WinUI 3 itself uses. Correct, but needs a recent Win 11.
//!   * `SetWindowCompositionAttribute(ACCENT_ENABLE_ACRYLICBLURBEHIND)` —
//!     undocumented, present since Windows 10 1803. This is what every
//!     third-party shell uses, because it is the only option on Win 10 and
//!     on Win 11 builds before 22621.
//!
//! We try the documented call first and fall back to the undocumented one,
//! so the same code gives real material on Windows 10 1803 through current
//! Windows 11. If both fail the window simply stays as it is and the
//! webview's own gradient tint carries the surface — degraded, never broken.
//!
//! A NOTE ON THE FALLBACK'S TINT
//! -----------------------------
//! `ACCENT_ENABLE_ACRYLICBLURBEHIND` takes a single ABGR colour that the
//! compositor composites *over* the blurred backdrop. That tint is doing the
//! same job as the CSS gradient in os.css, so the two must not both be
//! applied at full strength or the surface turns to mud. The webview side
//! drops to a near-transparent tint whenever `material_applied` reports true.

use serde::{Deserialize, Serialize};
use windows::core::BOOL;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
  DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_SYSTEMBACKDROP_TYPE,
  DWMWA_USE_IMMERSIVE_DARK_MODE, DWM_SYSTEMBACKDROP_TYPE,
};
use windows::Win32::UI::Controls::MARGINS;

/// Which material a surface asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Material {
  /// Heavily blurred, translucent. Flyouts, menus, the dock — anything that
  /// floats above content and must stay legible over an unknown backdrop.
  Acrylic,
  /// Subtle, wallpaper-tinted, barely blurred. Long-lived surfaces: the menu
  /// bar, window chrome. Cheaper than acrylic because the compositor samples
  /// the wallpaper once rather than the live backdrop every frame.
  Mica,
  /// A darker Mica for surfaces that sit under content.
  MicaAlt,
  /// No material; the window keeps whatever the webview paints.
  None,
}

impl Material {
  /// The documented DWMWA_SYSTEMBACKDROP_TYPE value.
  fn backdrop_type(self) -> i32 {
    match self {
      // DWMSBT_AUTO = 0, DWMSBT_NONE = 1, DWMSBT_MAINWINDOW (Mica) = 2,
      // DWMSBT_TRANSIENTWINDOW (Acrylic) = 3, DWMSBT_TABBEDWINDOW = 4.
      Material::None => 1,
      Material::Mica => 2,
      Material::Acrylic => 3,
      Material::MicaAlt => 4,
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Undocumented SetWindowCompositionAttribute                         */
/* ------------------------------------------------------------------ */

#[repr(C)]
#[derive(Clone, Copy)]
struct AccentPolicy {
  accent_state: u32,
  accent_flags: u32,
  /// ABGR, not RGBA — the byte order trips up everyone who writes this once.
  gradient_color: u32,
  animation_id: u32,
}

#[repr(C)]
struct WindowCompositionAttributeData {
  attribute: u32,
  data: *mut core::ffi::c_void,
  size_of_data: usize,
}

const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
const ACCENT_ENABLE_BLURBEHIND: u32 = 3;
const ACCENT_DISABLED: u32 = 0;
const WCA_ACCENT_POLICY: u32 = 19;

/// Resolved once: `user32!SetWindowCompositionAttribute` is exported but not
/// declared in any header, so it has to be located by name at runtime.
type SetWindowCompositionAttributeFn =
  unsafe extern "system" fn(HWND, *mut WindowCompositionAttributeData) -> BOOL;

fn composition_fn() -> Option<SetWindowCompositionAttributeFn> {
  use std::sync::OnceLock;
  use windows::core::{s, PCSTR};
  use windows::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};

  static FN: OnceLock<Option<usize>> = OnceLock::new();
  // get_or_init yields &Option<usize>; copy it out before using `?`.
  let addr = (*FN.get_or_init(|| unsafe {
    let user32 = GetModuleHandleA(s!("user32.dll")).ok()?;
    let proc = GetProcAddress(user32, PCSTR(c"SetWindowCompositionAttribute".as_ptr() as *const u8))?;
    Some(proc as usize)
  }))?;
  // Transmuting a resolved export to its known signature is the documented
  // way to call a function located with GetProcAddress.
  Some(unsafe { std::mem::transmute::<usize, SetWindowCompositionAttributeFn>(addr) })
}

/// Applies the legacy acrylic blur. `tint` is 0xAABBGGRR.
///
/// Returns false when the export is missing (pre-1803), which is the signal
/// to leave the webview's own gradient at full strength.
fn apply_legacy_acrylic(hwnd: HWND, tint: u32, fallback_blur: bool) -> bool {
  let Some(set_attr) = composition_fn() else { return false };
  let mut policy = AccentPolicy {
    accent_state: if fallback_blur { ACCENT_ENABLE_BLURBEHIND } else { ACCENT_ENABLE_ACRYLICBLURBEHIND },
    // Flag 2 draws the tint over all four edges; without it the blur stops
    // short of the window border and leaves a visible unblurred hairline.
    accent_flags: 2,
    gradient_color: tint,
    animation_id: 0,
  };
  let mut data = WindowCompositionAttributeData {
    attribute: WCA_ACCENT_POLICY,
    data: &mut policy as *mut _ as *mut core::ffi::c_void,
    size_of_data: std::mem::size_of::<AccentPolicy>(),
  };
  unsafe { set_attr(hwnd, &mut data).as_bool() }
}

fn clear_legacy_acrylic(hwnd: HWND) {
  let Some(set_attr) = composition_fn() else { return };
  let mut policy = AccentPolicy { accent_state: ACCENT_DISABLED, accent_flags: 0, gradient_color: 0, animation_id: 0 };
  let mut data = WindowCompositionAttributeData {
    attribute: WCA_ACCENT_POLICY,
    data: &mut policy as *mut _ as *mut core::ffi::c_void,
    size_of_data: std::mem::size_of::<AccentPolicy>(),
  };
  unsafe {
    let _ = set_attr(hwnd, &mut data);
  }
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

/// True on Windows 11 22621 (22H2) and later, where DWMWA_SYSTEMBACKDROP_TYPE
/// is honoured. Below that the attribute is accepted and silently ignored,
/// which is why the build number has to be checked rather than the HRESULT.
fn supports_system_backdrop() -> bool {
  use std::sync::OnceLock;
  static OK: OnceLock<bool> = OnceLock::new();
  *OK.get_or_init(|| {
    // RtlGetVersion is the only version API that is not shimmed by the
    // application-compatibility layer, so it reports the true build.
    #[link(name = "ntdll")]
    unsafe extern "system" {
      fn RtlGetVersion(info: *mut OsVersionInfoW) -> i32;
    }
    #[repr(C)]
    struct OsVersionInfoW {
      dw_os_version_info_size: u32,
      dw_major_version: u32,
      dw_minor_version: u32,
      dw_build_number: u32,
      dw_platform_id: u32,
      sz_csd_version: [u16; 128],
    }
    let mut info: OsVersionInfoW = unsafe { std::mem::zeroed() };
    info.dw_os_version_info_size = std::mem::size_of::<OsVersionInfoW>() as u32;
    if unsafe { RtlGetVersion(&mut info) } != 0 {
      return false;
    }
    info.dw_major_version >= 10 && info.dw_build_number >= 22621
  })
}

/// What was actually applied, so the webview knows how much tint to paint.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Applied {
  /// True when the compositor is really blurring the desktop behind this
  /// window. The webview drops its own gradient to a whisper when so.
  pub blurred: bool,
  /// True when the modern, documented path was used (better quality: the
  /// legacy path's blur radius is fixed and its tint banding is visible on
  /// large surfaces).
  pub modern: bool,
}

/// Applies `material` to the window, returning what the system gave us.
///
/// `tint` is 0xAARRGGBB as CSS writes it; it is converted to the ABGR the
/// composition API expects. `dark` selects the dark scrollbars//frame that
/// DWM draws for the window.
pub fn apply(hwnd: isize, material: Material, tint: u32, dark: bool) -> Applied {
  let hwnd = HWND(hwnd as *mut core::ffi::c_void);

  unsafe {
    // Dark mode first: it changes how DWM tints the material itself, so
    // setting it after would make the first frame flash the wrong colour.
    let flag = BOOL::from(dark);
    let _ = DwmSetWindowAttribute(
      hwnd,
      DWMWA_USE_IMMERSIVE_DARK_MODE,
      &flag as *const _ as *const core::ffi::c_void,
      std::mem::size_of::<BOOL>() as u32,
    );
  }

  if material == Material::None {
    clear_legacy_acrylic(hwnd);
    return Applied { blurred: false, modern: false };
  }

  // The modern path. A system backdrop is only composited into the area the
  // frame has been extended over, so the margins must be pushed out to cover
  // the whole client area first — missing this is why the attribute so often
  // "does nothing".
  if supports_system_backdrop() {
    unsafe {
      let margins = MARGINS { cxLeftWidth: -1, cxRightWidth: -1, cyTopHeight: -1, cyBottomHeight: -1 };
      let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);

      let kind = DWM_SYSTEMBACKDROP_TYPE(material.backdrop_type());
      let ok = DwmSetWindowAttribute(
        hwnd,
        DWMWA_SYSTEMBACKDROP_TYPE,
        &kind as *const _ as *const core::ffi::c_void,
        std::mem::size_of::<DWM_SYSTEMBACKDROP_TYPE>() as u32,
      )
      .is_ok();
      if ok {
        // Legacy acrylic and a system backdrop on the same window fight,
        // producing a double-darkened surface.
        clear_legacy_acrylic(hwnd);
        return Applied { blurred: true, modern: true };
      }
    }
  }

  // Legacy path. Convert 0xAARRGGBB to the 0xAABBGGRR the API wants.
  let a = (tint >> 24) & 0xff;
  let r = (tint >> 16) & 0xff;
  let g = (tint >> 8) & 0xff;
  let b = tint & 0xff;
  let abgr = (a << 24) | (b << 16) | (g << 8) | r;

  // Always plain blur-behind on this path, never legacy acrylic.
  //
  // This path only runs on Windows 10 and early Windows 11, and legacy
  // acrylic (ACCENT_ENABLE_ACRYLICBLURBEHIND) is the expensive part of it:
  // it re-samples and re-blurs the backdrop with a noise layer every time
  // the window repaints, which on an integrated GPU makes anything that
  // animates inside the window stutter. Plain blur-behind is a fraction of
  // the cost and reads as the same material at flyout sizes. Real acrylic is
  // left to the modern DWM path above, where it is cheap.
  let blurred = apply_legacy_acrylic(hwnd, abgr, true);
  Applied { blurred, modern: false }
}

/// Rounded corners, so shell surfaces match Windows 11's own geometry
/// instead of being square against rounded system menus.
pub fn set_corners(hwnd: isize, round: bool) {
  use windows::Win32::Graphics::Dwm::{DWMWA_WINDOW_CORNER_PREFERENCE, DWM_WINDOW_CORNER_PREFERENCE};
  let hwnd = HWND(hwnd as *mut core::ffi::c_void);
  // DWMWCP_DEFAULT = 0, DWMWCP_DONOTROUND = 1, DWMWCP_ROUND = 2, DWMWCP_ROUNDSMALL = 3.
  let pref = DWM_WINDOW_CORNER_PREFERENCE(if round { 2 } else { 1 });
  unsafe {
    let _ = DwmSetWindowAttribute(
      hwnd,
      DWMWA_WINDOW_CORNER_PREFERENCE,
      &pref as *const _ as *const core::ffi::c_void,
      std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
    );
  }
}
