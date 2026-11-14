//! Design tokens, loaded from `theme/theme.toml` and `theme/dock.toml` next to the
//! executable (or `shell/theme` when run from the workspace). Hand-rolled reader for
//! the small TOML subset those files use, so no serde in the binary. Every token has a
//! compiled default; a broken file only prints a warning.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use windows::UI::Color;

#[derive(Clone, Debug)]
pub enum Value {
    Num(f32),
    List(Vec<f32>),
    Color(Color),
    Str(String),
    Bool(bool),
}

#[derive(Clone, Copy, Debug)]
pub struct Spring {
    pub period_ms: f32,
    pub damping: f32,
}

impl Spring {
    pub fn period_100ns(self) -> i64 {
        (self.period_ms * 10_000.0) as i64
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Shadow {
    pub blur: f32,
    pub offset_y: f32,
    pub opacity: f32,
}

/// One colour set (light or dark).
#[derive(Clone, Debug)]
pub struct Palette {
    pub glass_tint: Color,
    pub glass_opaque: Color,
    pub glass_edge: Color,
    pub glass_border: Color,
    pub glass_shade: Color,
    pub text: Color,
    pub text_secondary: Color,
    pub text_tertiary: Color,
    pub accent: Color,
    pub accent_text: Color,
    pub indicator: Color,
    pub icon_plate: Color,
    pub separator: Color,
    pub widget_tint: Color,
    pub widget_edge: Color,
    pub shadow: Color,
}

#[derive(Clone, Debug)]
pub struct Theme {
    pub family: String,
    pub mono: String,
    pub icons: String,
    pub caption: f32,
    pub label: f32,
    pub body: f32,
    pub title: f32,
    pub headline: f32,
    pub display: f32,
    pub display_weight: f32,
    pub clock_bar: f32,

    pub space: [f32; 6], // xs sm md lg xl xxl
    pub r_sm: f32,
    pub r_md: f32,
    pub r_lg: f32,
    pub r_dock: f32,
    pub r_widget: f32,
    pub r_icon: f32,

    pub el_rest: Shadow,
    pub el_float: Shadow,
    pub el_lift: Shadow,

    pub material: String,
    pub edge_px: f32,
    pub border_px: f32,

    pub dark: Palette,
    pub light: Palette,

    pub tap: Spring,
    pub hover: Spring,
    pub magnify: Spring,
    pub enter: Spring,
    pub exit: Spring,
    pub slide: Spring,
    pub settle: Spring,
    pub hover_lift: f32,
    pub press_scale: f32,

    pub dock_icon: f32,
    pub dock_gap: f32,
    pub dock_pad_x: f32,
    pub dock_pad_y: f32,
    pub dock_bottom: f32,
    pub magnify_max: f32,
    pub magnify_sigma: f32,
    pub magnify_rise: f32,
    pub tilt: f32,
    pub indicator: f32,
    pub dock_reserve: bool,

    pub topbar_height: f32,
    pub topbar_pad_x: f32,
    pub topbar_item_gap: f32,

    pub wallpaper: String,
    pub photo: String,
    pub topbar_darken: f32,
    /// Directory the theme files were loaded from; relative asset paths resolve here.
    pub dir: std::path::PathBuf,
    pub widget_width: f32,
    pub widget_margin: f32,
    pub widget_gap: f32,
    pub widget_blur: f32,
    pub vignette: f32,
}

impl Palette {
    /// A slightly stronger plate colour, for hover washes where `icon_plate` may be
    /// fully transparent (the dock sets it to 0 so icons sit directly on the glass).
    pub fn icon_plate_hover(&self) -> Color {
        let a = self.icon_plate.A.max(0x22);
        Color { A: a, ..self.icon_plate }
    }
}

impl Theme {
    /// Absolute path of the wallpaper. A relative path resolves against the theme
    /// folder; "auto" means the user's current Windows wallpaper (read-only).
    pub fn resolved_wallpaper(&self) -> String {
        self.resolve_asset(&self.wallpaper)
    }

    pub fn resolved_photo(&self) -> String {
        if self.photo.is_empty() {
            return self.resolved_wallpaper();
        }
        self.resolve_asset(&self.photo)
    }

    fn resolve_asset(&self, v: &str) -> String {
        if v == "auto" || v.is_empty() {
            return current_windows_wallpaper();
        }
        let p = std::path::Path::new(v);
        if p.is_absolute() {
            return v.to_string();
        }
        self.dir.join(p).to_string_lossy().to_string()
    }

    pub fn palette(&self, dark: bool) -> &Palette {
        if dark { &self.dark } else { &self.light }
    }
}

#[derive(Clone, Debug)]
pub struct DockApp {
    pub name: String,
    pub path: PathBuf,
}

pub fn rgba(r: u8, g: u8, b: u8, a: u8) -> Color {
    Color { A: a, R: r, G: g, B: b }
}

fn parse_color(s: &str) -> Option<Color> {
    let h = s.strip_prefix('#')?;
    let v = u32::from_str_radix(h, 16).ok()?;
    match h.len() {
        6 => Some(rgba((v >> 16) as u8, (v >> 8) as u8, v as u8, 255)),
        8 => Some(rgba((v >> 24) as u8, (v >> 16) as u8, (v >> 8) as u8, v as u8)),
        _ => None,
    }
}

fn parse_value(s: &str) -> Option<Value> {
    let s = s.trim();
    if let Some(c) = parse_color(s) {
        return Some(Value::Color(c));
    }
    if s == "true" || s == "false" {
        return Some(Value::Bool(s == "true"));
    }
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        return Some(Value::Str(s[1..s.len() - 1].replace("\\\\", "\\")));
    }
    let nums: Option<Vec<f32>> = s.split(',').map(|p| p.trim().parse::<f32>().ok()).collect();
    match nums {
        Some(v) if v.len() == 1 => Some(Value::Num(v[0])),
        Some(v) if !v.is_empty() => Some(Value::List(v)),
        _ => None,
    }
}

/// Strip a trailing `# comment`, leaving `#RRGGBB` values alone (they follow `=`).
fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut in_str = false;
    let mut seen_eq = false;
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if c == '"' {
            in_str = !in_str;
        } else if c == '=' && !in_str {
            seen_eq = true;
        } else if c == '#' && !in_str {
            // A colour literal is the first non-space token after `=`.
            let before = line[..i].trim_end();
            let is_color = seen_eq && before.ends_with('=');
            if !is_color {
                return &line[..i];
            }
        }
        i += 1;
    }
    line
}

/// Parse `[section]` / `key = value` into a flat `section.key` map. `[[app]]` tables
/// become `app.N.key`.
pub fn parse(text: &str) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    let mut section = String::new();
    let mut array_index: i32 = -1;
    for raw in text.lines() {
        let line = strip_comment(raw).trim();
        if line.is_empty() {
            continue;
        }
        if let Some(inner) = line.strip_prefix("[[").and_then(|l| l.strip_suffix("]]")) {
            array_index += 1;
            section = format!("{}.{}", inner.trim(), array_index);
            continue;
        }
        if let Some(inner) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = inner.trim().to_string();
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            match parse_value(v) {
                Some(val) => {
                    out.insert(format!("{}.{}", section, k.trim()), val);
                }
                None => println!("theme: cannot read `{}`", raw.trim()),
            }
        }
    }
    out
}

struct Reader<'a>(&'a HashMap<String, Value>);

impl Reader<'_> {
    fn num(&self, k: &str, d: f32) -> f32 {
        match self.0.get(k) {
            Some(Value::Num(n)) => *n,
            _ => d,
        }
    }
    fn boolean(&self, k: &str, d: bool) -> bool {
        match self.0.get(k) {
            Some(Value::Bool(b)) => *b,
            _ => d,
        }
    }
    fn str(&self, k: &str, d: &str) -> String {
        match self.0.get(k) {
            Some(Value::Str(s)) => s.clone(),
            _ => d.to_string(),
        }
    }
    fn color(&self, k: &str, d: Color) -> Color {
        match self.0.get(k) {
            Some(Value::Color(c)) => *c,
            _ => d,
        }
    }
    fn spring(&self, k: &str, period: f32, damping: f32) -> Spring {
        match self.0.get(k) {
            Some(Value::List(v)) if v.len() >= 2 => Spring { period_ms: v[0], damping: v[1] },
            _ => Spring { period_ms: period, damping },
        }
    }
    fn shadow(&self, k: &str, blur: f32, y: f32, op: f32) -> Shadow {
        match self.0.get(k) {
            Some(Value::List(v)) if v.len() >= 3 => Shadow { blur: v[0], offset_y: v[1], opacity: v[2] },
            _ => Shadow { blur, offset_y: y, opacity: op },
        }
    }
    fn palette(&self, s: &str, dark: bool) -> Palette {
        let c = |k: &str, d: Color| self.color(&format!("{s}.{k}"), d);
        if dark {
            Palette {
                glass_tint: c("glass_tint", rgba(23, 26, 34, 0x90)),
                glass_opaque: c("glass_opaque", rgba(29, 32, 41, 255)),
                glass_edge: c("glass_edge", rgba(255, 255, 255, 0x1F)),
                glass_border: c("glass_border", rgba(255, 255, 255, 0x14)),
                glass_shade: c("glass_shade", rgba(0, 0, 0, 0x1A)),
                text: c("text", rgba(242, 244, 248, 0xEE)),
                text_secondary: c("text_secondary", rgba(242, 244, 248, 0xA0)),
                text_tertiary: c("text_tertiary", rgba(242, 244, 248, 0x66)),
                accent: c("accent", rgba(91, 140, 255, 255)),
                accent_text: c("accent_text", rgba(255, 255, 255, 255)),
                indicator: c("indicator", rgba(242, 244, 248, 0xCC)),
                icon_plate: c("icon_plate", rgba(255, 255, 255, 0x12)),
                separator: c("separator", rgba(255, 255, 255, 0x1C)),
                widget_tint: c("widget_tint", rgba(20, 22, 28, 0x8C)),
                widget_edge: c("widget_edge", rgba(255, 255, 255, 0x26)),
                shadow: c("shadow", rgba(0, 0, 0, 255)),
            }
        } else {
            Palette {
                glass_tint: c("glass_tint", rgba(244, 246, 250, 0x9E)),
                glass_opaque: c("glass_opaque", rgba(241, 243, 247, 255)),
                glass_edge: c("glass_edge", rgba(255, 255, 255, 0xB0)),
                glass_border: c("glass_border", rgba(0, 0, 0, 0x1A)),
                glass_shade: c("glass_shade", rgba(0, 0, 0, 0x0D)),
                text: c("text", rgba(27, 31, 40, 0xF2)),
                text_secondary: c("text_secondary", rgba(27, 31, 40, 0xA6)),
                text_tertiary: c("text_tertiary", rgba(27, 31, 40, 0x66)),
                accent: c("accent", rgba(47, 107, 255, 255)),
                accent_text: c("accent_text", rgba(255, 255, 255, 255)),
                indicator: c("indicator", rgba(27, 31, 40, 0xCC)),
                icon_plate: c("icon_plate", rgba(0, 0, 0, 0x0D)),
                separator: c("separator", rgba(0, 0, 0, 0x1A)),
                widget_tint: c("widget_tint", rgba(247, 248, 251, 0xA8)),
                widget_edge: c("widget_edge", rgba(255, 255, 255, 0xC0)),
                shadow: c("shadow", rgba(0, 0, 0, 255)),
            }
        }
    }
}

pub fn from_map(m: &HashMap<String, Value>) -> Theme {
    let r = Reader(m);
    Theme {
        family: r.str("type.family", "Segoe UI"),
        mono: r.str("type.mono", "Cascadia Mono"),
        icons: r.str("type.icons", "Segoe MDL2 Assets"),
        caption: r.num("type.caption", 11.0),
        label: r.num("type.label", 12.0),
        body: r.num("type.body", 13.0),
        title: r.num("type.title", 15.0),
        headline: r.num("type.headline", 20.0),
        display: r.num("type.display", 34.0),
        display_weight: r.num("type.display_weight", 300.0),
        clock_bar: r.num("type.clock_bar", 13.0),
        space: [
            r.num("space.xs", 4.0),
            r.num("space.sm", 8.0),
            r.num("space.md", 12.0),
            r.num("space.lg", 16.0),
            r.num("space.xl", 24.0),
            r.num("space.xxl", 32.0),
        ],
        r_sm: r.num("radius.sm", 6.0),
        r_md: r.num("radius.md", 10.0),
        r_lg: r.num("radius.lg", 16.0),
        r_dock: r.num("radius.dock", 22.0),
        r_widget: r.num("radius.widget", 18.0),
        r_icon: r.num("radius.icon", 11.0),
        el_rest: r.shadow("elevation.rest", 10.0, 2.0, 0.22),
        el_float: r.shadow("elevation.float", 28.0, 10.0, 0.38),
        el_lift: r.shadow("elevation.lift", 18.0, 6.0, 0.30),
        material: r.str("material.mode", "blur"),
        edge_px: r.num("material.edge", 1.0),
        border_px: r.num("material.border", 1.0),
        dark: r.palette("dark", true),
        light: r.palette("light", false),
        tap: r.spring("motion.tap", 140.0, 0.70),
        hover: r.spring("motion.hover", 240.0, 0.55),
        magnify: r.spring("motion.magnify", 300.0, 0.72),
        enter: r.spring("motion.enter", 520.0, 0.78),
        exit: r.spring("motion.exit", 200.0, 1.0),
        slide: r.spring("motion.slide", 320.0, 1.0),
        settle: r.spring("motion.settle", 700.0, 0.80),
        hover_lift: r.num("motion.hover_lift", 2.0),
        press_scale: r.num("motion.press_scale", 0.92),
        dock_icon: r.num("dock.icon", 46.0),
        dock_gap: r.num("dock.gap", 6.0),
        dock_pad_x: r.num("dock.pad_x", 10.0),
        dock_pad_y: r.num("dock.pad_y", 8.0),
        dock_bottom: r.num("dock.bottom", 8.0),
        magnify_max: r.num("dock.magnify_max", 1.42),
        magnify_sigma: r.num("dock.magnify_sigma", 1.25),
        magnify_rise: r.num("dock.magnify_rise", 14.0),
        tilt: r.num("dock.tilt", 8.0),
        indicator: r.num("dock.indicator", 4.0),
        dock_reserve: r.boolean("dock.reserve", true),
        topbar_height: r.num("topbar.height", 28.0),
        topbar_pad_x: r.num("topbar.pad_x", 14.0),
        topbar_item_gap: r.num("topbar.item_gap", 18.0),
        wallpaper: r.str("desktop.wallpaper", "auto"),
        photo: r.str("desktop.photo", ""),
        topbar_darken: r.num("topbar.darken", 0.22),
        dir: std::path::PathBuf::new(),
        widget_width: r.num("desktop.widget_width", 230.0),
        widget_margin: r.num("desktop.widget_margin", 24.0),
        widget_gap: r.num("desktop.widget_gap", 16.0),
        widget_blur: r.num("desktop.widget_blur", 28.0),
        vignette: r.num("desktop.vignette", 0.28),
    }
}

/// `theme/` next to the exe, else `shell/theme` relative to the workspace (dev runs).
pub fn dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let beside = exe.with_file_name("theme");
        if beside.join("theme.toml").is_file() {
            return beside;
        }
        // next/target/release/shell.exe -> next/shell/theme
        if let Some(root) = exe.ancestors().nth(3) {
            let dev = root.join("shell").join("theme");
            if dev.join("theme.toml").is_file() {
                return dev;
            }
        }
    }
    PathBuf::from("shell/theme")
}

/// The user's current Windows wallpaper path. READ ONLY: the shell never writes this
/// setting; we only render our own layer on top.
pub fn current_windows_wallpaper() -> String {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    unsafe {
        let mut buf = [0u16; 520];
        let mut size = (buf.len() * 2) as u32;
        let r = RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Control Panel\Desktop"),
            w!("WallPaper"),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        );
        if r.is_ok() {
            let n = (size as usize / 2).saturating_sub(1).min(buf.len());
            return String::from_utf16_lossy(&buf[..n]);
        }
    }
    String::new()
}

pub fn load_theme(dir: &Path) -> Theme {
    match std::fs::read_to_string(dir.join("theme.toml")) {
        Ok(text) => {
            let mut t = from_map(&parse(&text));
            t.dir = dir.to_path_buf();
            t
        }
        Err(e) => {
            println!("theme: {} not readable ({e}); using defaults", dir.join("theme.toml").display());
            let mut t = from_map(&HashMap::new());
            t.dir = dir.to_path_buf();
            t
        }
    }
}

fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Dock entries whose executable exists, in file order.
pub fn load_dock(dir: &Path) -> Vec<DockApp> {
    let Ok(text) = std::fs::read_to_string(dir.join("dock.toml")) else {
        println!("theme: dock.toml missing; dock will be empty");
        return Vec::new();
    };
    let m = parse(&text);
    let mut v = Vec::new();
    for i in 0.. {
        let Some(Value::Str(path)) = m.get(&format!("app.{i}.path")) else { break };
        let name = match m.get(&format!("app.{i}.name")) {
            Some(Value::Str(n)) => n.clone(),
            _ => format!("App {i}"),
        };
        let path = PathBuf::from(expand_env(path));
        if path.is_file() {
            v.push(DockApp { name, path });
        } else {
            println!("dock: skipping {name}: {} not found", path.display());
        }
    }
    v
}
