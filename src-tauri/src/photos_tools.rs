//! PHOTOS tools (src/os/apps/utilities/PhotosApp): picture details (EXIF) and the saved albums and favourites.
//!
//! EXIF is read by hand from a JPEG's APP1 segment (a TIFF structure inside): camera, lens, exposure, the date it
//! was taken and where. Nothing here decodes the picture, so it is instant, and anything unreadable is simply
//! left out rather than failing.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Exif {
  pub taken: Option<String>,
  pub make: Option<String>,
  pub model: Option<String>,
  pub lens: Option<String>,
  pub exposure: Option<String>,
  pub f_number: Option<f64>,
  pub iso: Option<u32>,
  pub focal_mm: Option<f64>,
  pub lat: Option<f64>,
  pub lon: Option<f64>,
}

struct Tiff<'a> {
  d: &'a [u8],
  le: bool,
}

impl<'a> Tiff<'a> {
  fn u16(&self, o: usize) -> Option<u16> {
    let b = self.d.get(o..o + 2)?;
    Some(if self.le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
  }
  fn u32(&self, o: usize) -> Option<u32> {
    let b = self.d.get(o..o + 4)?;
    Some(if self.le { u32::from_le_bytes([b[0], b[1], b[2], b[3]]) } else { u32::from_be_bytes([b[0], b[1], b[2], b[3]]) })
  }
  /// The entries of the IFD at `off`: (tag, type, count, position of the 4-byte value field).
  fn ifd(&self, off: usize) -> Vec<(u16, u16, u32, usize)> {
    let Some(n) = self.u16(off) else { return vec![] };
    (0..(n as usize).min(256))
      .filter_map(|i| {
        let e = off + 2 + i * 12;
        Some((self.u16(e)?, self.u16(e + 2)?, self.u32(e + 4)?, e + 8))
      })
      .collect()
  }
  /// Where an entry's data lives: inline in the value field when it fits in four bytes, else at the offset it holds.
  fn data_at(&self, ty: u16, count: u32, field: usize) -> Option<usize> {
    let size = match ty {
      1 | 2 | 7 => 1,
      3 => 2,
      4 | 9 => 4,
      5 | 10 => 8,
      _ => return None,
    } * count as usize;
    if size <= 4 {
      Some(field)
    } else {
      Some(self.u32(field)? as usize)
    }
  }
  fn ascii(&self, ty: u16, count: u32, field: usize) -> Option<String> {
    if ty != 2 {
      return None;
    }
    let at = self.data_at(ty, count, field)?;
    let b = self.d.get(at..at + count as usize)?;
    let s = String::from_utf8_lossy(b).trim_end_matches('\0').trim().to_string();
    (!s.is_empty()).then_some(s)
  }
  fn rational(&self, at: usize) -> Option<f64> {
    let (n, d) = (self.u32(at)? as f64, self.u32(at + 4)? as f64);
    (d != 0.0).then(|| n / d)
  }
  fn rationals(&self, ty: u16, count: u32, field: usize) -> Option<Vec<f64>> {
    if ty != 5 {
      return None;
    }
    let at = self.data_at(ty, count, field)?;
    (0..count as usize).map(|i| self.rational(at + i * 8)).collect()
  }
  fn short(&self, field: usize) -> Option<u32> {
    self.u16(field).map(|v| v as u32)
  }
}

fn dms(v: &[f64], reference: &str) -> Option<f64> {
  if v.len() != 3 {
    return None;
  }
  let deg = v[0] + v[1] / 60.0 + v[2] / 3600.0;
  Some(if reference.starts_with('S') || reference.starts_with('W') { -deg } else { deg })
}

fn shutter(t: f64) -> String {
  if t >= 1.0 {
    format!("{}s", (t * 10.0).round() / 10.0)
  } else {
    format!("1/{}s", (1.0 / t).round() as u32)
  }
}

/// Parses the EXIF of a JPEG file's bytes.
pub fn parse_exif(bytes: &[u8]) -> Option<Exif> {
  if bytes.get(0..2)? != [0xFF, 0xD8] {
    return None;
  }
  // Walk the segments until the one that starts with "Exif\0\0".
  let mut i = 2;
  let tiff_start = loop {
    if *bytes.get(i)? != 0xFF {
      return None;
    }
    let marker = *bytes.get(i + 1)?;
    if marker == 0xDA || marker == 0xD9 {
      return None; // picture data begins: no EXIF
    }
    let len = u16::from_be_bytes([*bytes.get(i + 2)?, *bytes.get(i + 3)?]) as usize;
    if marker == 0xE1 && bytes.get(i + 4..i + 10)? == b"Exif\0\0" {
      break i + 10;
    }
    i += 2 + len;
  };
  let d = &bytes[tiff_start..];
  let le = match d.get(0..2)? {
    b"II" => true,
    b"MM" => false,
    _ => return None,
  };
  let t = Tiff { d, le };
  let mut x = Exif::default();
  let (mut exif_ifd, mut gps_ifd) = (None, None);
  for (tag, ty, count, field) in t.ifd(t.u32(4)? as usize) {
    match tag {
      0x010F => x.make = t.ascii(ty, count, field),
      0x0110 => x.model = t.ascii(ty, count, field),
      0x8769 => exif_ifd = t.u32(field),
      0x8825 => gps_ifd = t.u32(field),
      _ => {}
    }
  }
  if let Some(off) = exif_ifd {
    for (tag, ty, count, field) in t.ifd(off as usize) {
      match tag {
        0x9003 => x.taken = t.ascii(ty, count, field),
        0xA434 => x.lens = t.ascii(ty, count, field),
        0x829A => x.exposure = t.rationals(ty, count, field).and_then(|v| v.first().copied()).filter(|v| *v > 0.0).map(shutter),
        0x829D => x.f_number = t.rationals(ty, count, field).and_then(|v| v.first().copied()),
        0x920A => x.focal_mm = t.rationals(ty, count, field).and_then(|v| v.first().copied()),
        0x8827 => x.iso = t.short(field),
        _ => {}
      }
    }
  }
  if let Some(off) = gps_ifd {
    let (mut lat_ref, mut lon_ref, mut lat, mut lon) = (String::new(), String::new(), None, None);
    for (tag, ty, count, field) in t.ifd(off as usize) {
      match tag {
        1 => lat_ref = t.ascii(ty, count, field).unwrap_or_default(),
        2 => lat = t.rationals(ty, count, field),
        3 => lon_ref = t.ascii(ty, count, field).unwrap_or_default(),
        4 => lon = t.rationals(ty, count, field),
        _ => {}
      }
    }
    x.lat = lat.and_then(|v| dms(&v, &lat_ref));
    x.lon = lon.and_then(|v| dms(&v, &lon_ref));
  }
  Some(x)
}

#[tauri::command]
pub async fn photos_exif(path: String) -> Result<Option<Exif>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    use std::io::Read;
    // The EXIF block sits in the first 64 KB of a JPEG; there is no need to read the whole file.
    let mut buf = Vec::new();
    std::fs::File::open(&path).map_err(|e| e.to_string())?.take(65_536 + 16).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(parse_exif(&buf))
  })
  .await
  .map_err(|e| e.to_string())?
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
  let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("photos");
  std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  Ok(d.join("state.json"))
}

/// Albums and favourites as JSON text the frontend owns (empty when nothing was saved).
#[tauri::command]
pub async fn photos_state_get(app: AppHandle) -> Result<String, String> {
  match std::fs::read_to_string(state_path(&app)?) {
    Ok(t) => Ok(t),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub async fn photos_state_set(app: AppHandle, json: String) -> Result<(), String> {
  serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("Not valid JSON: {e}"))?;
  let p = state_path(&app)?;
  let tmp = p.with_extension("tmp");
  std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
  std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Builds a little-endian JPEG with a real EXIF block: make, model, an Exif IFD (date, exposure, f-number, ISO, focal)
  /// and a GPS IFD (51°30'26" N, 0°7'39" W), laid out the way cameras write it.
  fn sample() -> Vec<u8> {
    let mut t: Vec<u8> = Vec::new();
    let w16 = |v: &mut Vec<u8>, x: u16| v.extend(x.to_le_bytes());
    let w32 = |v: &mut Vec<u8>, x: u32| v.extend(x.to_le_bytes());
    t.extend(b"II");
    w16(&mut t, 42);
    w32(&mut t, 8); // IFD0 at 8
    // IFD0: 4 entries -> 2 + 4*12 + 4 = 54 bytes, ends at 62
    w16(&mut t, 4);
    let entry = |v: &mut Vec<u8>, tag: u16, ty: u16, count: u32, val: u32| {
      v.extend(tag.to_le_bytes());
      v.extend(ty.to_le_bytes());
      v.extend(count.to_le_bytes());
      v.extend(val.to_le_bytes());
    };
    // data area starts at 62: "Canon\0"(6) -> 62..68, "EOS R\0"(6) -> 68..74
    entry(&mut t, 0x010F, 2, 6, 62);
    entry(&mut t, 0x0110, 2, 6, 68);
    entry(&mut t, 0x8769, 4, 1, 74); // Exif IFD at 74
    entry(&mut t, 0x8825, 4, 1, 74 + 2 + 5 * 12 + 4 + 20 + 8 + 8 + 8); // GPS IFD after exif data
    w32(&mut t, 0);
    t.extend(b"Canon\0");
    t.extend(b"EOS R\0");
    assert_eq!(t.len(), 74);
    // Exif IFD: 5 entries -> 2 + 60 + 4 = 66, ends at 140; data: date(20) 140..160, exposure(8) 160..168, fnum(8) 168..176, focal(8) 176..184
    w16(&mut t, 5);
    entry(&mut t, 0x9003, 2, 20, 140);
    entry(&mut t, 0x829A, 5, 1, 160);
    entry(&mut t, 0x829D, 5, 1, 168);
    entry(&mut t, 0x8827, 3, 1, 400);
    entry(&mut t, 0x920A, 5, 1, 176);
    w32(&mut t, 0);
    t.extend(b"2024:06:01 18:30:00\0");
    w32(&mut t, 1);
    w32(&mut t, 250); // 1/250
    w32(&mut t, 18);
    w32(&mut t, 10); // f/1.8
    w32(&mut t, 50);
    w32(&mut t, 1); // 50 mm
    assert_eq!(t.len(), 184);
    // GPS IFD at 184: 4 entries -> 2 + 48 + 4 = 54, ends at 238; lat rationals 238..262, lon 262..286
    w16(&mut t, 4);
    entry(&mut t, 1, 2, 2, u32::from_le_bytes([b'N', 0, 0, 0]));
    entry(&mut t, 2, 5, 3, 238);
    entry(&mut t, 3, 2, 2, u32::from_le_bytes([b'W', 0, 0, 0]));
    entry(&mut t, 4, 5, 3, 262);
    w32(&mut t, 0);
    for (n, d) in [(51, 1), (30, 1), (26, 1), (0, 1), (7, 1), (39, 1)] {
      w32(&mut t, n);
      w32(&mut t, d);
    }
    let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE1];
    let len = (2 + 6 + t.len()) as u16;
    jpeg.extend(len.to_be_bytes());
    jpeg.extend(b"Exif\0\0");
    jpeg.extend(&t);
    jpeg.extend([0xFF, 0xDA, 0, 0]);
    jpeg
  }

  #[test]
  fn reads_a_real_exif_block() {
    let x = parse_exif(&sample()).expect("exif");
    assert_eq!(x.make.as_deref(), Some("Canon"));
    assert_eq!(x.model.as_deref(), Some("EOS R"));
    assert_eq!(x.taken.as_deref(), Some("2024:06:01 18:30:00"));
    assert_eq!(x.exposure.as_deref(), Some("1/250s"));
    assert_eq!(x.f_number, Some(1.8));
    assert_eq!(x.iso, Some(400));
    assert_eq!(x.focal_mm, Some(50.0));
    let (lat, lon) = (x.lat.unwrap(), x.lon.unwrap());
    assert!((lat - 51.507222).abs() < 1e-4, "lat {lat}");
    assert!((lon - -0.1275).abs() < 1e-4, "lon {lon}");
  }

  #[test]
  fn leaves_non_exif_files_alone() {
    assert_eq!(parse_exif(b"\x89PNG\r\n\x1a\n"), None);
    assert_eq!(parse_exif(&[0xFF, 0xD8, 0xFF, 0xDA, 0, 0]), None);
    assert_eq!(parse_exif(&[]), None);
    // A truncated block must not panic.
    let mut s = sample();
    s.truncate(40);
    let _ = parse_exif(&s);
  }
}
