//! Udaan-native mod switcher for C&C Generals Zero Hour, built on the real
//! mechanism confirmed by decompiling Gen Launcher (GenLauncherNet):
//! `SymbolicLinkHandler.CreateMirrorsFromFolder` walks a mod's
//! `GLM\<ModName>\<Version>\` folder and creates a real Windows symlink at
//! each corresponding top-level game-root path, renaming any pre-existing
//! real file at that target to `.GLR` first (never deleting outright).
//!
//! This module replicates that exact convention (including the `.GLR`
//! suffix) so switching mods through Udaan and switching them through Gen
//! Launcher never produce conflicting or confusing on-disk state.
//!
//! Backup/restore here means tracking which top-level paths were symlinks,
//! real files, or absent before a switch — never duplicating the
//! multi-gigabyte mod archives themselves, which is exactly why this is
//! cheap. See `SwitchManifest`.

pub mod health;
mod precondition;
mod volume;

use std::fs;
use std::os::windows::fs::symlink_file;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub use precondition::SymlinkPrecondition;
use volume::VolumeIdentity;

const GLR_SUFFIX: &str = ".GLR";
const GLM_FOLDER: &str = "GLM";
const SETTINGS_FILE: &str = "cnc_mod_switcher.json";
const MANIFEST_FILE: &str = "cnc_mod_switcher_last_backup.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSettings {
  volume: VolumeIdentity,
}

/// What a single top-level path looked like immediately before a switch —
/// enough to put it back exactly as it was.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
enum PathState {
  /// Nothing existed at this path before the switch.
  Absent,
  /// A real (non-symlink) file existed here — switching renamed it to
  /// `<name>.GLR`; restoring renames it back.
  RealFile,
  /// A symlink already existed here (e.g. from a previous switch, Udaan's
  /// or Gen Launcher's own) — restoring removes whatever symlink is there
  /// now and does not attempt to recreate the old one, since a symlink is
  /// just a pointer, not data that needs preserving.
  Symlink,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestEntry {
  /// Path relative to the game root, e.g. "!ZHE8Windows_99.big".
  relative_path: String,
  before: PathState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchManifest {
  mod_name: String,
  version: String,
  timestamp: String,
  entries: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstalledMod {
  pub name: String,
  pub version: String,
  pub file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct GameStatus {
  pub drive_connected: bool,
  pub game_root: Option<String>,
  pub precondition: SymlinkPrecondition,
  pub installed_mods: Vec<InstalledMod>,
  pub has_backup: bool,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  Ok(dir.join(SETTINGS_FILE))
}

fn manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  Ok(dir.join(MANIFEST_FILE))
}

fn load_settings(app: &AppHandle) -> Option<StoredSettings> {
  let path = settings_path(app).ok()?;
  let data = fs::read_to_string(path).ok()?;
  serde_json::from_str(&data).ok()
}

fn save_settings(app: &AppHandle, settings: &StoredSettings) -> Result<(), String> {
  let path = settings_path(app)?;
  let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
  fs::write(path, data).map_err(|e| format!("Failed to save drive identity: {e}"))
}

/// Resolves the game root, identifying and persisting the drive's volume
/// identity on first use if not already stored.
fn resolve_game_root(app: &AppHandle) -> Result<PathBuf, String> {
  if let Some(settings) = load_settings(app) {
    if let Some(root) = volume::find_game_root(&settings.volume) {
      return Ok(root);
    }
    return Err(
      "The drive this game install was last found on isn't connected. Plug it in and try again."
        .to_string(),
    );
  }
  let (identity, root) = volume::identify_drive().ok_or_else(|| {
    "Could not find a \"Command and Conquer Generals Zero Hour\" install on any connected drive.".to_string()
  })?;
  save_settings(app, &StoredSettings { volume: identity })?;
  Ok(root)
}

fn glm_dir(game_root: &Path, mod_name: &str, version: &str) -> PathBuf {
  game_root.join(GLM_FOLDER).join(mod_name).join(version)
}

/// Extensions Gen Launcher never symlinks (`GameLauncher.exceptExtensions`
/// in the decompiled source) — executables/DLLs are left as whatever the
/// mod's installer already placed at the top level, never mirrored.
fn is_excluded_extension(path: &Path) -> bool {
  matches!(
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
    Some("exe") | Some("dll")
  )
}

/// Gen Launcher reads the file's own magic bytes to decide this — a mod's
/// "BIG" archive payload is shipped under a `.gib` (or other non-`.big`)
/// extension in the GLM folder, but the game engine only ever loads
/// `.big` files, so the symlink target's extension has to be coerced to
/// `.big` for anything whose content is actually a BIG archive. Getting
/// this wrong (symlinking `foo.gib` -> `foo.gib` instead of `foo.big`) is
/// exactly the bug where a switch "succeeds" (real symlinks staged) but
/// the game never picks up the mod, because it never sees a `.big` file
/// at all — it just still finds the original vanilla archive alongside an
/// inert `.gib` symlink.
fn is_big_archive(path: &Path) -> bool {
  let Ok(mut f) = fs::File::open(path) else { return false };
  use std::io::Read;
  let mut magic = [0u8; 4];
  if f.read_exact(&mut magic).is_err() {
    return false;
  }
  matches!(&magic, b"BIGF" | b"BIGH" | b"BIG4")
}

/// "Genuinely installed" means real files exist in the mod's own GLM
/// folder — never trust a config flag alone (the source recon found
/// mods marked `Installed: true` in Gen Launcher's own YAML with zero
/// files actually on disk).
fn mod_files(game_root: &Path, mod_name: &str, version: &str) -> Result<Vec<PathBuf>, String> {
  let dir = glm_dir(game_root, mod_name, version);
  if !dir.is_dir() {
    return Err(format!("\"{mod_name}\" ({version}) is not installed — no folder found at {}", dir.display()));
  }
  let mut all_files = Vec::new();
  collect_files_recursive(&dir, &mut all_files)?;
  // Matches Gen Launcher's own CreateMirrorsFromFolder: .exe/.dll are
  // never symlinked, and anything with ".GOF" in its path is skipped
  // outright (a Gen Launcher-internal temp/original-file marker).
  let files: Vec<PathBuf> = all_files
    .into_iter()
    .filter(|f| !is_excluded_extension(f))
    .filter(|f| !f.to_string_lossy().contains(".GOF"))
    .collect();
  if files.is_empty() {
    return Err(format!("\"{mod_name}\" ({version}) folder exists but contains no files."));
  }
  Ok(files)
}

fn collect_files_recursive(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
  for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {e}", dir.display()))? {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    if path.is_dir() {
      collect_files_recursive(&path, out)?;
    } else {
      out.push(path);
    }
  }
  Ok(())
}

/// Lists installed mods by real file presence — starts with the two named
/// mods, since those are the ones this first version targets, but the
/// design generalizes to any `GLM\<Name>\<Version>\` folder with real files.
fn list_installed_mods(game_root: &Path) -> Vec<InstalledMod> {
  let candidates: &[(&str, &str)] =
    &[("Zero Hour Enhanced", "1.0.0a GenLauncherFix 1"), ("Cold War Crisis", "1.5")];
  candidates
    .iter()
    .filter_map(|(name, version)| {
      let dir = glm_dir(game_root, name, version);
      let mut files = Vec::new();
      if dir.is_dir() && collect_files_recursive(&dir, &mut files).is_ok() && !files.is_empty() {
        Some(InstalledMod { name: name.to_string(), version: version.to_string(), file_count: files.len() })
      } else {
        None
      }
    })
    .collect()
}

/// Maps a source file inside the mod's GLM folder to the real top-level
/// path the game engine will actually load it from. For anything whose
/// content is a BIG archive, that means forcing the extension to `.big`
/// regardless of the source's own extension (see `is_big_archive`) — this
/// is what makes the mod's archives actually override the vanilla ones
/// instead of sitting inert under their original `.gib` name.
fn relative_top_level_path(game_root: &Path, source_file: &Path, mod_dir: &Path) -> Result<PathBuf, String> {
  let relative = source_file
    .strip_prefix(mod_dir)
    .map_err(|_| format!("File {} is not inside {}", source_file.display(), mod_dir.display()))?;
  let target = game_root.join(relative);
  if is_big_archive(source_file) {
    Ok(target.with_extension("big"))
  } else {
    Ok(target)
  }
}

fn is_symlink(path: &Path) -> bool {
  fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

#[tauri::command(async)]
pub fn cnc_check_precondition() -> SymlinkPrecondition {
  precondition::check()
}

#[tauri::command(async)]
pub fn cnc_get_status(app: AppHandle) -> GameStatus {
  let precondition = precondition::check();
  match resolve_game_root(&app) {
    Ok(root) => {
      let has_backup = manifest_path(&app).map(|p| p.exists()).unwrap_or(false);
      GameStatus {
        drive_connected: true,
        game_root: Some(root.to_string_lossy().to_string()),
        installed_mods: list_installed_mods(&root),
        precondition,
        has_backup,
      }
    }
    Err(_) => GameStatus {
      drive_connected: false,
      game_root: None,
      installed_mods: Vec::new(),
      precondition,
      has_backup: false,
    },
  }
}

/// Records the current top-level state (before touching anything) for
/// every path a switch is about to affect, and returns it as this
/// operation's restore point.
fn record_manifest(game_root: &Path, mod_name: &str, version: &str, mod_files: &[PathBuf]) -> Result<SwitchManifest, String> {
  let mod_dir = glm_dir(game_root, mod_name, version);
  let mut entries = Vec::with_capacity(mod_files.len());
  for source_file in mod_files {
    let target = relative_top_level_path(game_root, source_file, &mod_dir)?;
    let relative_path = target.strip_prefix(game_root).unwrap_or(&target).to_string_lossy().to_string();
    let before = if !target.exists() && !is_symlink(&target) {
      PathState::Absent
    } else if is_symlink(&target) {
      PathState::Symlink
    } else {
      PathState::RealFile
    };
    entries.push(ManifestEntry { relative_path, before });
  }
  Ok(SwitchManifest {
    mod_name: mod_name.to_string(),
    version: version.to_string(),
    timestamp: chrono::Utc::now().to_rfc3339(),
    entries,
  })
}

/// Mirrors `SymbolicLinkHandler.CreateMirrorsFromFolder`'s own convention
/// exactly: a real file at the target is renamed to `.GLR` (never
/// deleted); an existing symlink is removed outright (it's just a
/// pointer); then a fresh symlink to the mod's real file is created.
fn stage_symlink(source_file: &Path, target: &Path) -> Result<(), String> {
  if let Some(parent) = target.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
  }
  if is_symlink(target) {
    fs::remove_file(target).map_err(|e| format!("Failed to remove existing symlink at {}: {e}", target.display()))?;
  } else if target.exists() {
    let glr_path = PathBuf::from(format!("{}{GLR_SUFFIX}", target.display()));
    if glr_path.exists() {
      fs::remove_file(&glr_path).map_err(|e| format!("Failed to remove stale {}: {e}", glr_path.display()))?;
    }
    fs::rename(target, &glr_path)
      .map_err(|e| format!("Failed to rename {} to {}: {e}", target.display(), glr_path.display()))?;
  }
  symlink_file(source_file, target)
    .map_err(|e| format!("Failed to create symlink at {} -> {}: {e}", target.display(), source_file.display()))
}

#[tauri::command(async)]
pub fn cnc_switch_mod(app: AppHandle, mod_name: String, version: String) -> Result<(), String> {
  let precondition = precondition::check();
  if !precondition.can_create_symlinks {
    return Err(
      "Windows won't allow creating symlinks right now. Enable Developer Mode (Settings > Privacy & Security > For Developers) or run Udaan as Administrator, then try again.".to_string(),
    );
  }

  let game_root = resolve_game_root(&app)?;
  let files = mod_files(&game_root, &mod_name, &version)?;

  let manifest = record_manifest(&game_root, &mod_name, &version, &files)?;
  let manifest_path = manifest_path(&app)?;
  let manifest_json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
  fs::write(&manifest_path, manifest_json).map_err(|e| format!("Failed to save backup manifest: {e}"))?;

  let mod_dir = glm_dir(&game_root, &mod_name, &version);
  for source_file in &files {
    let target = relative_top_level_path(&game_root, source_file, &mod_dir)?;
    stage_symlink(source_file, &target)?;
  }

  Ok(())
}

#[tauri::command(async)]
pub fn cnc_launch_game(app: AppHandle) -> Result<(), String> {
  let game_root = resolve_game_root(&app)?;
  let modded_exe = game_root.join("modded.exe");
  let generals_exe = game_root.join("Generals.exe");
  let exe = if modded_exe.exists() { modded_exe } else { generals_exe };
  if !exe.exists() {
    return Err(format!("No game executable found in {}", game_root.display()));
  }
  std::process::Command::new(&exe)
    .current_dir(&game_root)
    .arg("-win")
    .spawn()
    .map_err(|e| format!("Failed to launch {}: {e}", exe.display()))?;
  Ok(())
}

#[tauri::command(async)]
pub fn cnc_restore_backup(app: AppHandle) -> Result<(), String> {
  let manifest_path = manifest_path(&app)?;
  let data = fs::read_to_string(&manifest_path).map_err(|_| "No backup found to restore.".to_string())?;
  let manifest: SwitchManifest = serde_json::from_str(&data).map_err(|e| format!("Backup file is corrupt: {e}"))?;

  let game_root = resolve_game_root(&app)?;

  for entry in &manifest.entries {
    let target = game_root.join(&entry.relative_path);
    match entry.before {
      PathState::Symlink | PathState::Absent => {
        if is_symlink(&target) {
          fs::remove_file(&target)
            .map_err(|e| format!("Failed to remove symlink at {}: {e}", target.display()))?;
        }
      }
      PathState::RealFile => {
        if is_symlink(&target) {
          fs::remove_file(&target)
            .map_err(|e| format!("Failed to remove symlink at {}: {e}", target.display()))?;
        }
        let glr_path = PathBuf::from(format!("{}{GLR_SUFFIX}", target.display()));
        if glr_path.exists() {
          fs::rename(&glr_path, &target)
            .map_err(|e| format!("Failed to restore {} from {}: {e}", target.display(), glr_path.display()))?;
        }
      }
    }
  }

  fs::remove_file(&manifest_path).map_err(|e| format!("Failed to clear backup record: {e}"))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::env;

  struct TempDir {
    path: PathBuf,
  }

  impl TempDir {
    fn new() -> Self {
      let mut path = env::temp_dir();
      path.push(format!("udaan_cnc_switcher_test_{}", uuid::Uuid::new_v4()));
      fs::create_dir_all(&path).unwrap();
      Self { path }
    }
  }

  impl Drop for TempDir {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.path);
    }
  }

  /// Builds a fake game_root + GLM/<mod>/<version>/ with a couple of files,
  /// to exercise stage_symlink/record_manifest/restore logic without
  /// touching a real game install. Symlink creation itself is skipped in
  /// CI-style environments without Developer Mode/admin — these tests
  /// report that clearly rather than failing confusingly.
  fn setup_fake_mod(root: &Path, mod_name: &str, version: &str, files: &[(&str, &str)]) -> PathBuf {
    let mod_dir = root.join(GLM_FOLDER).join(mod_name).join(version);
    fs::create_dir_all(&mod_dir).unwrap();
    for (name, content) in files {
      fs::write(mod_dir.join(name), content).unwrap();
    }
    mod_dir
  }

  #[test]
  fn mod_files_rejects_missing_folder() {
    let tmp = TempDir::new();
    let err = mod_files(&tmp.path, "Nonexistent Mod", "1.0").unwrap_err();
    assert!(err.contains("not installed"));
  }

  #[test]
  fn mod_files_rejects_empty_folder() {
    let tmp = TempDir::new();
    fs::create_dir_all(tmp.path.join(GLM_FOLDER).join("Empty Mod").join("1.0")).unwrap();
    let err = mod_files(&tmp.path, "Empty Mod", "1.0").unwrap_err();
    assert!(err.contains("no files"));
  }

  #[test]
  fn mod_files_finds_real_files() {
    let tmp = TempDir::new();
    setup_fake_mod(&tmp.path, "Test Mod", "1.0", &[("a.gib", "data"), ("b.gib", "data")]);
    let files = mod_files(&tmp.path, "Test Mod", "1.0").unwrap();
    assert_eq!(files.len(), 2);
  }

  /// Regression test for the exact bug that shipped in the first version:
  /// a mod's real BIG archive payload is shipped under a `.gib` extension
  /// in the GLM folder, but the game engine only ever loads `.big` files
  /// — a switch that symlinked `.gib` -> `.gib` "succeeded" (a real
  /// symlink existed) while the game silently kept loading the vanilla
  /// archive, since it never saw a `.big` file at all. Gen Launcher's own
  /// SymbolicLinkHandler.CreateMirrorForBig detects this by content (the
  /// `BIGF` magic), not extension, and always coerces the target to
  /// `.big` — this test locks that behavior in.
  #[test]
  fn big_archive_source_coerces_target_extension_to_big() {
    let tmp = TempDir::new();
    let mut bigf_bytes = b"BIGF".to_vec();
    bigf_bytes.extend_from_slice(&[0u8; 12]);
    let mod_dir = setup_fake_mod(&tmp.path, "Test Mod", "1.0", &[]);
    fs::write(mod_dir.join("!TME8Windows_99.gib"), &bigf_bytes).unwrap();
    // A non-archive file (e.g. a .ini) should NOT get its extension
    // coerced — only real BIG-archive content does.
    fs::write(mod_dir.join("Scripts.ini"), "not a big archive").unwrap();

    let files = mod_files(&tmp.path, "Test Mod", "1.0").unwrap();
    assert_eq!(files.len(), 2);

    let big_source = mod_dir.join("!TME8Windows_99.gib");
    let big_target = relative_top_level_path(&tmp.path, &big_source, &mod_dir).unwrap();
    assert_eq!(big_target, tmp.path.join("!TME8Windows_99.big"), "BIGF-content .gib must target a .big filename");

    let ini_source = mod_dir.join("Scripts.ini");
    let ini_target = relative_top_level_path(&tmp.path, &ini_source, &mod_dir).unwrap();
    assert_eq!(ini_target, tmp.path.join("Scripts.ini"), "non-archive files keep their own extension");
  }

  #[test]
  fn exe_and_dll_files_are_excluded_from_mod_files() {
    let tmp = TempDir::new();
    setup_fake_mod(&tmp.path, "Test Mod", "1.0", &[("modded.exe", "x"), ("helper.dll", "x"), ("real.gib", "x")]);
    let files = mod_files(&tmp.path, "Test Mod", "1.0").unwrap();
    assert_eq!(files.len(), 1, "only the non-exe/dll file should remain");
    assert!(files[0].file_name().unwrap() == "real.gib");
  }

  #[test]
  fn switch_then_restore_round_trip_with_real_symlinks() {
    if !precondition::check().can_create_symlinks {
      eprintln!("skipping: this test needs Developer Mode or admin to create real symlinks");
      return;
    }
    let tmp = TempDir::new();
    let mod_dir = setup_fake_mod(&tmp.path, "Test Mod", "1.0", &[("thing.big", "mod data")]);
    let target = tmp.path.join("thing.big");
    fs::write(&target, "original base game data").unwrap();

    let files = mod_files(&tmp.path, "Test Mod", "1.0").unwrap();
    let manifest = record_manifest(&tmp.path, "Test Mod", "1.0", &files).unwrap();
    assert!(matches!(manifest.entries[0].before, PathState::RealFile));

    for source_file in &files {
      let t = relative_top_level_path(&tmp.path, source_file, &mod_dir).unwrap();
      stage_symlink(source_file, &t).unwrap();
    }

    assert!(is_symlink(&target), "target should now be a symlink");
    assert_eq!(fs::read_to_string(&target).unwrap(), "mod data", "symlink should resolve to the mod's file");
    assert!(target.with_extension("big.GLR").exists() || PathBuf::from(format!("{}.GLR", target.display())).exists());

    // Restore manually (mirrors cnc_restore_backup's per-entry logic).
    for entry in &manifest.entries {
      let t = tmp.path.join(&entry.relative_path);
      match entry.before {
        PathState::RealFile => {
          if is_symlink(&t) {
            fs::remove_file(&t).unwrap();
          }
          let glr = PathBuf::from(format!("{}{GLR_SUFFIX}", t.display()));
          fs::rename(&glr, &t).unwrap();
        }
        _ => unreachable!(),
      }
    }

    assert!(!is_symlink(&target), "target should be a real file again after restore");
    assert_eq!(fs::read_to_string(&target).unwrap(), "original base game data");
    assert!(!PathBuf::from(format!("{}.GLR", target.display())).exists(), "no orphaned .GLR file should remain");
  }

  #[test]
  fn switch_onto_absent_path_then_restore_removes_symlink_cleanly() {
    if !precondition::check().can_create_symlinks {
      eprintln!("skipping: this test needs Developer Mode or admin to create real symlinks");
      return;
    }
    let tmp = TempDir::new();
    let mod_dir = setup_fake_mod(&tmp.path, "Test Mod", "1.0", &[("new_file.big", "mod only data")]);
    let target = tmp.path.join("new_file.big");
    assert!(!target.exists());

    let files = mod_files(&tmp.path, "Test Mod", "1.0").unwrap();
    let manifest = record_manifest(&tmp.path, "Test Mod", "1.0", &files).unwrap();
    assert!(matches!(manifest.entries[0].before, PathState::Absent));

    for source_file in &files {
      let t = relative_top_level_path(&tmp.path, source_file, &mod_dir).unwrap();
      stage_symlink(source_file, &t).unwrap();
    }
    assert!(is_symlink(&target));

    for entry in &manifest.entries {
      let t = tmp.path.join(&entry.relative_path);
      if is_symlink(&t) {
        fs::remove_file(&t).unwrap();
      }
    }
    assert!(!target.exists(), "path should be completely absent again, matching pre-switch state");
  }
}
