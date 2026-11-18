//! Browse a .zip like a folder, read one entry for Quick Look, extract some or all.

use super::{stat, Entry};
use serde::Serialize;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
  /// Path inside the archive with forward slashes and no trailing slash.
  pub path: String,
  pub is_dir: bool,
  pub size: u64,
  pub packed: u64,
  pub modified_ms: i64,
}

fn open(path: &str) -> Result<zip::ZipArchive<std::fs::File>, String> {
  let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
  zip::ZipArchive::new(f).map_err(|e| format!("This is not a readable zip archive ({e})."))
}

fn zip_ms(dt: Option<zip::DateTime>) -> i64 {
  let Some(d) = dt else { return 0 };
  // Days from civil (Howard Hinnant), good for any zip date.
  let (y, m, day) = (d.year() as i64, d.month() as i64, d.day() as i64);
  let y2 = if m <= 2 { y - 1 } else { y };
  let era = y2.div_euclid(400);
  let yoe = y2 - era * 400;
  let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
  let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  let days = era * 146097 + doe - 719468;
  ((days * 86400) + d.hour() as i64 * 3600 + d.minute() as i64 * 60 + d.second() as i64) * 1000
}

/// Every entry, flat. Folders that only exist implicitly (a/b/c.txt with no a/ entry) are added.
#[tauri::command]
pub async fn files_archive_list(path: String) -> Result<Vec<ArchiveEntry>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut z = open(&path)?;
    let mut out = Vec::with_capacity(z.len());
    let mut dirs = std::collections::HashSet::new();
    for i in 0..z.len() {
      let Ok(e) = z.by_index_raw(i) else { continue };
      let name = e.name().replace('\\', "/");
      let is_dir = e.is_dir();
      let clean = name.trim_end_matches('/').to_string();
      if clean.is_empty() {
        continue;
      }
      let parts: Vec<&str> = clean.split('/').collect();
      for k in 1..parts.len() {
        dirs.insert(parts[..k].join("/"));
      }
      if is_dir {
        dirs.insert(clean.clone());
        continue;
      }
      out.push(ArchiveEntry { path: clean, is_dir: false, size: e.size(), packed: e.compressed_size(), modified_ms: zip_ms(e.last_modified()) });
    }
    for d in dirs {
      out.push(ArchiveEntry { path: d, is_dir: true, size: 0, packed: 0, modified_ms: 0 });
    }
    Ok(out)
  })
  .await
  .map_err(|e| e.to_string())?
}

/// The first `max` bytes of one entry, for previews.
#[tauri::command]
pub async fn files_archive_read(path: String, inner: String, max: usize) -> Result<Vec<u8>, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let mut z = open(&path)?;
    let mut e = z.by_name(&inner).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    (&mut e).take(max.min(32 * 1024 * 1024) as u64).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
  })
  .await
  .map_err(|e| e.to_string())?
}

fn safe_rel(name: &str) -> Option<PathBuf> {
  let p = Path::new(name);
  let mut out = PathBuf::new();
  for c in p.components() {
    match c {
      Component::Normal(s) => out.push(s),
      Component::CurDir => {}
      _ => return None, // absolute, drive prefix, or `..`: zip slip
    }
  }
  (!out.as_os_str().is_empty()).then_some(out)
}

/// Extracts the archive, or only `inner` entries (and everything under any
/// folder named), into `dest`. With no `dest` it makes a new folder named
/// after the archive next to it. Returns that folder.
#[tauri::command]
pub async fn files_archive_extract(path: String, inner: Option<Vec<String>>, dest: Option<String>) -> Result<Entry, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let src = Path::new(&path);
    let out = match dest {
      Some(d) => PathBuf::from(d),
      None => {
        let dir = src.parent().ok_or("The archive has no folder.")?;
        let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Extracted".into());
        let mut c = dir.join(&stem);
        let mut n = 2;
        while c.exists() {
          c = dir.join(format!("{stem} ({n})"));
          n += 1;
        }
        c
      }
    };
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let mut z = open(&path)?;
    // When extracting a picked subset, strip the picked items' common parent so
    // "docs/a.txt" lands as "a.txt", like dragging it out of a folder.
    let strip: Option<String> = inner.as_ref().and_then(|list| {
      let first = list.first()?;
      let parent = first.rsplit_once('/').map(|(p, _)| format!("{p}/")).unwrap_or_default();
      list.iter().all(|x| x.starts_with(&parent)).then_some(parent)
    });
    for i in 0..z.len() {
      let mut e = z.by_index(i).map_err(|e| e.to_string())?;
      let name = e.name().replace('\\', "/");
      if let Some(list) = &inner {
        let hit = list.iter().any(|w| name == *w || name.trim_end_matches('/') == w || name.starts_with(&format!("{w}/")));
        if !hit {
          continue;
        }
      }
      let rel_name = match &strip {
        Some(s) if name.starts_with(s.as_str()) => name[s.len()..].to_string(),
        _ => name.clone(),
      };
      let Some(rel) = safe_rel(&rel_name) else { continue };
      let target = out.join(rel);
      if e.is_dir() {
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
      } else {
        if let Some(p) = target.parent() {
          std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut f = std::fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        std::io::copy(&mut e, &mut f).map_err(|e| e.to_string())?;
      }
    }
    stat(&out).ok_or_else(|| "Could not read the extracted folder.".into())
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Packs items into a new .zip in `dest_dir`.
#[tauri::command]
pub async fn files_compress(paths: Vec<String>, dest_dir: String, name: Option<String>) -> Result<Entry, String> {
  tauri::async_runtime::spawn_blocking(move || {
    if paths.is_empty() {
      return Err("Nothing to compress.".into());
    }
    let dir = Path::new(&dest_dir);
    let stem = name.unwrap_or_else(|| {
      if paths.len() == 1 {
        Path::new(&paths[0]).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Archive".into())
      } else {
        "Archive".into()
      }
    });
    let mut out = dir.join(format!("{stem}.zip"));
    let mut n = 2;
    while out.exists() {
      out = dir.join(format!("{stem} ({n}).zip"));
      n += 1;
    }
    let file = std::fs::File::create(&out).map_err(|e| e.to_string())?;
    let mut zw = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    fn add(zw: &mut zip::ZipWriter<std::fs::File>, p: &Path, name: &str, o: zip::write::SimpleFileOptions) -> Result<(), String> {
      if p.is_dir() {
        zw.add_directory(format!("{name}/"), o).map_err(|e| e.to_string())?;
        for e in std::fs::read_dir(p).map_err(|e| e.to_string())?.flatten() {
          add(zw, &e.path(), &format!("{name}/{}", e.file_name().to_string_lossy()), o)?;
        }
      } else {
        zw.start_file(name, o).map_err(|e| e.to_string())?;
        let mut f = std::fs::File::open(p).map_err(|e| format!("{}: {e}", p.display()))?;
        std::io::copy(&mut f, zw).map_err(|e| e.to_string())?;
      }
      Ok(())
    }
    let result = (|| {
      for p in &paths {
        let pp = Path::new(p);
        let name = pp.file_name().ok_or_else(|| format!("Invalid path: {p}"))?.to_string_lossy().into_owned();
        add(&mut zw, pp, &name, opts)?;
      }
      zw.finish().map_err(|e| e.to_string())?;
      Ok::<(), String>(())
    })();
    if let Err(e) = result {
      let _ = std::fs::remove_file(&out);
      return Err(e);
    }
    stat(&out).ok_or_else(|| "Could not read the new archive.".into())
  })
  .await
  .map_err(|e| e.to_string())?
}
