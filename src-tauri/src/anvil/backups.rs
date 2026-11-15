//! ANVIL step 4a: the BACKUPS list. File names, sizes, dates and how they group, nothing more.
//!
//! This only lists. It never opens, restores, verifies or reads inside a backup file (a manifest's presence is
//! shown, its contents are not read here). Taking, verifying and restoring are separate actions that need the
//! user's say-so first.

use serde::Serialize;
use std::path::Path;

const BACKUPS: &str = r"C:\Database\backups";
const SNAPSHOTS: &str = r"C:\Database\_backups";

/// (file name prefix, source id, source name). Longest prefix wins.
const PREFIXES: &[(&str, &str, &str)] = &[
  ("private_hospital", "private_hospital", "Private hospital"),
  ("public_hospital", "public_hospital", "Public hospital"),
  ("hprs_identity", "hprs", "HPRS patient registry"),
  ("hpcsa_registry", "hpcsa", "HPCSA practitioner register"),
  ("mfl_dhis2", "mfl_dhis2", "MFL and DHIS2"),
  ("cms_schemes", "cms_schemes", "CMS medical schemes"),
  ("sanc_registry", "sanc_registry", "SANC nursing register"),
  ("nhls_lab_codes", "nhls_lab_codes", "NHLS laboratory codes"),
  ("icd10_mit", "icd10_mit", "ICD-10 diagnosis codes"),
  ("nappi_codes", "nappi_codes", "NAPPI medicine codes"),
  ("nrpl_items", "nrpl_items", "NRPL tariff items"),
];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
  pub name: String,
  /// "backups" (named files) or the snapshot folder's name, such as "20261110_2119".
  pub folder: String,
  pub source_id: Option<String>,
  pub source_name: Option<String>,
  /// What the name says it was for: "final", "pre_final", "empty", "prefix", ... (empty for a snapshot copy).
  pub label: String,
  pub bytes: u64,
  pub modified_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
  pub folder: String,
  pub files: u32,
  pub bytes: u64,
  pub has_manifest: bool,
  pub modified_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupList {
  pub files: Vec<BackupFile>,
  pub snapshots: Vec<Snapshot>,
  pub root_found: bool,
}

/// Which source a backup file belongs to, and the label between the source name and the date.
pub(crate) fn classify(file: &str) -> (Option<(&'static str, &'static str)>, String) {
  let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
  let best = PREFIXES.iter().filter(|(p, _, _)| stem.starts_with(p)).max_by_key(|(p, _, _)| p.len());
  match best {
    Some((p, id, name)) => {
      let rest = stem[p.len()..].trim_start_matches('_');
      // Drop the trailing date parts (digits and underscores), keep the words.
      let words: Vec<&str> = rest.split('_').filter(|w| !w.is_empty() && !w.chars().all(|c| c.is_ascii_digit())).collect();
      (Some((*id, *name)), words.join("_"))
    }
    None => (None, String::new()),
  }
}

fn modified_ms(m: &std::fs::Metadata) -> u64 {
  m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn scan_folder(dir: &Path, folder: &str, out: &mut Vec<BackupFile>) -> (u32, u64, bool, u64) {
  let (mut n, mut bytes, mut manifest, mut newest) = (0u32, 0u64, false, 0u64);
  let Ok(rd) = std::fs::read_dir(dir) else { return (0, 0, false, 0) };
  for e in rd.flatten() {
    let Ok(m) = e.metadata() else { continue };
    if !m.is_file() {
      continue;
    }
    let name = e.file_name().to_string_lossy().to_string();
    if name.eq_ignore_ascii_case("manifest.csv") {
      manifest = true;
      continue;
    }
    let (src, label) = classify(&name);
    let mtime = modified_ms(&m);
    n += 1;
    bytes += m.len();
    newest = newest.max(mtime);
    out.push(BackupFile { name, folder: folder.to_string(), source_id: src.map(|s| s.0.to_string()), source_name: src.map(|s| s.1.to_string()), label, bytes: m.len(), modified_ms: mtime });
  }
  (n, bytes, manifest, newest)
}

/// Every backup file and snapshot folder, with names, sizes and dates only.
#[tauri::command(async)]
pub fn anvil_backups() -> BackupList {
  let mut files = Vec::new();
  let mut snapshots = Vec::new();
  let root_found = Path::new(BACKUPS).is_dir() || Path::new(SNAPSHOTS).is_dir();
  scan_folder(Path::new(BACKUPS), "backups", &mut files);
  if let Ok(rd) = std::fs::read_dir(SNAPSHOTS) {
    for e in rd.flatten() {
      if !e.metadata().map(|m| m.is_dir()).unwrap_or(false) {
        continue;
      }
      let folder = e.file_name().to_string_lossy().to_string();
      let (n, bytes, has_manifest, newest) = scan_folder(&e.path(), &folder, &mut files);
      snapshots.push(Snapshot { folder, files: n, bytes, has_manifest, modified_ms: newest });
    }
  }
  files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(a.name.cmp(&b.name)));
  snapshots.sort_by(|a, b| b.folder.cmp(&a.folder));
  BackupList { files, snapshots, root_found }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn names_map_to_sources_and_labels() {
    let (s, l) = classify("hprs_identity_pre_final_20261110.bak");
    assert_eq!(s.unwrap().0, "hprs");
    assert_eq!(l, "pre_final");
    let (s, l) = classify("private_hospital_pre_lastvisit_fix_20261112.bak");
    assert_eq!(s.unwrap().0, "private_hospital");
    assert_eq!(l, "pre_lastvisit_fix");
    let (s, l) = classify("private_hospital_prefix_20261031_174252.bak");
    assert_eq!(s.unwrap().1, "Private hospital");
    assert_eq!(l, "prefix");
    let (s, l) = classify("hpcsa_registry.bak");
    assert_eq!(s.unwrap().0, "hpcsa");
    assert_eq!(l, "");
    assert!(classify("notes.txt").0.is_none());
  }
}
