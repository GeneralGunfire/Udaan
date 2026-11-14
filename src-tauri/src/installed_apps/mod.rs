//! Detects and launches real installed desktop applications, grouped by
//! "app group" (Microsoft today; Adobe/Dev Tools etc. could follow the same
//! shape later — see `AppGroup`/`known_apps_for_group`).
//!
//! Detection uses Windows' own `App Paths` registry key
//! (`HKLM`/`HKCU` \ `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<exe>`)
//! — the same mechanism `start winword` and the Start Menu itself rely on to
//! resolve a bare executable name to its real install path, so a hit here is
//! a verified, launchable path rather than a guess. UWP apps (Microsoft
//! Store) have no traditional executable/App Paths entry, so those are
//! detected via their registered URI protocol handler instead (see
//! `Locator::ProtocolUri`) and launched the same way a Start Menu tile or a
//! web link would. Apps with neither are simply omitted (same "detect
//! what's actually present, omit the rest" pattern as
//! `file_explorer::file_explorer_quick_access`) — never a broken tile for
//! something that isn't installed.
//!
//! Launching reuses the `opener` crate exactly like
//! `file_explorer::file_explorer_open_with_system`, rather than a third
//! process-launch mechanism alongside that one and `local_model`'s
//! `tokio::process::Command` (which tracks/kills a specific child — not
//! appropriate here since we never want to manage Office's lifecycle).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppGroup {
  Microsoft,
  /// Standalone apps pinned individually at the top level of Launchpad
  /// (not grouped into a folder) — Claude desktop, VS Code, Snipping
  /// Tool, Norton Private Browser. Detection/launch mechanics are
  /// identical to the Microsoft group's, just not organized under a
  /// folder tile in the frontend.
  Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedApp {
  /// Stable id for this known app, e.g. "word" — not the exe name, so the
  /// frontend can map it to a specific icon/label independent of detection.
  pub id: String,
  pub name: String,
  pub group: AppGroup,
  /// Launchable path (real .exe) OR a protocol URI (e.g. `ms-windows-store:`)
  /// for apps with no traditional App Paths entry — `installed_apps_launch`
  /// hands whichever it gets straight to `opener::open`, which handles both.
  pub path: String,
}

enum Locator {
  /// Resolved via the `App Paths` registry key — only listed if a real,
  /// verified executable is found there. Covers traditional Win32 installs
  /// (the classic Office desktop suite: Word/Excel/PowerPoint/Outlook/
  /// OneNote/Publisher/Access all register here).
  AppPathsExe(&'static str),
  /// A UWP app with no `App Paths` entry — launched via its registered
  /// protocol/URI handler instead of a file path. Presence is checked via
  /// the URI protocol's registry key rather than a file on disk, since
  /// there is no single "the exe" for a UWP package.
  ProtocolUri { uri: &'static str, protocol_key: &'static str },
  /// A UWP/MSIX-packaged app (installed via the Microsoft Store, or
  /// side-loaded) — Power BI Desktop, and OneDrive on some installs, ship
  /// this way and have neither an App Paths entry nor a stable file path.
  /// Detected and launched via the package's family name (see
  /// `resolve_packaged_app`) using PowerShell's `Get-AppxPackage`, since
  /// there is no lightweight pure-Rust way to enumerate installed AppX
  /// packages without a much heavier native COM dependency.
  PackagedApp { package_family_name: &'static str },
}

struct KnownApp {
  id: &'static str,
  name: &'static str,
  locator: Locator,
}

fn known_apps_for_group(group: AppGroup) -> &'static [KnownApp] {
  match group {
    AppGroup::Microsoft => &[
      KnownApp { id: "word", name: "Word", locator: Locator::AppPathsExe("WINWORD.EXE") },
      KnownApp { id: "excel", name: "Excel", locator: Locator::AppPathsExe("EXCEL.EXE") },
      KnownApp { id: "powerpoint", name: "PowerPoint", locator: Locator::AppPathsExe("POWERPNT.EXE") },
      KnownApp { id: "outlook", name: "Outlook", locator: Locator::AppPathsExe("OUTLOOK.EXE") },
      KnownApp { id: "onenote", name: "OneNote", locator: Locator::AppPathsExe("ONENOTE.EXE") },
      KnownApp { id: "onedrive", name: "OneDrive", locator: Locator::AppPathsExe("OneDrive.exe") },
      KnownApp {
        id: "powerbi",
        name: "Power BI Desktop",
        locator: Locator::PackagedApp { package_family_name: "Microsoft.MicrosoftPowerBIDesktop_8wekyb3d8bbwe" },
      },
      KnownApp {
        id: "store",
        name: "Microsoft Store",
        locator: Locator::ProtocolUri { uri: "ms-windows-store:", protocol_key: "ms-windows-store" },
      },
      KnownApp {
        id: "todo",
        name: "Microsoft To Do",
        // To Do is UWP-only (no traditional .exe/App Paths entry) —
        // Microsoft's own documented URI scheme for launching it directly
        // to a specific list is `ms-todo:`, same detection/launch pattern
        // as the Microsoft Store entry above.
        locator: Locator::ProtocolUri { uri: "ms-todo:", protocol_key: "ms-todo" },
      },
      KnownApp {
        id: "outlook-new",
        name: "Outlook",
        // The rebuilt "new Outlook" (distinct from the classic Win32
        // OUTLOOK.EXE entry above) ships as an MSIX package —
        // Microsoft.OutlookForWindows — with no App Paths entry, same
        // packaged-app detection/launch path already used for Power BI
        // Desktop above.
        locator: Locator::PackagedApp { package_family_name: "Microsoft.OutlookForWindows_8wekyb3d8bbwe" },
      },
    ],
    // Claude, Norton, Norton Private Browser, TeamViewer, and Snipping Tool
    // used to live here too, but as detection-gated entries they simply
    // never rendered a tile at all when the guessed exe/package name
    // didn't resolve on a given machine, with no visible explanation why
    // (Snipping Tool specifically: confirmed via direct registry
    // inspection that Microsoft.ScreenSketch isn't installed on this
    // machine at all). They're now always-shown pinned tiles instead (see
    // `ALWAYS_SHOWN_OTHER_APPS` in the frontend's app/apps.ts, launched
    // via the new `installed_apps_launch_by_exe_name` command) — kept out
    // of this detection list so they don't also show up here and render
    // twice.
    AppGroup::Other => &[
      KnownApp { id: "vscode", name: "VS Code", locator: Locator::AppPathsExe("Code.exe") },
      KnownApp {
        id: "disney-plus",
        name: "Disney+",
        // Disney+ ships as an MSIX/UWP package (Microsoft Store), same
        // packaged-app detection/launch path as Power BI Desktop/Snipping
        // Tool above — verified against this machine's actual install via
        // its AppModel\Repository\Packages registry entry
        // (Disney.37853FC22B2CE_<hash>).
        locator: Locator::PackagedApp { package_family_name: "Disney.37853FC22B2CE_6rarf9sa4v8jt" },
      },
    ],
  }
}

#[cfg(target_os = "windows")]
fn resolve_app_paths_exe(exe: &str) -> Option<String> {
  use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
  use winreg::RegKey;

  let subkey = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
  for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
    let root = RegKey::predef(hive);
    if let Ok(key) = root.open_subkey(&subkey) {
      // The App Paths default value is the full path to the executable.
      if let Ok(path) = key.get_value::<String, _>("") {
        if std::path::Path::new(&path).is_file() {
          return Some(path);
        }
      }
    }
  }
  None
}

/// True if `protocol` (e.g. "ms-windows-store") is a registered URI
/// protocol handler on this machine — the way to check a UWP app is
/// actually present without a traditional file path to stat.
#[cfg(target_os = "windows")]
fn protocol_is_registered(protocol: &str) -> bool {
  use winreg::enums::HKEY_CLASSES_ROOT;
  use winreg::RegKey;

  let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
  let Ok(key) = hkcr.open_subkey(protocol) else { return false };
  key.get_value::<String, _>("URL Protocol").is_ok()
}

/// Resolves the real AUMID (`PackageFamilyName!AppId`) for an installed
/// package entirely from the registry — no process shell-out. Confirmed by
/// direct inspection that Windows itself stores each installed package
/// under
/// `HKCU\...\CurrentVersion\AppModel\Repository\Packages\<PackageFullName>`,
/// where `PackageFullName` starts with `PackageFamilyName` up to its
/// version segment (`Name_Version_Arch__PublisherHash` vs
/// `Name_PublisherHash`), and that key's own single child subkey name IS
/// the real AppId (verified against Power BI Desktop: AppId is
/// `Microsoft.MicrosoftPowerBIDesktop`, not a guessable `App` suffix — an
/// earlier PowerShell-based version of this function got that right, but
/// shelling out cost 1-1.5s of pure PowerShell cold-start per call, making
/// the whole Microsoft folder feel hung on open; this replacement is a
/// plain registry read, same speed class as the other `AppPathsExe`/
/// `ProtocolUri` locators).
#[cfg(target_os = "windows")]
fn resolve_packaged_app_aumid(package_family_name: &str) -> Option<String> {
  use winreg::enums::HKEY_CURRENT_USER;
  use winreg::RegKey;

  let hkcu = RegKey::predef(HKEY_CURRENT_USER);
  let packages = hkcu
    .open_subkey(
      r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages",
    )
    .ok()?;

  // PackageFamilyName is "<Name>_<PublisherHash>"; PackageFullName is
  // "<Name>_<Version>_<Arch>_<PublisherHash>" — same Name prefix and same
  // PublisherHash suffix, version/arch inserted between. Match both ends
  // rather than assume a fixed version string.
  let (name_part, publisher_hash) = package_family_name.rsplit_once('_')?;

  for subkey_name in packages.enum_keys().filter_map(|k| k.ok()) {
    if !subkey_name.starts_with(name_part) || !subkey_name.ends_with(publisher_hash) {
      continue;
    }
    let Ok(package_key) = packages.open_subkey(&subkey_name) else { continue };
    // The package's own single child subkey (its name) is the AppId.
    if let Some(app_id) = package_key.enum_keys().filter_map(|k| k.ok()).next() {
      return Some(format!("{package_family_name}!{app_id}"));
    }
  }
  None
}

#[cfg(not(target_os = "windows"))]
fn resolve_app_paths_exe(_exe: &str) -> Option<String> {
  None
}

#[cfg(not(target_os = "windows"))]
fn protocol_is_registered(_protocol: &str) -> bool {
  false
}

#[cfg(not(target_os = "windows"))]
fn resolve_packaged_app_aumid(_package_family_name: &str) -> Option<String> {
  None
}

/// `shell:appsFolder\<AUMID>` is the standard way to invoke any installed
/// UWP/MSIX app from outside the Start Menu, using its Application User
/// Model ID (`PackageFamilyName!AppId`).
fn packaged_app_launch_uri(aumid: &str) -> String {
  format!("shell:appsFolder\\{aumid}")
}

fn resolve_locator(locator: &Locator) -> Option<String> {
  match locator {
    Locator::AppPathsExe(exe) => resolve_app_paths_exe(exe),
    Locator::ProtocolUri { uri, protocol_key } => {
      protocol_is_registered(protocol_key).then(|| uri.to_string())
    }
    Locator::PackagedApp { package_family_name } => {
      resolve_packaged_app_aumid(package_family_name).map(|aumid| packaged_app_launch_uri(&aumid))
    }
  }
}

/// Detects which apps in `group` are actually installed on this machine.
/// Never errors — an app with no verified path/protocol is simply omitted,
/// so the frontend never has to render a tile for something that would
/// fail to launch.
#[tauri::command(async)]
pub fn installed_apps_detect(group: AppGroup) -> Vec<DetectedApp> {
  known_apps_for_group(group)
    .iter()
    .filter_map(|app| {
      resolve_locator(&app.locator).map(|path| DetectedApp {
        id: app.id.to_string(),
        name: app.name.to_string(),
        group,
        path,
      })
    })
    .collect()
}

/// Launches a previously-detected app by its verified path or protocol URI
/// (e.g. `ms-windows-store:`). Callers should only ever pass a value that
/// came from `installed_apps_detect` — this command does not re-validate
/// against the registry, just hands it to the OS the same way
/// double-clicking a file or a link would.
#[tauri::command(async)]
pub fn installed_apps_launch(path: String) -> Result<(), String> {
  // A protocol URI (e.g. "ms-windows-store:") has a multi-character scheme
  // before its ':' — a real Windows path's ':' is always a single drive
  // letter at index 1 ("C:\..."). Only real file paths get the existence
  // check; a URI has nothing to stat on disk.
  let is_protocol_uri = path.find(':').is_some_and(|i| i != 1);

  if !is_protocol_uri && !std::path::Path::new(&path).is_file() {
    return Err(format!("\"{path}\" no longer exists — it may have been moved or uninstalled."));
  }
  opener::open(&path).map_err(|e| format!("Failed to launch \"{path}\": {e}"))
}

/// Launches an app by its bare executable name (e.g. "Claude.exe") without
/// requiring a prior `installed_apps_detect` call — for Launchpad tiles
/// that are always shown regardless of whether detection found them (see
/// `ALWAYS_SHOWN_OTHER_APPS` in the frontend's apps.ts), rather than only
/// appearing once a detection pass happens to succeed. Resolves the real
/// path via the same App Paths registry lookup `known_apps_for_group`
/// detection already uses (`resolve_app_paths_exe`), so this still only
/// ever launches a real, verified install — it just doesn't require the
/// tile itself to have been conditionally rendered from a successful
/// detection first. Returns a clear "not installed" error (not a generic
/// launch failure) when the registry lookup itself comes up empty, since
/// that's the actually-common case for these tiles on a machine that
/// doesn't have the app.
/// Where `installed_apps_launch_by_exe_name` would launch `exe` from: a
/// real file path, or a `shell:AppsFolder` URI for packaged apps. `None`
/// when the app isn't installed.
pub fn resolve_launch_target(exe: &str) -> Option<String> {
  #[cfg(target_os = "windows")]
  {
    resolve_app_paths_exe(exe).or_else(|| known_fallback_launch_target(exe))
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = exe;
    None
  }
}

#[tauri::command(async)]
pub fn installed_apps_launch_by_exe_name(exe: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    if let Some(path) = resolve_app_paths_exe(&exe) {
      return opener::open(&path).map_err(|e| format!("Failed to launch \"{path}\": {e}"));
    }
    // Claude, Norton, Norton Private Browser, and TeamViewer don't register
    // an App Paths entry at all (confirmed by direct registry inspection),
    // so the lookup above always misses for them even when installed.
    // Claude ships as a packaged app (AUMID lookup); the others are
    // traditional installs at fixed, vendor-standard locations — fall back
    // to those known locations, still verifying the file/package actually
    // exists before launching rather than guessing blind.
    if let Some(launch_target) = known_fallback_launch_target(&exe) {
      return opener::open(&launch_target).map_err(|e| format!("Failed to launch \"{launch_target}\": {e}"));
    }
    return Err(format!("{exe} isn't installed on this machine."));
  }
  #[cfg(not(target_os = "windows"))]
  {
    Err(format!("{exe} isn't installed on this machine."))
  }
}

/// Known install locations for apps that have no App Paths registry entry
/// (see `installed_apps_launch_by_exe_name`) — verified against this
/// machine's actual installs since these vendors don't register the entry
/// `resolve_app_paths_exe` relies on. Returns a launchable path/URI only if
/// the app is actually present, same "verify, don't guess" contract as
/// every other locator in this file.
#[cfg(target_os = "windows")]
fn known_fallback_launch_target(exe: &str) -> Option<String> {
  match exe {
    "Claude.exe" => {
      let aumid = resolve_packaged_app_aumid("Claude_pzs8sxrjxfjjc")?;
      Some(packaged_app_launch_uri(&aumid))
    }
    "SnippingTool.exe" => {
      // Went looking for the modern MSIX Snipping Tool (Microsoft.
      // ScreenSketch) first — genuinely not installed on this machine
      // (confirmed by direct registry inspection: no AppModel\Repository
      // \Packages entry at all), so that AUMID lookup always failed here.
      // The legacy Win32 SnippingTool.exe, however, still ships at a
      // fixed OS path even on machines that never got/kept the MSIX
      // version — same "fixed, OS-guaranteed location" case as
      // explorer.exe below, just under System32 instead of WINDIR itself.
      let windir = std::env::var("WINDIR").ok()?;
      let path = std::path::Path::new(&windir).join("System32").join("SnippingTool.exe");
      path.is_file().then(|| path.to_string_lossy().into_owned())
    }
    "NortonSecurity.exe" => {
      let path = r"C:\Program Files\Norton\Suite\NortonUI.exe";
      std::path::Path::new(path).is_file().then(|| path.to_string())
    }
    "NortonPrivateBrowser.exe" => {
      let base = dirs::data_local_dir()?;
      let path = base.join(r"Norton\Browser\Application\NortonBrowser.exe");
      path.is_file().then(|| path.to_string_lossy().into_owned())
    }
    "TeamViewer.exe" => {
      let path = r"C:\Program Files\TeamViewer\TeamViewer.exe";
      std::path::Path::new(path).is_file().then(|| path.to_string())
    }
    "explorer.exe" => {
      // explorer.exe is resolved via PATH/the Windows directory, not the
      // App Paths registry key, so `resolve_app_paths_exe` always misses
      // it — confirmed by direct registry inspection (no HKLM or
      // WOW6432Node entry on this machine). It always lives directly under
      // %WINDIR%, a fixed OS-guaranteed location.
      let windir = std::env::var("WINDIR").ok()?;
      let path = std::path::Path::new(&windir).join("explorer.exe");
      path.is_file().then(|| path.to_string_lossy().into_owned())
    }
    _ => None,
  }
}

/// A file-type handler resolved from the OS's own file-association registry
/// — either the system default or one entry from the "Open with" list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileHandler {
  pub name: String,
  /// Executable path, suitable for `installed_apps_launch_with_file`.
  pub exe_path: String,
  pub is_default: bool,
}

#[cfg(target_os = "windows")]
mod windows_handlers {
  use super::FileHandler;
  use std::path::Path;
  use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER};
  use winreg::RegKey;

  /// Pulls the executable path out of a `shell\open\command` default value,
  /// which is usually `"C:\Path\App.exe" "%1"` (quoted, with an argument
  /// placeholder) but sometimes bare/unquoted — handle both.
  fn extract_exe_path(command: &str) -> Option<String> {
    let trimmed = command.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
      let end = rest.find('"')?;
      return Some(rest[..end].to_string());
    }
    // Unquoted: take everything up to the first " %" placeholder, or the whole string.
    let cut = trimmed.find(" %").unwrap_or(trimmed.len());
    Some(trimmed[..cut].trim().to_string())
  }

  fn friendly_name_for_progid(progid: &str) -> Option<String> {
    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
    let key = hkcr.open_subkey(progid).ok()?;
    key.get_value::<String, _>("").ok().filter(|s| !s.is_empty())
  }

  fn command_for_progid(progid: &str) -> Option<String> {
    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
    let key = hkcr
      .open_subkey(format!(r"{progid}\shell\open\command"))
      .ok()?;
    key.get_value::<String, _>("").ok()
  }

  fn handler_from_progid(progid: &str, is_default: bool) -> Option<FileHandler> {
    let command = command_for_progid(progid)?;
    let exe_path = extract_exe_path(&command)?;
    if !Path::new(&exe_path).is_file() {
      return None;
    }
    let name = friendly_name_for_progid(progid).unwrap_or_else(|| progid.to_string());
    Some(FileHandler { name, exe_path, is_default })
  }

  /// The OS's current default handler for `.ext`, resolved the same way
  /// Explorer resolves it: `HKCU...FileExts\.ext\UserChoice` first (the
  /// user's own per-extension choice), falling back to `HKCR\.ext`'s
  /// default ProgID.
  pub fn default_handler(ext: &str) -> Option<FileHandler> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let user_choice_path = format!(
      r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{ext}\UserChoice"
    );
    if let Ok(key) = hkcu.open_subkey(&user_choice_path) {
      if let Ok(progid) = key.get_value::<String, _>("ProgId") {
        if let Some(handler) = handler_from_progid(&progid, true) {
          return Some(handler);
        }
      }
    }

    let hkcr = RegKey::predef(HKEY_CLASSES_ROOT);
    let ext_key = hkcr.open_subkey(format!(".{ext}")).ok()?;
    let progid = ext_key.get_value::<String, _>("").ok()?;
    if progid.is_empty() {
      return None;
    }
    handler_from_progid(&progid, true)
  }

  /// Every handler the OS knows about for `.ext` (the "Open with" list),
  /// default first, deduplicated by exe path.
  pub fn all_handlers(ext: &str) -> Vec<FileHandler> {
    let mut seen_paths = std::collections::HashSet::new();
    let mut handlers = Vec::new();

    if let Some(default) = default_handler(ext) {
      seen_paths.insert(default.exe_path.clone());
      handlers.push(default);
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let open_with_path = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{ext}\OpenWithProgids");
    if let Ok(key) = hkcu.open_subkey(&open_with_path) {
      for name in key.enum_values().filter_map(|v| v.ok()).map(|(name, _)| name) {
        if let Some(handler) = handler_from_progid(&name, false) {
          if seen_paths.insert(handler.exe_path.clone()) {
            handlers.push(handler);
          }
        }
      }
    }

    handlers
  }
}

#[cfg(not(target_os = "windows"))]
mod windows_handlers {
  use super::FileHandler;
  pub fn default_handler(_ext: &str) -> Option<FileHandler> {
    None
  }
  pub fn all_handlers(_ext: &str) -> Vec<FileHandler> {
    Vec::new()
  }
}

/// Resolves the OS's current default app for a file extension (no dot),
/// asking the registry directly rather than hardcoding an extension map —
/// stays correct if the user changes their default in Windows Settings.
#[tauri::command(async)]
pub fn installed_apps_default_handler(extension: String) -> Option<FileHandler> {
  windows_handlers::default_handler(&extension)
}

/// All handlers Windows knows about for a file extension (the "Open with"
/// list), default first.
#[tauri::command(async)]
pub fn installed_apps_handlers_for_extension(extension: String) -> Vec<FileHandler> {
  windows_handlers::all_handlers(&extension)
}

/// Opens `file_path` with a specific handler executable — used by the
/// "Open with" submenu when the user picks something other than the
/// system default (which `file_explorer_open_with_system` already covers).
#[tauri::command(async)]
pub fn installed_apps_open_file_with(exe_path: String, file_path: String) -> Result<(), String> {
  std::process::Command::new(&exe_path)
    .arg(&file_path)
    .spawn()
    .map(|_| ())
    .map_err(|e| format!("Failed to open with \"{exe_path}\": {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  /// Real detection against the live machine — confirms every known
  /// Microsoft app resolves to a plausible, existing path/URI, and reports
  /// exactly what's missing so gaps are visible rather than silent.
  #[test]
  fn detect_reports_real_apps() {
    let detected = installed_apps_detect(AppGroup::Microsoft);
    let known = known_apps_for_group(AppGroup::Microsoft);

    println!("detected {}/{} known Microsoft apps:", detected.len(), known.len());
    for app in &detected {
      println!("  {} -> {}", app.id, app.path);
    }
    let detected_ids: Vec<&str> = detected.iter().map(|a| a.id.as_str()).collect();
    for known_app in known {
      if !detected_ids.contains(&known_app.id) {
        println!("  (not detected: {})", known_app.id);
      }
    }

    // Every detected AppPathsExe entry must be a real file on disk.
    for app in &detected {
      let is_uri = app.path.contains(':') && !app.path.chars().nth(1).is_some_and(|c| c == ':');
      if !is_uri {
        assert!(
          std::path::Path::new(&app.path).is_file(),
          "detected app {} claims path {} but it doesn't exist",
          app.id,
          app.path
        );
      }
    }
  }

  /// Regression guard for the perf bug reported against the Launchpad:
  /// detection used to shell out to PowerShell for packaged-app (Power BI)
  /// resolution, costing 1-1.5s of pure PowerShell cold-start per call and
  /// making the Microsoft folder feel hung on open. The whole thing must
  /// now be comfortably sub-100ms, since it's now pure registry reads.
  #[test]
  fn detect_is_fast() {
    let start = std::time::Instant::now();
    let _ = installed_apps_detect(AppGroup::Microsoft);
    let elapsed = start.elapsed();
    println!("installed_apps_detect took {elapsed:?}");
    assert!(elapsed.as_millis() < 100, "detection took {elapsed:?}, expected well under 100ms");
  }
}
