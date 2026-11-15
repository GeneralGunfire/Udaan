//! ANVIL step 2b: the safe query console.
//!
//! The guarantee is layered, because Windows login cannot itself be read-only:
//!   1. `validate` accepts ONE statement that starts with SELECT or WITH and refuses anything that writes,
//!      executes, reads files, reaches other servers or changes settings (comments and strings are ignored
//!      when looking, so a keyword inside a text value is fine).
//!   2. The engine is asked to be read-only as well: PostgreSQL runs with `default_transaction_read_only`;
//!      SQL Server runs inside a transaction that is always rolled back; SQLite is opened read-only with
//!      `query_only`; CSV files are loaded into a throw-away in-memory SQLite table.
//!   3. A time limit and a row cap (the caller never sees more than `ROW_CAP` rows).
//!
//! Results go to the window that asked and nowhere else: nothing is exported, logged or stored.

use super::{find, friendly, run_capped, Def, Engine, FILES_DIR, PSQL, SEP, SQLCMD};
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

pub const ROW_CAP: usize = 500;
const TIME_LIMIT: Duration = Duration::from_secs(20);
const MAX_SQL_CHARS: usize = 20_000;
const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
  pub columns: Vec<String>,
  pub rows: Vec<Vec<String>>,
  /// More rows existed than `ROW_CAP`; only the first ones are shown.
  pub truncated: bool,
  pub elapsed_ms: u64,
}

/* ───────────────────────────── validation ───────────────────────────── */

const FORBIDDEN: &[&str] = &[
  "INTO", "EXEC", "EXECUTE", "OPENROWSET", "OPENQUERY", "OPENDATASOURCE", "OPENXML", "BULK", "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "CREATE", "TRUNCATE", "GRANT",
  "REVOKE", "DENY", "BACKUP", "RESTORE", "SHUTDOWN", "KILL", "DBCC", "WAITFOR", "COPY", "VACUUM", "ATTACH", "DETACH", "PRAGMA", "SET", "DO", "CALL", "LOCK", "REINDEX", "RECONFIGURE",
  "USE", "GO", "DECLARE", "DBLINK", "SET_CONFIG", "LOAD_EXTENSION", "READFILE", "WRITEFILE", "PG_SLEEP", "PG_TERMINATE_BACKEND", "PG_CANCEL_BACKEND", "PG_RELOAD_CONF",
];
const FORBIDDEN_PREFIX: &[&str] = &["XP_", "SP_", "PG_READ", "PG_LS", "PG_STAT_FILE", "LO_", "DBLINK_"];

/// Blanks out comments, string literals and quoted names, keeping every other character in place, and
/// returns (code with those blanked, the statement with comments removed). Unterminated quotes are errors.
fn scrub(sql: &str) -> Result<(String, String), String> {
  let cs: Vec<char> = sql.chars().collect();
  let (mut code, mut clean) = (String::with_capacity(cs.len()), String::with_capacity(cs.len()));
  let mut i = 0;
  while i < cs.len() {
    let c = cs[i];
    let next = cs.get(i + 1).copied();
    if c == '-' && next == Some('-') {
      while i < cs.len() && cs[i] != '\n' {
        i += 1;
      }
      code.push(' ');
      clean.push(' ');
    } else if c == '/' && next == Some('*') {
      i += 2;
      let mut closed = false;
      while i < cs.len() {
        if cs[i] == '*' && cs.get(i + 1) == Some(&'/') {
          i += 2;
          closed = true;
          break;
        }
        i += 1;
      }
      if !closed {
        return Err("A comment is not closed".into());
      }
      code.push(' ');
      clean.push(' ');
    } else if c == '\'' || c == '"' || c == '[' || c == '`' {
      let close = if c == '[' { ']' } else { c };
      clean.push(c);
      code.push(' ');
      i += 1;
      let mut closed = false;
      while i < cs.len() {
        clean.push(cs[i]);
        if cs[i] == close {
          // A doubled quote is an escaped quote, not the end.
          if cs.get(i + 1) == Some(&close) && c != '[' {
            clean.push(cs[i + 1]);
            code.push_str("  ");
            i += 2;
            continue;
          }
          closed = true;
          code.push(' ');
          i += 1;
          break;
        }
        code.push(' ');
        i += 1;
      }
      if !closed {
        return Err("A quote is not closed".into());
      }
    } else {
      code.push(c);
      clean.push(c);
      i += 1;
    }
  }
  Ok((code, clean))
}

/// Checks that `sql` is one read-only statement and returns it with comments removed and no trailing semicolon.
pub fn validate(sql: &str) -> Result<String, String> {
  if sql.chars().count() > MAX_SQL_CHARS {
    return Err("The query is too long".into());
  }
  let (code, clean) = scrub(sql)?;
  let code_t = code.trim().trim_end_matches(';').trim_end().to_string();
  let clean_t = clean.trim().trim_end_matches(';').trim_end().to_string();
  if code_t.is_empty() {
    return Err("Type a query first".into());
  }
  if code_t.contains(';') {
    return Err("One statement at a time".into());
  }
  if code_t.contains('$') {
    return Err("Dollar-quoted text is not allowed".into());
  }
  let words: Vec<String> = code_t.split(|c: char| !(c.is_alphanumeric() || c == '_')).filter(|w| !w.is_empty()).map(|w| w.to_uppercase()).collect();
  match words.first().map(String::as_str) {
    Some("SELECT") | Some("WITH") => {}
    _ => return Err("Only SELECT and WITH queries are allowed".into()),
  }
  for w in &words {
    if FORBIDDEN.contains(&w.as_str()) || FORBIDDEN_PREFIX.iter().any(|p| w.starts_with(p)) {
      return Err(format!("{w} is not allowed here"));
    }
  }
  Ok(clean_t)
}

/* ───────────────────────────── helpers ───────────────────────────── */

/// Parses CSV text into records (RFC 4180 quoting), stopping after `max` records.
pub(crate) fn parse_csv(text: &str, max: usize) -> Vec<Vec<String>> {
  let mut records: Vec<Vec<String>> = Vec::new();
  let (mut field, mut rec) = (String::new(), Vec::<String>::new());
  let (mut quoted, mut any) = (false, false);
  let mut chars = text.chars().peekable();
  while let Some(c) = chars.next() {
    any = true;
    if quoted {
      if c == '"' {
        if chars.peek() == Some(&'"') {
          field.push('"');
          chars.next();
        } else {
          quoted = false;
        }
      } else {
        field.push(c);
      }
      continue;
    }
    match c {
      '"' if field.is_empty() => quoted = true,
      ',' => rec.push(std::mem::take(&mut field)),
      '\r' => {}
      '\n' => {
        rec.push(std::mem::take(&mut field));
        records.push(std::mem::take(&mut rec));
        any = false;
        if records.len() >= max {
          return records;
        }
      }
      _ => field.push(c),
    }
  }
  if any || !field.is_empty() || !rec.is_empty() {
    rec.push(field);
    records.push(rec);
  }
  records.truncate(max);
  records
}

fn sqlite_value(v: rusqlite::types::ValueRef<'_>) -> String {
  use rusqlite::types::ValueRef::*;
  match v {
    Null => "NULL".into(),
    Integer(i) => i.to_string(),
    Real(f) => f.to_string(),
    Text(t) => String::from_utf8_lossy(t).to_string(),
    Blob(b) => format!("<{} bytes>", b.len()),
  }
}

fn short(err: &str) -> String {
  let t = err.trim();
  let known = friendly(t);
  if known != "Could not read details" {
    return known;
  }
  // The engine's own message helps with syntax errors; it stays in this window only.
  let line = t.lines().find(|l| !l.trim().is_empty()).unwrap_or("The query failed");
  line.chars().take(300).collect()
}

/* ───────────────────────────── engines ───────────────────────────── */

fn run_sql_server(d: &Def, clean: &str) -> Result<QueryResult, String> {
  let server = format!("localhost,{}", d.port);
  let sep = SEP.to_string();
  // ROWCOUNT caps the rows the server produces; the transaction is always rolled back.
  let batch = format!("SET NOCOUNT ON; SET LOCK_TIMEOUT 5000; SET ROWCOUNT {}; BEGIN TRAN; {clean}\n; ROLLBACK", ROW_CAP + 1);
  let mut cmd = Command::new(if Path::new(SQLCMD).exists() { SQLCMD } else { "sqlcmd" });
  cmd.args(["-E", "-S", &server, "-d", d.target, "-l", "10", "-t", "20", "-h", "32767", "-W", "-s", &sep, "-b", "-Q", &batch]);
  let started = Instant::now();
  let (out, err, capped) = run_capped(&mut cmd, TIME_LIMIT + Duration::from_secs(5), MAX_OUTPUT_BYTES)?;
  // sqlcmd reports errors in its normal output: "Msg 156, Level 15, State 1, ..." then the message.
  if out.trim_start().starts_with("Msg ") {
    let msg: Vec<&str> = out.lines().map(str::trim).filter(|l| !l.is_empty()).take(2).collect();
    return Err(msg.last().copied().unwrap_or("The query failed").chars().take(300).collect());
  }
  let mut lines = out.lines();
  let header = lines.next().unwrap_or("");
  let Some(_dashes) = lines.next() else {
    return Err(short(if err.trim().is_empty() { &out } else { &err }));
  };
  let columns: Vec<String> = header.split(SEP).map(|s| s.trim().to_string()).collect();
  let mut rows: Vec<Vec<String>> = Vec::new();
  for l in lines {
    let l = l.trim_end_matches('\r');
    if l.is_empty() {
      continue;
    }
    let mut r: Vec<String> = l.split(SEP).map(|s| s.to_string()).collect();
    r.resize(columns.len(), String::new());
    rows.push(r);
  }
  let truncated = capped || rows.len() > ROW_CAP;
  rows.truncate(ROW_CAP);
  Ok(QueryResult { columns, rows, truncated, elapsed_ms: started.elapsed().as_millis() as u64 })
}

fn run_postgres(d: &Def, clean: &str) -> Result<QueryResult, String> {
  let port = d.port.to_string();
  let mut cmd = Command::new(PSQL);
  cmd
    .args(["-h", "127.0.0.1", "-p", &port, "-U", "postgres", "-d", d.target, "-w", "--csv", "-v", "ON_ERROR_STOP=1", "-c", clean])
    .env("PGCONNECT_TIMEOUT", "5")
    .env("PGOPTIONS", "-c default_transaction_read_only=on -c statement_timeout=20000");
  let started = Instant::now();
  let (out, err, capped) = run_capped(&mut cmd, TIME_LIMIT + Duration::from_secs(5), MAX_OUTPUT_BYTES)?;
  if out.trim().is_empty() {
    return Err(short(&err));
  }
  let mut recs = parse_csv(&out, ROW_CAP + 2);
  if recs.is_empty() {
    return Err(short(&err));
  }
  let columns = recs.remove(0);
  let truncated = capped || recs.len() > ROW_CAP;
  recs.truncate(ROW_CAP);
  Ok(QueryResult { columns, rows: recs, truncated, elapsed_ms: started.elapsed().as_millis() as u64 })
}

fn run_on_sqlite(conn: &rusqlite::Connection, clean: &str) -> Result<QueryResult, String> {
  let started = Instant::now();
  let _ = conn.pragma_update(None, "query_only", true);
  let handle = conn.get_interrupt_handle();
  std::thread::spawn(move || {
    std::thread::sleep(TIME_LIMIT);
    handle.interrupt();
  });
  let mut st = conn.prepare(clean).map_err(|e| short(&e.to_string()))?;
  if !st.readonly() {
    return Err("Only read-only queries are allowed".into());
  }
  let columns: Vec<String> = st.column_names().into_iter().map(String::from).collect();
  let n = columns.len();
  let mut q = st.query([]).map_err(|e| short(&e.to_string()))?;
  let mut rows = Vec::new();
  let mut truncated = false;
  while let Some(r) = q.next().map_err(|e| short(&e.to_string()))? {
    if rows.len() >= ROW_CAP {
      truncated = true;
      break;
    }
    rows.push((0..n).map(|i| r.get_ref(i).map(sqlite_value).unwrap_or_default()).collect());
  }
  Ok(QueryResult { columns, rows, truncated, elapsed_ms: started.elapsed().as_millis() as u64 })
}

fn run_sqlite(d: &Def, clean: &str) -> Result<QueryResult, String> {
  let path = Path::new(FILES_DIR).join(d.target);
  let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
  let conn = rusqlite::Connection::open_with_flags(&path, flags).map_err(|_| "Could not open".to_string())?;
  run_on_sqlite(&conn, clean)
}

/// A CSV file queried as a table: loaded into a throw-away in-memory database (the file is only read).
fn run_csv(d: &Def, clean: &str) -> Result<QueryResult, String> {
  let path = Path::new(FILES_DIR).join(d.target);
  let text = std::fs::read_to_string(&path).map_err(|_| "Could not open".to_string())?;
  let mut recs = parse_csv(&text, usize::MAX);
  if recs.is_empty() {
    return Err("The file is empty".into());
  }
  let header: Vec<String> = recs.remove(0).into_iter().map(|h| h.trim_start_matches('\u{feff}').to_string()).collect();
  let conn = rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?;
  let cols = header.iter().map(|h| format!("\"{}\" TEXT", h.replace('"', "\"\""))).collect::<Vec<_>>().join(", ");
  let stem = d.target.trim_end_matches(".csv");
  for name in ["data", stem] {
    conn.execute(&format!("CREATE TABLE \"{}\" ({cols})", name.replace('"', "\"\"")), []).map_err(|e| e.to_string())?;
  }
  let marks = vec!["?"; header.len()].join(",");
  for name in ["data", stem] {
    let mut ins = conn.prepare(&format!("INSERT INTO \"{}\" VALUES ({marks})", name.replace('"', "\"\""))).map_err(|e| e.to_string())?;
    for mut r in recs.iter().cloned() {
      r.resize(header.len(), String::new());
      ins.execute(rusqlite::params_from_iter(r.iter())).map_err(|e| e.to_string())?;
    }
  }
  run_on_sqlite(&conn, clean)
}

/// Runs one validated, read-only query against one source.
#[tauri::command(async)]
pub fn anvil_query(source: String, sql: String) -> Result<QueryResult, String> {
  let d = find(&source).ok_or("Unknown source")?;
  let clean = validate(&sql)?;
  match d.engine {
    Engine::SqlServer => run_sql_server(d, &clean),
    Engine::Postgres => run_postgres(d, &clean),
    Engine::Sqlite => run_sqlite(d, &clean),
    Engine::Csv => run_csv(d, &clean),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn accepts_plain_selects_and_ctes() {
    assert_eq!(validate("select 1;").unwrap(), "select 1");
    assert!(validate("  WITH a AS (SELECT 1 x) SELECT * FROM a").is_ok());
    assert!(validate("select count(*) from patient -- how many\n").is_ok());
  }

  #[test]
  fn refuses_everything_that_writes_or_escapes() {
    for bad in [
      "insert into t values (1)",
      "update t set a=1",
      "delete from t",
      "drop table t",
      "select * into copy from t",
      "exec sp_who",
      "execute xp_cmdshell 'dir'",
      "select * from openrowset('x','y','z')",
      "select 1; select 2",
      "select 1; drop table t",
      "with a as (insert into t values (1) returning 1) select * from a",
      "select * from t for update",
      "set role x",
      "pragma writable_schema=1",
      "attach database 'x' as y",
      "copy t to program 'x'",
      "select pg_read_file('/etc/passwd')",
      "select lo_import('x')",
      "select * from dblink('a','b') as t(x int)",
      "select load_extension('x')",
      "select $$x$$",
      "",
      "   ",
      "show all",
    ] {
      assert!(validate(bad).is_err(), "should refuse: {bad}");
    }
  }

  #[test]
  fn keywords_inside_text_or_comments_are_fine() {
    assert!(validate("select 'drop table; insert into x' as note").is_ok());
    assert!(validate("select \"update\" from t").is_ok());
    assert!(validate("select [delete] from t").is_ok());
    assert!(validate("select 1 /* ; drop table t */").is_ok());
    assert!(validate("select 1 -- ; drop table t").is_ok());
  }

  #[test]
  fn a_comment_cannot_hide_a_second_statement() {
    assert!(validate("select 1; /* x */ drop table t").is_err());
    assert!(validate("select 1 /* unclosed").is_err());
    assert!(validate("select 'unclosed").is_err());
  }

  #[test]
  fn csv_parsing_handles_quotes_and_blank_ends() {
    let r = parse_csv("a,b\n\"x,1\",\"he said \"\"hi\"\"\"\n3,4", usize::MAX);
    assert_eq!(r.len(), 3);
    assert_eq!(r[1], vec!["x,1", "he said \"hi\""]);
    assert_eq!(r[2], vec!["3", "4"]);
    assert_eq!(parse_csv("a\n1\n2\n3\n", 2).len(), 2);
    assert!(parse_csv("", 5).is_empty());
  }

  #[test]
  fn sqlite_queries_run_read_only_and_cap_rows() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute("create table t (a integer, b text)", []).unwrap();
    for i in 0..(ROW_CAP + 10) {
      conn.execute("insert into t values (?, 'x')", [i as i64]).unwrap();
    }
    let r = run_on_sqlite(&conn, "select a, b from t order by a").unwrap();
    assert_eq!(r.columns, vec!["a", "b"]);
    assert_eq!(r.rows.len(), ROW_CAP);
    assert!(r.truncated);
    // Even if validation were bypassed, the connection refuses to write.
    assert!(run_on_sqlite(&conn, "insert into t values (1, 'y')").is_err());
    let after = run_on_sqlite(&conn, "select count(*) from t").unwrap();
    assert_eq!(after.rows[0][0], (ROW_CAP + 10).to_string());
  }
}
