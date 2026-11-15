//! ANVIL step 5: the FORGED BRIDGE. Anvil drafts timeline notes about what was done; the drafts wait in a list.
//!
//! Nothing here sends anything. A draft can be approved or rejected in the window, and an approved one is
//! sent to DEXA Forged (with `scripts/forged-log`) only when the user says so in the chat.
//!
//! A draft is refused at the door if it contains what Forged itself would refuse: a South African ID number
//! (13 digits), an email address, a phone number, a connection string, a credential, a token or a long
//! base64-looking string. Counts, errors and descriptions only.

use serde::Serialize;
use tauri::{AppHandle, Manager};

const SLUGS: &[&str] = &[
  "estate", "nappi", "icd10", "nrpl", "nhls", "mfl_dhis2", "sanc", "hpcsa", "cms", "hprs", "private_hospital", "public_hospital", "dhis2_aggregate", "tiernet_clinic",
];
const TYPES: &[&str] = &["Action", "Error", "Response", "Fix", "Decision", "Note"];

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
  pub id: i64,
  pub created_ms: u64,
  pub db: String,
  pub kind: String,
  pub title: String,
  pub summary: String,
  pub detail: String,
  /// "pending", "approved" or "rejected". Never "sent" from here.
  pub status: String,
}

/// Why this text may not go to Forged, or None if it is clean. The message names the kind of problem only.
pub fn refuse_reason(text: &str) -> Option<&'static str> {
  let lower = text.to_lowercase();
  let cs: Vec<char> = text.chars().collect();
  // A run of digits, allowing single spaces or dashes between them: its digit count and where it starts.
  let run_from = |i: usize| -> (usize, usize) {
    let (mut digits, mut j) = (0usize, i);
    while j < cs.len() {
      if cs[j].is_ascii_digit() {
        digits += 1;
      } else if !((cs[j] == ' ' || cs[j] == '-') && j + 1 < cs.len() && cs[j + 1].is_ascii_digit() && digits > 0) {
        break;
      }
      j += 1;
    }
    (digits, j - i)
  };
  let mut i = 0;
  while i < cs.len() {
    if cs[i].is_ascii_digit() || cs[i] == '+' {
      // Not the middle of a number written with thousands commas or a decimal point.
      let glued = i > 0 && (cs[i - 1].is_ascii_digit() || cs[i - 1] == ',' || cs[i - 1] == '.');
      let start = if cs[i] == '+' { i + 1 } else { i };
      let (digits, len) = run_from(start);
      if !glued {
        if digits >= 13 {
          return Some("a 13-digit number (an ID number?)");
        }
        let first_two: String = cs[start..].iter().take(2).collect();
        if cs[i] == '+' && first_two == "27" && digits >= 11 {
          return Some("a phone number");
        }
        if cs[i] == '0' && digits == 10 && cs.get(i + 1).map(|c| ('1'..='8').contains(c)).unwrap_or(false) {
          return Some("a phone number");
        }
      }
      i = start + len.max(1);
    } else {
      i += 1;
    }
  }
  if text.split_whitespace().any(|w| w.contains('@') && w.contains('.') && !w.starts_with('@') && !w.ends_with('@')) {
    return Some("an email address");
  }
  for k in ["server=", "data source=", "uid=", "user id=", "password=", "pwd=", "postgres://", "postgresql://", "jdbc:", "mongodb://", "token=", "apikey", "api_key", "secret", "bearer ", "begin private key", "begin rsa private key", "service_role", "service-role"] {
    if lower.contains(k) {
      return Some("a connection string or credential");
    }
  }
  // A long base64-looking run.
  let mut b64 = 0;
  for c in text.chars() {
    if c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '=' {
      b64 += 1;
      if b64 > 40 {
        return Some("a long encoded string");
      }
    } else {
      b64 = 0;
    }
  }
  None
}

fn db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let conn = rusqlite::Connection::open(dir.join("anvil.db")).map_err(|e| e.to_string())?;
  conn
    .execute_batch(
      "CREATE TABLE IF NOT EXISTS forged_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, created_ms INTEGER NOT NULL, db TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT NOT NULL, status TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
  Ok(conn)
}

fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn check(title: &str, summary: &str, detail: &str) -> Result<(), String> {
  if title.trim().is_empty() || summary.trim().is_empty() {
    return Err("A note needs a title and a summary".into());
  }
  if title.chars().count() > 160 || title.contains('\n') {
    return Err("The title must be one short line".into());
  }
  if summary.chars().count() > 1500 || detail.chars().count() > 6000 {
    return Err("The note is too long".into());
  }
  for (what, t) in [("title", title), ("summary", summary), ("detail", detail)] {
    if let Some(why) = refuse_reason(t) {
      return Err(format!("The {what} contains {why}. Forged would refuse it. Counts and descriptions only."));
    }
  }
  Ok(())
}

/// Saves a new draft (status pending) after the same checks Forged applies.
#[tauri::command(async)]
pub fn anvil_forged_draft(app: AppHandle, source: String, kind: String, title: String, summary: String, detail: String) -> Result<i64, String> {
  if !SLUGS.contains(&source.as_str()) {
    return Err("Unknown database slug".into());
  }
  if !TYPES.contains(&kind.as_str()) {
    return Err("Unknown note type".into());
  }
  check(&title, &summary, &detail)?;
  let c = db(&app)?;
  c.execute(
    "INSERT INTO forged_drafts (created_ms, db, kind, title, summary, detail, status) VALUES (?1,?2,?3,?4,?5,?6,'pending')",
    rusqlite::params![now_ms() as i64, source, kind, title.trim(), summary.trim(), detail.trim()],
  )
  .map_err(|e| e.to_string())?;
  Ok(c.last_insert_rowid())
}

#[tauri::command(async)]
pub fn anvil_forged_list(app: AppHandle) -> Result<Vec<Draft>, String> {
  let c = db(&app)?;
  let mut st = c.prepare("SELECT id, created_ms, db, kind, title, summary, detail, status FROM forged_drafts ORDER BY id DESC LIMIT 200").map_err(|e| e.to_string())?;
  let rows = st
    .query_map([], |r| {
      Ok(Draft { id: r.get(0)?, created_ms: r.get::<_, i64>(1)? as u64, db: r.get(2)?, kind: r.get(3)?, title: r.get(4)?, summary: r.get(5)?, detail: r.get(6)?, status: r.get(7)? })
    })
    .map_err(|e| e.to_string())?;
  Ok(rows.flatten().collect())
}

/// Approve or reject a draft. This only records the decision; nothing is sent.
#[tauri::command(async)]
pub fn anvil_forged_decide(app: AppHandle, id: i64, status: String) -> Result<(), String> {
  if status != "approved" && status != "rejected" && status != "pending" {
    return Err("Unknown status".into());
  }
  let c = db(&app)?;
  c.execute("UPDATE forged_drafts SET status=?1 WHERE id=?2", rusqlite::params![status, id]).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command(async)]
pub fn anvil_forged_delete(app: AppHandle, id: i64) -> Result<(), String> {
  let c = db(&app)?;
  c.execute("DELETE FROM forged_drafts WHERE id=?1", rusqlite::params![id]).map_err(|e| e.to_string())?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn clean_notes_pass() {
    assert!(check("Link check", "14 of 18 links agree with Forged.", "public_icd: 197 of 708 resolve (27.8%)").is_ok());
    assert!(check("Registry", "HPRS reports SQL Server 16.0.1220.3.", "size 208 MB, 4 tables, 59,799 rows").is_ok());
  }

  #[test]
  fn refuses_what_forged_refuses() {
    assert!(refuse_reason("patient 8001015009087 found").is_some());
    assert!(refuse_reason("id 800101 5009 087").is_some());
    assert!(refuse_reason("mail tessy@example.co.za").is_some());
    assert!(refuse_reason("Server=localhost;Password=abc").is_some());
    assert!(refuse_reason("postgres://u:p@h/db").is_some());
    assert!(refuse_reason("call 082 123 4567 now").is_some());
    assert!(refuse_reason("+27821234567").is_some());
    assert!(refuse_reason("token=abc").is_some());
    assert!(refuse_reason("QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5QUJDREVGR0g=").is_some());
  }

  #[test]
  fn counts_and_versions_are_not_mistaken_for_ids_or_phones() {
    assert!(refuse_reason("1,890,557 rows; 9,872 MB; version 16.0.1220.3").is_none());
    assert!(refuse_reason("135,988 lab rows, 94,355 resolve (69.4%)").is_none());
    assert!(refuse_reason("measured 2026-11-16 at 12:44").is_none());
  }

  #[test]
  fn needs_a_title_and_summary() {
    assert!(check("", "x", "").is_err());
    assert!(check("x", " ", "").is_err());
    assert!(check("a\nb", "x", "").is_err());
  }
}
