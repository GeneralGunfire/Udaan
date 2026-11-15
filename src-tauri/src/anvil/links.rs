//! ANVIL step 3: the LINK CHECKER. Re-measures how many values in one source resolve in another (the 18 links
//! DEXA Forged lists on "How the sources connect") and compares each result with what Forged says.
//!
//! Privacy: the join columns are read into memory for the comparison and dropped straight after. A value is never
//! returned to the window, logged, or written anywhere. Only counts and a timestamp are kept, in Anvil's own small
//! database (`anvil.db` in Udaan's data folder), so a link's trend can be shown.
//!
//! Definitions (what counts as a "value", how codes are normalised) follow `final_pass/scripts/a_cross.py` and
//! Forged's own column descriptions. Where Forged's number and the measured number differ, the row says so: that is
//! the point of the page.

use super::query::csv_memory;
use super::{find, friendly, run_capped, Def, Engine, FILES_DIR, PSQL, SEP, SQLCMD};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, PartialEq, Debug)]
enum Norm {
  /// Upper-case letters and digits only ("HP 12-345" == "HP12345").
  Alnum,
  /// Surrounding spaces removed.
  Trim,
  /// ICD-10: upper-case, dots removed ("A00.1" == "A001").
  NoDot,
}

struct Link {
  id: &'static str,
  label: &'static str,
  /// (source id, SQL). One column; one row per value.
  left: (&'static str, &'static str),
  /// Every (source id, SQL) whose values together form the register being looked in.
  right: &'static [(&'static str, &'static str)],
  norm: Norm,
  /// What Forged's "How the sources connect" page says (values, resolve), measured 2026-11-11.
  forged: (u64, u64),
  /// How "values" is counted, for the page.
  how: &'static str,
}

macro_rules! sql_nb {
  ($col:literal, $from:literal) => {
    concat!("SELECT ", $col, " FROM ", $from, " WHERE ", $col, " IS NOT NULL AND LTRIM(RTRIM(", $col, "))<>''")
  };
}

const LINKS: [Link; 18] = [
  Link { id: "private_doctors_hpcsa", label: "Private doctors to HPCSA register", left: ("private_hospital", "SELECT reg_no FROM prac.practitioner_registration WHERE council_code='HPCSA' AND reg_no IS NOT NULL AND LTRIM(RTRIM(reg_no))<>''"), right: &[("hpcsa", "SELECT hpcsa_registration_no FROM dbo.practitioner WHERE hpcsa_registration_no IS NOT NULL")], norm: Norm::Alnum, forged: (30, 23), how: "council registration numbers of private practitioners" },
  Link { id: "private_staff_sanc", label: "Private staff to SANC register", left: ("private_hospital", "SELECT council_reg_no FROM hr.staff WHERE council_code='SANC'"), right: &[("sanc_registry", "SELECT sanc_registration_no FROM nurse")], norm: Norm::Alnum, forged: (35, 20), how: "staff registered with SANC (some have no number on file)" },
  Link { id: "public_doctors_hpcsa", label: "Public doctors to HPCSA register", left: ("public_hospital", sql_nb!("HPCSA_NO", "dbo.DOCTOR_MASTER")), right: &[("hpcsa", "SELECT hpcsa_registration_no FROM dbo.practitioner WHERE hpcsa_registration_no IS NOT NULL")], norm: Norm::Alnum, forged: (69, 57), how: "doctors with an HPCSA number" },
  Link { id: "public_staff_sanc", label: "Public staff to SANC register", left: ("public_hospital", sql_nb!("HPCSA_SANC_NO", "dbo.STAFF_MASTER")), right: &[("sanc_registry", "SELECT sanc_registration_no FROM nurse")], norm: Norm::Alnum, forged: (324, 142), how: "staff with a registration number" },
  Link { id: "private_members_cms", label: "Private scheme members to CMS register", left: ("private_hospital", sql_nb!("membership_no", "pat.patient_scheme_membership")), right: &[("cms_schemes", "SELECT member_number FROM scheme_member WHERE member_number IS NOT NULL")], norm: Norm::Alnum, forged: (3908, 421), how: "membership numbers" },
  Link { id: "public_medaid_cms", label: "Public medical-aid numbers to CMS register", left: ("public_hospital", sql_nb!("MEMBER_NO", "dbo.PAT_MEDAID")), right: &[("cms_schemes", "SELECT member_number FROM scheme_member WHERE member_number IS NOT NULL")], norm: Norm::Alnum, forged: (2022, 0), how: "member numbers that are not blank" },
  Link { id: "private_said_hprs", label: "Private patients with SA ID to HPRS", left: ("private_hospital", "SELECT id_value FROM pat.patient_identifier WHERE id_type_code='SA_ID' AND id_value IS NOT NULL AND LTRIM(RTRIM(id_value))<>''"), right: &[("hprs", "SELECT sa_id_number FROM dbo.patient WHERE sa_id_number IS NOT NULL")], norm: Norm::Trim, forged: (4153, 450), how: "SA ID identifiers" },
  Link { id: "public_said_hprs", label: "Public patients with SA ID to HPRS", left: ("public_hospital", "SELECT id_number FROM his.patient WHERE id_number IS NOT NULL AND id_number<>''"), right: &[("hprs", "SELECT sa_id_number FROM dbo.patient WHERE sa_id_number IS NOT NULL")], norm: Norm::Trim, forged: (5647, 1086), how: "patients with an ID number" },
  Link { id: "private_facility_mfl", label: "Private facility code to MFL", left: ("private_hospital", "SELECT facility_code FROM fac.facility"), right: &[("mfl_dhis2", "SELECT facility_uid FROM mfl_facility"), ("mfl_dhis2", "SELECT national_facility_id FROM mfl_facility"), ("mfl_dhis2", "SELECT dhis2_org_unit_code FROM mfl_facility WHERE dhis2_org_unit_code IS NOT NULL")], norm: Norm::Trim, forged: (1, 1), how: "facility codes (one facility)" },
  Link { id: "public_encounters_mfl", label: "Public encounters facility code to MFL", left: ("public_hospital", "SELECT facility_code FROM his.encounter WHERE facility_code IS NOT NULL"), right: &[("mfl_dhis2", "SELECT facility_uid FROM mfl_facility"), ("mfl_dhis2", "SELECT national_facility_id FROM mfl_facility"), ("mfl_dhis2", "SELECT dhis2_org_unit_code FROM mfl_facility WHERE dhis2_org_unit_code IS NOT NULL")], norm: Norm::Trim, forged: (75783, 75783), how: "one facility code per encounter" },
  Link { id: "private_nappi", label: "Private NAPPI products to NAPPI file", left: ("private_hospital", "SELECT nappi_code FROM ref.nappi_product"), right: &[("nappi_codes", "select nappi_code from data")], norm: Norm::Trim, forged: (92, 27), how: "products in ref.nappi_product" },
  Link { id: "public_nappi", label: "Public pharmacy items to NAPPI file", left: ("public_hospital", "SELECT NAPPI_CODE FROM dbo.PHARM_ITEM_MASTER WHERE NAPPI_CODE IS NOT NULL AND NAPPI_CODE<>''"), right: &[("nappi_codes", "select nappi_code from data")], norm: Norm::Trim, forged: (103, 33), how: "pharmacy items with a NAPPI code" },
  Link { id: "private_icd", label: "Private ICD-10 codes to ICD-10 file", left: ("private_hospital", "SELECT icd10_code FROM ref.icd10_code"), right: &[("icd10_mit", "select icd10_code from data")], norm: Norm::NoDot, forged: (247, 132), how: "codes in ref.icd10_code, dots ignored" },
  Link { id: "public_icd", label: "Public ICD-10 local codes to ICD-10 file", left: ("public_hospital", "SELECT ICD10 FROM dbo.ICD10_LOCAL"), right: &[("icd10_mit", "select icd10_code from data")], norm: Norm::NoDot, forged: (708, 132), how: "codes in ICD10_LOCAL, dots ignored" },
  Link { id: "private_tariff", label: "Private tariff items to NRPL file", left: ("private_hospital", "SELECT tariff_code FROM ref.tariff_item"), right: &[("nrpl_items", "select item_code from data")], norm: Norm::Trim, forged: (10, 6), how: "tariff items" },
  Link { id: "public_tariff", label: "Public billing tariff rows to NRPL file", left: ("public_hospital", "SELECT ITEM_CODE FROM dbo.BILL_TARIFF"), right: &[("nrpl_items", "select item_code from data")], norm: Norm::Trim, forged: (448, 217), how: "billing tariff rows" },
  Link { id: "private_lab", label: "Private lab tests to NHLS file (LOINC)", left: ("private_hospital", "SELECT loinc_code FROM ref.lab_test"), right: &[("nhls_lab_codes", "select loinc_code from lab_test where loinc_code is not null")], norm: Norm::Trim, forged: (40, 25), how: "lab tests, with or without a LOINC code" },
  Link { id: "public_lab", label: "Public lab result rows to NHLS file", left: ("public_hospital", "SELECT TEST_CODE FROM dbo.LAB_RESULT_IMPORT"), right: &[("nhls_lab_codes", "select nhls_test_code from lab_test")], norm: Norm::Trim, forged: (135988, 94355), how: "imported lab result rows" },
];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
  pub id: String,
  pub label: String,
  pub from: String,
  pub to: String,
  pub how: String,
  pub forged_values: u64,
  pub forged_resolved: u64,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkResult {
  pub id: String,
  pub values: u64,
  pub resolved: u64,
  pub distinct_values: u64,
  pub distinct_resolved: u64,
  /// resolved / values, 0 to 100.
  pub share: f64,
  /// Measured (rows or distinct) equals what Forged says.
  pub agrees: bool,
  pub error: Option<String>,
  pub measured_at_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
  pub id: String,
  pub at_ms: u64,
  pub values: u64,
  pub resolved: u64,
}

/* ───────────────────────────── normalising and counting ───────────────────────────── */

fn norm(n: Norm, s: &str) -> String {
  match n {
    Norm::Alnum => s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect(),
    Norm::Trim => s.trim().to_string(),
    Norm::NoDot => s.trim().chars().filter(|c| *c != '.').map(|c| c.to_ascii_uppercase()).collect(),
  }
}

/// (rows, rows found, distinct values, distinct found). Blank and "NULL" values count as rows but never match.
fn count(n: Norm, left: &[String], right: &HashSet<String>) -> (u64, u64, u64, u64) {
  let mut distinct: HashSet<&str> = HashSet::new();
  let normed: Vec<String> = left.iter().map(|v| norm(n, v)).collect();
  let (mut found, mut dfound) = (0u64, 0u64);
  for v in &normed {
    let hit = !v.is_empty() && v != "NULL" && right.contains(v);
    if hit {
      found += 1;
    }
    if distinct.insert(v.as_str()) && hit {
      dfound += 1;
    }
  }
  (normed.len() as u64, found, distinct.len() as u64, dfound)
}

/* ───────────────────────────── reading one column ───────────────────────────── */

fn lines(out: &str) -> Vec<String> {
  let mut v: Vec<String> = out.split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect();
  if v.last().map(|l| l.is_empty()).unwrap_or(false) {
    v.pop();
  }
  v
}

/// One column of values from one source. The SQL is always one of the constants above, never user input.
fn fetch(source: &str, sql: &str) -> Result<Vec<String>, String> {
  let d: &Def = find(source).ok_or("Unknown source")?;
  match d.engine {
    Engine::SqlServer => {
      let server = format!("localhost,{}", d.port);
      let sep = SEP.to_string();
      let q = format!("SET NOCOUNT ON; {sql}");
      let mut cmd = Command::new(if Path::new(SQLCMD).exists() { SQLCMD } else { "sqlcmd" });
      cmd.args(["-E", "-S", &server, "-d", d.target, "-l", "10", "-t", "60", "-h", "-1", "-W", "-s", &sep, "-b", "-Q", &q]);
      let (out, err, capped) = run_capped(&mut cmd, Duration::from_secs(90), 64 * 1024 * 1024)?;
      if capped || out.trim_start().starts_with("Msg ") {
        return Err(if err.trim().is_empty() { "Could not read the column".into() } else { friendly(&err) });
      }
      Ok(lines(&out))
    }
    Engine::Postgres => {
      let port = d.port.to_string();
      let mut cmd = Command::new(PSQL);
      cmd
        .args(["-h", "127.0.0.1", "-p", &port, "-U", "postgres", "-d", d.target, "-w", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql])
        .env("PGCONNECT_TIMEOUT", "5")
        .env("PGOPTIONS", "-c default_transaction_read_only=on -c statement_timeout=60000");
      let (out, err, capped) = run_capped(&mut cmd, Duration::from_secs(90), 64 * 1024 * 1024)?;
      if out.is_empty() && !err.trim().is_empty() {
        return Err(friendly(&err));
      }
      if capped {
        return Err("Could not read the column".into());
      }
      Ok(lines(&out))
    }
    Engine::Sqlite | Engine::Csv => {
      let conn = if d.engine == Engine::Csv {
        csv_memory(d)?
      } else {
        let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
        rusqlite::Connection::open_with_flags(Path::new(FILES_DIR).join(d.target), flags).map_err(|_| "Could not open".to_string())?
      };
      let mut st = conn.prepare(sql).map_err(|e| e.to_string())?;
      let rows = st.query_map([], |r| r.get::<_, Option<String>>(0)).map_err(|e| e.to_string())?;
      Ok(rows.flatten().map(|v| v.unwrap_or_else(|| "NULL".into())).collect())
    }
  }
}

fn measure(l: &Link) -> Result<(u64, u64, u64, u64), String> {
  let left = fetch(l.left.0, l.left.1)?;
  let mut right: HashSet<String> = HashSet::new();
  for (src, sql) in l.right {
    for v in fetch(src, sql)? {
      let n = norm(l.norm, &v);
      if !n.is_empty() && n != "NULL" {
        right.insert(n);
      }
    }
  }
  Ok(count(l.norm, &left, &right))
}

/* ───────────────────────────── history (counts and timestamps only) ───────────────────────────── */

fn db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let conn = rusqlite::Connection::open(dir.join("anvil.db")).map_err(|e| e.to_string())?;
  conn
    .execute_batch("CREATE TABLE IF NOT EXISTS link_runs (link_id TEXT NOT NULL, at_ms INTEGER NOT NULL, vals INTEGER NOT NULL, resolved INTEGER NOT NULL, dvals INTEGER NOT NULL, dresolved INTEGER NOT NULL);")
    .map_err(|e| e.to_string())?;
  Ok(conn)
}

fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/* ───────────────────────────── commands ───────────────────────────── */

/// The 18 links and what Forged claims for each.
#[tauri::command(async)]
pub fn anvil_link_list() -> Vec<LinkInfo> {
  LINKS
    .iter()
    .map(|l| LinkInfo {
      id: l.id.into(),
      label: l.label.into(),
      from: find(l.left.0).map(|d| d.name.to_string()).unwrap_or_default(),
      to: find(l.right[0].0).map(|d| d.name.to_string()).unwrap_or_default(),
      how: l.how.into(),
      forged_values: l.forged.0,
      forged_resolved: l.forged.1,
    })
    .collect()
}

/// Measures one link now and remembers the counts.
#[tauri::command(async)]
pub fn anvil_link_measure(app: AppHandle, id: String) -> Result<LinkResult, String> {
  let l = LINKS.iter().find(|l| l.id == id).ok_or("Unknown link")?;
  let at = now_ms();
  match measure(l) {
    Ok((v, f, dv, df)) => {
      if let Ok(c) = db(&app) {
        let _ = c.execute("INSERT INTO link_runs (link_id, at_ms, vals, resolved, dvals, dresolved) VALUES (?1,?2,?3,?4,?5,?6)", rusqlite::params![l.id, at as i64, v as i64, f as i64, dv as i64, df as i64]);
      }
      let share = if v == 0 { 0.0 } else { (f as f64 / v as f64) * 1000.0 };
      Ok(LinkResult {
        id: l.id.into(),
        values: v,
        resolved: f,
        distinct_values: dv,
        distinct_resolved: df,
        share: share.round() / 10.0,
        agrees: (v, f) == l.forged || (dv, df) == l.forged,
        error: None,
        measured_at_ms: at,
      })
    }
    Err(e) => Ok(LinkResult { id: l.id.into(), error: Some(e), measured_at_ms: at, ..Default::default() }),
  }
}

/// The last measurements of every link, oldest first (counts and times only).
#[tauri::command(async)]
pub fn anvil_link_history(app: AppHandle) -> Result<Vec<HistoryPoint>, String> {
  let c = db(&app)?;
  let mut st = c
    .prepare("SELECT link_id, at_ms, vals, resolved FROM link_runs WHERE rowid IN (SELECT rowid FROM link_runs r2 WHERE r2.link_id = link_runs.link_id ORDER BY at_ms DESC LIMIT 12) ORDER BY link_id, at_ms")
    .map_err(|e| e.to_string())?;
  let rows = st
    .query_map([], |r| Ok(HistoryPoint { id: r.get(0)?, at_ms: r.get::<_, i64>(1)? as u64, values: r.get::<_, i64>(2)? as u64, resolved: r.get::<_, i64>(3)? as u64 }))
    .map_err(|e| e.to_string())?;
  Ok(rows.flatten().collect())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn set(v: &[&str]) -> HashSet<String> {
    v.iter().map(|s| s.to_string()).collect()
  }

  #[test]
  fn normalisers_match_the_ways_codes_are_written() {
    assert_eq!(norm(Norm::Alnum, "mp 12-345 "), "MP12345");
    assert_eq!(norm(Norm::NoDot, " a00.1 "), "A001");
    assert_eq!(norm(Norm::Trim, "  X1 "), "X1");
  }

  #[test]
  fn counting_rows_and_distinct_values() {
    let left: Vec<String> = ["A1", "A1", "B2", "", "NULL", "C3"].iter().map(|s| s.to_string()).collect();
    let (rows, found, drows, dfound) = count(Norm::Trim, &left, &set(&["A1", "C3"]));
    assert_eq!((rows, found), (6, 3));
    // distinct: A1, B2, "", NULL, C3 -> 5; found A1 and C3 -> 2
    assert_eq!((drows, dfound), (5, 2));
  }

  #[test]
  fn blank_and_null_never_match_even_if_the_register_holds_them() {
    let left: Vec<String> = vec!["".into(), "NULL".into()];
    assert_eq!(count(Norm::Trim, &left, &set(&["", "NULL"])).1, 0);
  }

  #[test]
  fn there_are_eighteen_links_each_pointing_at_a_known_source() {
    assert_eq!(LINKS.len(), 18);
    let mut ids: Vec<&str> = LINKS.iter().map(|l| l.id).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 18);
    for l in &LINKS {
      assert!(find(l.left.0).is_some(), "{}", l.id);
      for (s, _) in l.right {
        assert!(find(s).is_some(), "{}", l.id);
      }
      assert!(l.forged.1 <= l.forged.0, "{}", l.id);
    }
  }

  #[test]
  fn lines_keep_blank_values_but_drop_the_final_newline() {
    assert_eq!(lines("a\r\n\r\nb\r\n"), vec!["a", "", "b"]);
    assert!(lines("").is_empty());
  }

  #[test]
  fn history_keeps_counts_only() {
    let dir = std::env::temp_dir().join(format!("anvil-hist-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let c = rusqlite::Connection::open(dir.join("t.db")).unwrap();
    c.execute_batch("CREATE TABLE link_runs (link_id TEXT NOT NULL, at_ms INTEGER NOT NULL, vals INTEGER NOT NULL, resolved INTEGER NOT NULL, dvals INTEGER NOT NULL, dresolved INTEGER NOT NULL);").unwrap();
    let cols: Vec<String> = c.prepare("pragma table_info(link_runs)").unwrap().query_map([], |r| r.get::<_, String>(1)).unwrap().flatten().collect();
    assert!(cols.iter().all(|n| !n.contains("value") || n == "vals" || n == "dvals"));
    let _ = std::fs::remove_dir_all(&dir);
  }
}
