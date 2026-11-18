//! HEALTH CHECK for the mod switcher. Strictly read-only: it lists, reads and stats, and never creates, renames
//! or deletes anything, so running it can never change the state of the game install.
//!
//! It answers the questions that explain nearly every "the mod didn't load" report: is the game found, can links
//! be made, is there room, are the mod folders real, which mod is actually active right now (found from the
//! links themselves, not from a remembered flag), and are any links broken or files left set aside.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::AppHandle;

use super::{collect_files_recursive, is_symlink, manifest_path, precondition, resolve_game_root, SwitchManifest, GLM_FOLDER};

#[derive(Serialize)]
pub struct Check {
  pub id: String,
  pub title: String,
  /// "ok", "warn" or "fail".
  pub status: &'static str,
  pub detail: String,
}

#[derive(Serialize)]
pub struct Health {
  pub checks: Vec<Check>,
  /// The mod whose files are linked into the game right now, found from the links themselves.
  pub active_mod: Option<String>,
}

fn check(id: &str, title: &str, status: &'static str, detail: impl Into<String>) -> Check {
  Check { id: id.into(), title: title.into(), status, detail: detail.into() }
}

fn gb(bytes: u64) -> String {
  format!("{:.1} GB", bytes as f64 / 1_073_741_824.0)
}

/// The mod a link points into, from a path like `...\GLM\<Name>\<Version>\file`.
fn mod_of(target: &Path) -> Option<String> {
  let parts: Vec<String> = target.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
  let i = parts.iter().position(|p| p.eq_ignore_ascii_case(GLM_FOLDER))?;
  parts.get(i + 1).cloned()
}

#[tauri::command(async)]
pub fn cnc_health_check(app: AppHandle) -> Health {
  let mut checks = Vec::new();
  let root = match resolve_game_root(&app) {
    Ok(r) => r,
    Err(e) => {
      checks.push(check("game", "Game install", "fail", e));
      return Health { checks, active_mod: None };
    }
  };
  checks.push(check("game", "Game install", "ok", format!("Found at {}", root.display())));

  // The game itself.
  let names: Vec<String> = fs::read_dir(&root).map(|rd| rd.flatten().map(|e| e.file_name().to_string_lossy().to_lowercase()).collect()).unwrap_or_default();
  if names.iter().any(|n| n == "generals.exe") {
    checks.push(check("exe", "Game program", "ok", "Generals.exe is present."));
  } else if names.iter().any(|n| n == "modded.exe") {
    checks.push(check("exe", "Game program", "warn", "Only modded.exe was found. Generals.exe is missing, so launching falls back to it."));
  } else {
    checks.push(check("exe", "Game program", "fail", "Neither Generals.exe nor modded.exe is in the game folder."));
  }

  // Permission to make links.
  let pre = precondition::check();
  if pre.can_create_symlinks {
    checks.push(check("links", "Permission to switch mods", "ok", if pre.is_admin { "Running as administrator." } else { "Developer Mode is on." }));
  } else {
    checks.push(check("links", "Permission to switch mods", "warn", "Windows won't allow links right now. Turn on Developer Mode (Settings, Privacy & security, For developers) or run Udaan as administrator."));
  }

  // Room on the drive.
  let disks = sysinfo::Disks::new_with_refreshed_list();
  let rootl = root.to_string_lossy().to_lowercase();
  if let Some(d) = disks.iter().filter(|d| rootl.starts_with(&d.mount_point().to_string_lossy().to_lowercase())).max_by_key(|d| d.mount_point().as_os_str().len()) {
    let free = d.available_space();
    let (s, msg) = if free < 1_073_741_824 { ("fail", "Almost no space is left. Mods and saved games may fail to write.") } else if free < 5 * 1_073_741_824 { ("warn", "Space is getting low.") } else { ("ok", "Plenty of room.") };
    checks.push(check("space", "Free space on the game drive", s, format!("{} free. {msg}", gb(free))));
  }

  // Each mod's folder.
  let glm = root.join(GLM_FOLDER);
  if !glm.is_dir() {
    checks.push(check("glm", "Mod library", "warn", "There is no GLM folder, so no mods are installed."));
  } else {
    let mut seen = 0;
    if let Ok(mods) = fs::read_dir(&glm) {
      for m in mods.flatten().filter(|m| m.path().is_dir()) {
        let name = m.file_name().to_string_lossy().into_owned();
        let Ok(versions) = fs::read_dir(m.path()) else { continue };
        for v in versions.flatten().filter(|v| v.path().is_dir()) {
          if seen >= 40 {
            break;
          }
          seen += 1;
          let ver = v.file_name().to_string_lossy().into_owned();
          let mut files = Vec::new();
          let ok = collect_files_recursive(&v.path(), &mut files).is_ok();
          let bytes: u64 = files.iter().filter_map(|f| fs::metadata(f).ok()).map(|m| m.len()).sum();
          let id = format!("mod:{name}:{ver}");
          let title = format!("{name} ({ver})");
          if !ok {
            checks.push(check(&id, &title, "warn", "Some of its folders could not be read."));
          } else if files.is_empty() {
            checks.push(check(&id, &title, "fail", "The folder is empty, so this mod would do nothing. Reinstall it."));
          } else {
            checks.push(check(&id, &title, "ok", format!("{} files, {}.", files.len(), gb(bytes))));
          }
        }
      }
    }
    if seen == 0 {
      checks.push(check("glm", "Mod library", "warn", "The GLM folder has no mods in it."));
    }
  }

  // Which mod is really active: look at the links themselves (the top level and one folder down).
  let deadline = Instant::now() + Duration::from_secs(3);
  let (mut by_mod, mut broken, mut left_aside, mut scanned) = (BTreeMap::<String, usize>::new(), 0usize, 0usize, 0usize);
  let mut visit = |dir: &Path, depth: u8, stack: &mut Vec<(std::path::PathBuf, u8)>| -> usize {
    let mut seen = 0usize;
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    for e in rd.flatten() {
      seen += 1;
      let p = e.path();
      if e.file_name().to_string_lossy().to_uppercase().ends_with(".GLR") {
        left_aside += 1;
      }
      if is_symlink(&p) {
        match fs::read_link(&p) {
          Ok(t) => {
            if !t.exists() {
              broken += 1;
            }
            if let Some(m) = mod_of(&t) {
              *by_mod.entry(m).or_default() += 1;
            }
          }
          Err(_) => broken += 1,
        }
      } else if depth < 1 && p.is_dir() && p.file_name().map(|n| !n.to_string_lossy().eq_ignore_ascii_case(GLM_FOLDER)).unwrap_or(false) {
        stack.push((p, depth + 1));
      }
    }
    seen
  };
  let mut stack = vec![(root.clone(), 0u8)];
  while let Some((dir, depth)) = stack.pop() {
    if Instant::now() > deadline || scanned > 30_000 {
      break;
    }
    scanned += visit(&dir, depth, &mut stack);
  }
  let active_mod = match by_mod.len() {
    0 => None,
    1 => by_mod.keys().next().cloned(),
    _ => by_mod.iter().max_by_key(|(_, n)| **n).map(|(k, _)| k.clone()),
  };
  match by_mod.len() {
    0 => checks.push(check("active", "Active mod", "ok", "None. The game is running unmodded.")),
    1 => checks.push(check("active", "Active mod", "ok", format!("{} ({} files linked in).", active_mod.clone().unwrap_or_default(), by_mod.values().sum::<usize>()))),
    _ => checks.push(check("active", "Active mod", "warn", format!("Files from more than one mod are linked in ({}). Switch to one mod, or restore the last backup, to clear it.", by_mod.iter().map(|(k, n)| format!("{k}: {n}")).collect::<Vec<_>>().join(", ")))),
  }
  if broken > 0 {
    checks.push(check("broken", "Broken links", "warn", format!("{broken} link{} point at files that no longer exist. Restoring the last backup clears them.", if broken == 1 { "" } else { "s" })));
  } else {
    checks.push(check("broken", "Broken links", "ok", "None."));
  }
  if left_aside > 0 {
    let s = if by_mod.is_empty() { "warn" } else { "ok" };
    let why = if by_mod.is_empty() { "No mod is active, so these were left from an earlier switch. Restoring the last backup puts them back." } else { "These are the original files, set aside while the mod is active." };
    checks.push(check("glr", "Original files set aside", s, format!("{left_aside} file{} (.GLR). {why}", if left_aside == 1 { "" } else { "s" })));
  }

  // The restore point.
  match manifest_path(&app).ok().and_then(|p| fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str::<SwitchManifest>(&t).ok()) {
    Some(m) => checks.push(check("backup", "Restore point", "ok", format!("From the switch to {} ({}).", m.mod_name, m.timestamp.chars().take(16).collect::<String>().replace('T', " ")))),
    None => checks.push(check("backup", "Restore point", "ok", "None yet. One is made automatically the first time you switch.")),
  }

  Health { checks, active_mod }
}
