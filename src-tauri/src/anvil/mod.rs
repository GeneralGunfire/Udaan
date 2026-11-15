//! ANVIL: the Work-mode console for the company's database estate.
//!
//! Step 1 (this file): the SOURCE REGISTRY. For each of the 11 sources on this PC it reports whether the
//! Windows service is running, whether the port answers, the engine version, size, table count and row count.
//!
//! Rules that hold for every Anvil feature:
//!   * Read-only. Nothing here writes to a database; the registry runs metadata queries only.
//!   * Counts and descriptions only. No data value ever leaves a database, is logged, or is stored.
//!   * No credentials in Udaan. SQL Server uses the Windows login of whoever runs Udaan (`sqlcmd -E`).
//!     PostgreSQL 5432 needs a password: until one is supplied through the Windows credential store the
//!     source shows "login needed". PostgreSQL 5433 allows local connections without a password.
//!   * Engines are reached with the tools that are installed (sqlcmd, psql) as short-lived child processes,
//!     so Udaan carries no database driver and no connection string.
//!
//! The source list below is topology (names, ports, services, files), measured by DEXA Forged on
//! 2026-11-11. It holds no credentials and no data.

pub(crate) mod backups;
pub(crate) mod forged;
pub(crate) mod links;
pub(crate) mod query;
pub(crate) mod schema;

use serde::Serialize;
use std::io::Read;
use std::net::{SocketAddr, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const NO_WINDOW: u32 = 0x0800_0000;
pub(crate) const SQLCMD: &str = r"C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\SQLCMD.EXE";
pub(crate) const PSQL: &str = r"C:\Program Files\PostgreSQL\16\bin\psql.exe";
pub(crate) const FILES_DIR: &str = r"C:\Database\registries";
/// Field separator for tool output: a control character that no data value contains.
pub(crate) const SEP: char = '\u{1f}';

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Engine {
  SqlServer,
  Postgres,
  Sqlite,
  Csv,
}

pub(crate) struct Def {
  pub(crate) id: &'static str,
  pub(crate) name: &'static str,
  pub(crate) engine: Engine,
  /// TCP port (0 for files).
  pub(crate) port: u16,
  /// Windows service that runs it (empty for files).
  pub(crate) service: &'static str,
  /// Database name, or file name for SQLite and CSV.
  pub(crate) target: &'static str,
}

pub(crate) fn find(id: &str) -> Option<&'static Def> {
  SOURCES.iter().find(|d| d.id == id)
}

/// A child process's stdout, read on a thread so a slow or endless tool can be stopped by size or time.
/// Returns (stdout text, stderr text, stopped early because the size limit was reached).
pub(crate) fn run_capped(cmd: &mut Command, limit: Duration, max_bytes: usize) -> Result<(String, String, bool), String> {
  use std::sync::mpsc;
  let mut child = cmd
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .creation_flags(NO_WINDOW)
    .spawn()
    .map_err(|e| format!("could not start: {e}"))?;
  let mut out = child.stdout.take().ok_or("no output")?;
  let mut err = child.stderr.take().ok_or("no output")?;
  let (tx, rx) = mpsc::channel::<Vec<u8>>();
  std::thread::spawn(move || {
    let mut buf = [0u8; 16 * 1024];
    while let Ok(n) = out.read(&mut buf) {
      if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
        break;
      }
    }
  });
  let err_thread = std::thread::spawn(move || {
    let mut s = Vec::new();
    let _ = err.by_ref().take(64 * 1024).read_to_end(&mut s);
    String::from_utf8_lossy(&s).to_string()
  });
  let started = Instant::now();
  let mut data: Vec<u8> = Vec::new();
  let mut capped = false;
  loop {
    let left = limit.checked_sub(started.elapsed()).unwrap_or_default();
    if left.is_zero() {
      let _ = child.kill();
      let _ = child.wait();
      return Err("timed out".into());
    }
    match rx.recv_timeout(left.min(Duration::from_millis(200))) {
      Ok(chunk) => {
        data.extend_from_slice(&chunk);
        if data.len() >= max_bytes {
          capped = true;
          let _ = child.kill();
          break;
        }
      }
      Err(mpsc::RecvTimeoutError::Timeout) => continue,
      Err(mpsc::RecvTimeoutError::Disconnected) => break,
    }
  }
  let _ = child.wait();
  let stderr = err_thread.join().unwrap_or_default();
  Ok((String::from_utf8_lossy(&data).to_string(), stderr, capped))
}

pub(crate) const SOURCES: [Def; 11] = [
  Def { id: "private_hospital", name: "Private hospital", engine: Engine::SqlServer, port: 1433, service: "MSSQLSERVER", target: "private_hospital" },
  Def { id: "public_hospital", name: "Public hospital", engine: Engine::SqlServer, port: 1438, service: "MSSQL$PUBHOSPITAL", target: "public_hospital" },
  Def { id: "hprs", name: "HPRS patient registry", engine: Engine::SqlServer, port: 1436, service: "MSSQL$HPRS", target: "hprs_identity" },
  Def { id: "hpcsa", name: "HPCSA practitioner register", engine: Engine::SqlServer, port: 1437, service: "MSSQL$HPCSA", target: "hpcsa_registry" },
  Def { id: "mfl_dhis2", name: "MFL and DHIS2", engine: Engine::Postgres, port: 5432, service: "postgresql-x64-16", target: "mfl_dhis2" },
  Def { id: "cms_schemes", name: "CMS medical schemes", engine: Engine::Postgres, port: 5433, service: "postgresql-cms", target: "cms_schemes" },
  Def { id: "sanc_registry", name: "SANC nursing register", engine: Engine::Sqlite, port: 0, service: "", target: "sanc_registry.db" },
  Def { id: "nhls_lab_codes", name: "NHLS laboratory codes", engine: Engine::Sqlite, port: 0, service: "", target: "nhls_lab_codes.db" },
  Def { id: "icd10_mit", name: "ICD-10 diagnosis codes", engine: Engine::Csv, port: 0, service: "", target: "icd10_mit.csv" },
  Def { id: "nappi_codes", name: "NAPPI medicine codes", engine: Engine::Csv, port: 0, service: "", target: "nappi_codes.csv" },
  Def { id: "nrpl_items", name: "NRPL tariff items", engine: Engine::Csv, port: 0, service: "", target: "nrpl_items.csv" },
];

/// What the registry shows for one source. Every field is a count, a size, a name or a state.
#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
  pub id: String,
  pub name: String,
  pub engine: String,
  /// "localhost:1433" or the file name.
  pub location: String,
  pub service: Option<String>,
  /// "running", "stopped", "starting", "stopping", "paused" or "unknown".
  pub service_state: Option<String>,
  /// The port answers (servers), or the file opens (files).
  pub up: bool,
  pub version: Option<String>,
  /// Whole database or file size in MB (SQL Server includes the log).
  pub size_mb: Option<f64>,
  /// SQL Server only: the transaction log's share of the size.
  pub log_mb: Option<f64>,
  pub tables: Option<u64>,
  pub rows: Option<u64>,
  /// Why details are missing: "Login needed", "Not reachable", and so on. Never a data value.
  pub note: Option<String>,
  pub measured_at_ms: u64,
}

fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn engine_label(d: &Def) -> String {
  match d.engine {
    Engine::SqlServer => "SQL Server",
    Engine::Postgres => "PostgreSQL",
    Engine::Sqlite => "SQLite",
    Engine::Csv => "CSV file",
  }
  .to_string()
}

/// Runs a child process with no window and a hard time limit; returns its stdout, or its stderr on failure.
fn run(cmd: &mut Command, limit: Duration) -> Result<String, String> {
  let mut child = cmd
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .creation_flags(NO_WINDOW)
    .spawn()
    .map_err(|e| format!("could not start: {e}"))?;
  let started = Instant::now();
  loop {
    match child.try_wait() {
      Ok(Some(status)) => {
        let mut out = String::new();
        let mut err = String::new();
        if let Some(mut o) = child.stdout.take() {
          let _ = o.read_to_string(&mut out);
        }
        if let Some(mut e) = child.stderr.take() {
          let _ = e.read_to_string(&mut err);
        }
        return if status.success() { Ok(out) } else { Err(if err.trim().is_empty() { out } else { err }) };
      }
      Ok(None) if started.elapsed() > limit => {
        let _ = child.kill();
        let _ = child.wait();
        return Err("timed out".into());
      }
      Ok(None) => std::thread::sleep(Duration::from_millis(40)),
      Err(e) => return Err(e.to_string()),
    }
  }
}

/// Turns a tool's error text into a short, value-free reason.
pub(crate) fn friendly(err: &str) -> String {
  let e = err.to_lowercase();
  if e.contains("login failed") || e.contains("authentication failed") || e.contains("no password supplied") || e.contains("password") {
    "Login needed".into()
  } else if e.contains("timed out") || e.contains("timeout") || e.contains("could not connect") || e.contains("connection refused") || e.contains("network-related") {
    "Not reachable".into()
  } else if e.contains("does not exist") || e.contains("cannot open database") {
    "Database not found".into()
  } else if e.contains("could not start") {
    "Tool not installed".into()
  } else {
    "Could not read details".into()
  }
}

/// The state word from `sc query` output ("STATE : 4  RUNNING").
fn parse_service_state(out: &str) -> String {
  for line in out.lines() {
    let t = line.trim();
    if t.starts_with("STATE") {
      let w = t.split_whitespace().last().unwrap_or("").to_lowercase();
      return match w.as_str() {
        "running" => "running",
        "stopped" => "stopped",
        "start_pending" => "starting",
        "stop_pending" => "stopping",
        "paused" | "pause_pending" | "continue_pending" => "paused",
        _ => "unknown",
      }
      .into();
    }
  }
  "unknown".into()
}

fn service_state(name: &str) -> String {
  match run(Command::new("sc.exe").args(["query", name]), Duration::from_secs(5)) {
    Ok(out) => parse_service_state(&out),
    Err(_) => "unknown".into(),
  }
}

fn port_answers(port: u16) -> bool {
  let addr: SocketAddr = ([127, 0, 0, 1], port).into();
  TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok()
}

/// "a|b|c" -> its fields, trimmed. Anything but a single data line gives None.
fn split_fields(out: &str, expect: usize) -> Option<Vec<String>> {
  let line = out.lines().map(str::trim).find(|l| l.contains('|'))?;
  let f: Vec<String> = line.split('|').map(|s| s.trim().to_string()).collect();
  (f.len() == expect).then_some(f)
}

fn num(s: &str) -> Option<u64> {
  s.parse::<f64>().ok().filter(|v| *v >= 0.0).map(|v| v as u64)
}

fn probe_sql_server(d: &Def, s: &mut SourceStatus) {
  // Metadata only: file sizes, table count, and the row total the engine already keeps per table.
  let q = "SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('ProductVersion') AS varchar(40)) + '|' \
    + CAST((SELECT SUM(CAST(size AS bigint)) FROM sys.database_files)*8/1024 AS varchar(20)) + '|' \
    + CAST(ISNULL((SELECT SUM(CAST(size AS bigint)) FROM sys.database_files WHERE type=1),0)*8/1024 AS varchar(20)) + '|' \
    + CAST((SELECT COUNT(*) FROM sys.tables) AS varchar(20)) + '|' \
    + CAST(ISNULL((SELECT SUM(CAST(p.rows AS bigint)) FROM sys.partitions p JOIN sys.tables t ON t.object_id=p.object_id WHERE p.index_id IN (0,1)),0) AS varchar(30))";
  let server = format!("localhost,{}", d.port);
  let mut cmd = Command::new(if Path::new(SQLCMD).exists() { SQLCMD } else { "sqlcmd" });
  cmd.args(["-E", "-S", &server, "-d", d.target, "-l", "10", "-t", "15", "-h", "-1", "-W", "-b", "-Q", q]);
  match run(&mut cmd, Duration::from_secs(25)) {
    Ok(out) => match split_fields(&out, 5) {
      Some(f) => {
        s.version = Some(f[0].clone());
        s.size_mb = f[1].parse().ok();
        s.log_mb = f[2].parse().ok();
        s.tables = num(&f[3]);
        s.rows = num(&f[4]);
      }
      None => s.note = Some("Could not read details".into()),
    },
    Err(e) => s.note = Some(friendly(&e)),
  }
}

fn probe_postgres(d: &Def, s: &mut SourceStatus) {
  let q = "select split_part(version(),' ',2) || '|' || round(pg_database_size(current_database())/1048576.0, 2) || '|' \
    || (select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE') || '|' \
    || coalesce((select sum(((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1])::text::bigint) \
       from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE'),0)";
  let port = d.port.to_string();
  let mut cmd = Command::new(PSQL);
  // -w: never prompt. PGCONNECT_TIMEOUT keeps a down server from hanging the registry.
  cmd.args(["-h", "127.0.0.1", "-p", &port, "-U", "postgres", "-d", d.target, "-w", "-At", "-F", "|", "-c", q]).env("PGCONNECT_TIMEOUT", "5");
  match run(&mut cmd, Duration::from_secs(25)) {
    Ok(out) => match split_fields(&out, 4) {
      Some(f) => {
        s.version = Some(f[0].trim_end_matches(',').to_string());
        s.size_mb = f[1].parse().ok();
        s.tables = num(&f[2]);
        s.rows = num(&f[3]);
      }
      None => s.note = Some("Could not read details".into()),
    },
    Err(e) => s.note = Some(friendly(&e)),
  }
}

fn probe_sqlite(d: &Def, s: &mut SourceStatus) {
  let path = Path::new(FILES_DIR).join(d.target);
  match std::fs::metadata(&path) {
    Ok(m) => s.size_mb = Some(m.len() as f64 / 1_048_576.0),
    Err(_) => {
      s.note = Some("File not found".into());
      return;
    }
  }
  let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
  let conn = match rusqlite::Connection::open_with_flags(&path, flags) {
    Ok(c) => c,
    Err(_) => {
      s.note = Some("Could not open".into());
      return;
    }
  };
  s.up = true;
  let names: Vec<String> = conn
    .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'")
    .and_then(|mut st| st.query_map([], |r| r.get::<_, String>(0)).map(|it| it.flatten().collect()))
    .unwrap_or_default();
  s.tables = Some(names.len() as u64);
  let mut rows = 0u64;
  for n in &names {
    let sql = format!("select count(*) from \"{}\"", n.replace('"', "\"\""));
    rows += conn.query_row(&sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0).max(0) as u64;
  }
  s.rows = Some(rows);
}

/// Data rows in a CSV: lines minus the header. Counts bytes only; no value is read into a string.
fn csv_rows(path: &Path) -> std::io::Result<u64> {
  let mut f = std::fs::File::open(path)?;
  let mut buf = [0u8; 64 * 1024];
  let (mut lines, mut last, mut any) = (0u64, 0u8, false);
  loop {
    let n = f.read(&mut buf)?;
    if n == 0 {
      break;
    }
    any = true;
    lines += buf[..n].iter().filter(|b| **b == b'\n').count() as u64;
    last = buf[n - 1];
  }
  if any && last != b'\n' {
    lines += 1;
  }
  Ok(lines.saturating_sub(1))
}

fn probe_csv(d: &Def, s: &mut SourceStatus) {
  let path = Path::new(FILES_DIR).join(d.target);
  match std::fs::metadata(&path) {
    Ok(m) => s.size_mb = Some(m.len() as f64 / 1_048_576.0),
    Err(_) => {
      s.note = Some("File not found".into());
      return;
    }
  }
  match csv_rows(&path) {
    Ok(n) => {
      s.up = true;
      s.tables = Some(1);
      s.rows = Some(n);
    }
    Err(_) => s.note = Some("Could not open".into()),
  }
}

fn probe(d: &Def) -> SourceStatus {
  let mut s = SourceStatus {
    id: d.id.into(),
    name: d.name.into(),
    engine: engine_label(d),
    location: if d.port > 0 { format!("localhost:{}", d.port) } else { d.target.into() },
    measured_at_ms: now_ms(),
    ..Default::default()
  };
  match d.engine {
    Engine::SqlServer | Engine::Postgres => {
      s.service = Some(d.service.into());
      s.service_state = Some(service_state(d.service));
      s.up = port_answers(d.port);
      if !s.up {
        s.note = Some("Not reachable".into());
      } else if d.engine == Engine::SqlServer {
        probe_sql_server(d, &mut s);
      } else {
        probe_postgres(d, &mut s);
      }
    }
    Engine::Sqlite => probe_sqlite(d, &mut s),
    Engine::Csv => probe_csv(d, &mut s),
  }
  s
}

/// The registry: every source, measured now, in parallel. Takes a few seconds (the big database is the slow one).
#[tauri::command(async)]
pub fn anvil_sources() -> Vec<SourceStatus> {
  std::thread::scope(|scope| {
    let handles: Vec<_> = SOURCES.iter().map(|d| (d, scope.spawn(move || probe(d)))).collect();
    handles
      .into_iter()
      .map(|(d, h)| {
        h.join().unwrap_or_else(|_| SourceStatus {
          id: d.id.into(),
          name: d.name.into(),
          engine: engine_label(d),
          note: Some("Could not read details".into()),
          ..Default::default()
        })
      })
      .collect()
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_the_service_state_word() {
    assert_eq!(parse_service_state("SERVICE_NAME: x\n        STATE              : 4  RUNNING \n"), "running");
    assert_eq!(parse_service_state("        STATE              : 1  STOPPED"), "stopped");
    assert_eq!(parse_service_state("        STATE              : 2  START_PENDING"), "starting");
    assert_eq!(parse_service_state("nothing useful"), "unknown");
  }

  #[test]
  fn splits_one_data_line() {
    let f = split_fields("\r\n16.0.1210.3|9872|9288|197|1890557\r\n", 5).unwrap();
    assert_eq!(f[3], "197");
    assert!(split_fields("16.0|1|2", 5).is_none());
    assert!(split_fields("no separator here", 5).is_none());
  }

  #[test]
  fn numbers_ignore_decimals_and_junk() {
    assert_eq!(num("1890557"), Some(1_890_557));
    assert_eq!(num("12.0"), Some(12));
    assert_eq!(num("abc"), None);
  }

  #[test]
  fn error_text_becomes_a_short_reason_without_values() {
    assert_eq!(friendly("Login failed for user 'X'"), "Login needed");
    assert_eq!(friendly("psql: fe_sendauth: no password supplied"), "Login needed");
    assert_eq!(friendly("connection refused"), "Not reachable");
    assert_eq!(friendly("something odd"), "Could not read details");
  }

  #[test]
  fn csv_rows_exclude_the_header() {
    let dir = std::env::temp_dir().join(format!("anvil-csv-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let a = dir.join("a.csv");
    std::fs::write(&a, "h1,h2\n1,2\n3,4\n").unwrap();
    assert_eq!(csv_rows(&a).unwrap(), 2);
    let b = dir.join("b.csv");
    std::fs::write(&b, "h1\nx").unwrap(); // no trailing newline
    assert_eq!(csv_rows(&b).unwrap(), 1);
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn the_source_list_matches_forged() {
    assert_eq!(SOURCES.len(), 11);
    assert_eq!(SOURCES.iter().filter(|d| d.engine == Engine::SqlServer).count(), 4);
    assert_eq!(SOURCES.iter().filter(|d| d.engine == Engine::Postgres).count(), 2);
    let mut ports: Vec<u16> = SOURCES.iter().filter(|d| d.port > 0).map(|d| d.port).collect();
    ports.sort();
    assert_eq!(ports, vec![1433, 1436, 1437, 1438, 5432, 5433]);
  }
}
