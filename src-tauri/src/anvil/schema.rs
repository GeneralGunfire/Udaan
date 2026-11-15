//! ANVIL step 2a: the schema browser. Tables, columns, types, keys and row counts for one source.
//! Structure and counts only: no data value is read.

use super::{find, friendly, run_capped, Def, Engine, FILES_DIR, PSQL, SEP, SQLCMD};
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Column {
  pub name: String,
  pub data_type: String,
  pub nullable: bool,
  pub key: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
  pub schema: String,
  pub name: String,
  pub rows: Option<u64>,
  /// Foreign keys this table declares towards others.
  pub fks_out: u32,
  pub columns: Vec<Column>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
  pub source: String,
  pub tables: Vec<TableInfo>,
}

const SQL_SERVER: &str = "SET NOCOUNT ON; \
SELECT s.name, t.name, \
 CAST(ISNULL((SELECT SUM(CAST(p.rows AS bigint)) FROM sys.partitions p WHERE p.object_id=t.object_id AND p.index_id IN (0,1)),0) AS varchar(30)), \
 c.name, \
 ty.name + CASE WHEN ty.name IN ('varchar','nvarchar','char','nchar','varbinary','binary') THEN '(' + CASE WHEN c.max_length=-1 THEN 'max' WHEN ty.name IN ('nvarchar','nchar') THEN CAST(c.max_length/2 AS varchar(10)) ELSE CAST(c.max_length AS varchar(10)) END + ')' \
   WHEN ty.name IN ('decimal','numeric') THEN '(' + CAST(c.precision AS varchar(5)) + ',' + CAST(c.scale AS varchar(5)) + ')' ELSE '' END, \
 CAST(c.is_nullable AS varchar(1)), \
 CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i ON i.object_id=ic.object_id AND i.index_id=ic.index_id WHERE i.is_primary_key=1 AND ic.object_id=c.object_id AND ic.column_id=c.column_id) THEN '1' ELSE '0' END, \
 CAST((SELECT COUNT(*) FROM sys.foreign_keys f WHERE f.parent_object_id=t.object_id) AS varchar(10)) \
FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id \
ORDER BY s.name, t.name, c.column_id";

const POSTGRES: &str = "with t as (select table_schema s, table_name n, \
   ((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1])::text r \
   from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE') \
select c.table_schema, c.table_name, t.r, c.column_name, \
 c.data_type || coalesce('(' || c.character_maximum_length || ')', ''), \
 (c.is_nullable='YES')::int, \
 (exists (select 1 from information_schema.table_constraints tc join information_schema.key_column_usage k on k.constraint_name=tc.constraint_name and k.table_schema=tc.table_schema \
   where tc.constraint_type='PRIMARY KEY' and tc.table_schema=c.table_schema and tc.table_name=c.table_name and k.column_name=c.column_name))::int, \
 (select count(*) from information_schema.table_constraints tc where tc.constraint_type='FOREIGN KEY' and tc.table_schema=c.table_schema and tc.table_name=c.table_name) \
from information_schema.columns c join t on t.s=c.table_schema and t.n=c.table_name \
order by c.table_schema, c.table_name, c.ordinal_position";

/// Groups flat "schema|table|rows|column|type|nullable|key|fks" lines into tables, keeping their order.
pub(crate) fn group_rows(out: &str) -> Vec<TableInfo> {
  let mut tables: Vec<TableInfo> = Vec::new();
  for line in out.lines() {
    let f: Vec<&str> = line.trim_end_matches('\r').split(SEP).collect();
    if f.len() != 8 {
      continue;
    }
    let col = Column { name: f[3].trim().into(), data_type: f[4].trim().into(), nullable: matches!(f[5].trim(), "1" | "t" | "true"), key: matches!(f[6].trim(), "1" | "t" | "true") };
    match tables.last_mut() {
      Some(t) if t.schema == f[0].trim() && t.name == f[1].trim() => t.columns.push(col),
      _ => tables.push(TableInfo {
        schema: f[0].trim().into(),
        name: f[1].trim().into(),
        rows: f[2].trim().parse::<f64>().ok().map(|v| v as u64),
        fks_out: f[7].trim().parse().unwrap_or(0),
        columns: vec![col],
      }),
    }
  }
  tables
}

fn sql_server(d: &Def) -> Result<Vec<TableInfo>, String> {
  let server = format!("localhost,{}", d.port);
  let sep = SEP.to_string();
  let mut cmd = Command::new(if Path::new(SQLCMD).exists() { SQLCMD } else { "sqlcmd" });
  cmd.args(["-E", "-S", &server, "-d", d.target, "-l", "10", "-t", "30", "-h", "-1", "-W", "-s", &sep, "-b", "-Q", SQL_SERVER]);
  let (out, err, _) = run_capped(&mut cmd, Duration::from_secs(45), 16 * 1024 * 1024)?;
  let tables = group_rows(&out);
  if tables.is_empty() && !err.trim().is_empty() {
    return Err(friendly(&err));
  }
  Ok(tables)
}

fn postgres(d: &Def) -> Result<Vec<TableInfo>, String> {
  let port = d.port.to_string();
  let sep = SEP.to_string();
  let mut cmd = Command::new(PSQL);
  cmd
    .args(["-h", "127.0.0.1", "-p", &port, "-U", "postgres", "-d", d.target, "-w", "-At", "-F", &sep, "-c", POSTGRES])
    .env("PGCONNECT_TIMEOUT", "5")
    .env("PGOPTIONS", "-c default_transaction_read_only=on -c statement_timeout=30000");
  let (out, err, _) = run_capped(&mut cmd, Duration::from_secs(45), 16 * 1024 * 1024)?;
  let tables = group_rows(&out);
  if tables.is_empty() && !err.trim().is_empty() {
    return Err(friendly(&err));
  }
  Ok(tables)
}

fn sqlite(d: &Def) -> Result<Vec<TableInfo>, String> {
  let path = Path::new(FILES_DIR).join(d.target);
  let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX;
  let conn = rusqlite::Connection::open_with_flags(&path, flags).map_err(|_| "Could not open".to_string())?;
  let names: Vec<String> = conn
    .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")
    .and_then(|mut st| st.query_map([], |r| r.get::<_, String>(0)).map(|it| it.flatten().collect()))
    .map_err(|e| e.to_string())?;
  let mut tables = Vec::new();
  for n in names {
    let q = n.replace('\'', "''");
    let mut columns = Vec::new();
    {
      let mut st = conn.prepare(&format!("select name, type, \"notnull\", pk from pragma_table_info('{q}')")).map_err(|e| e.to_string())?;
      let rows = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?)))
        .map_err(|e| e.to_string())?;
      for r in rows.flatten() {
        columns.push(Column { name: r.0, data_type: if r.1.is_empty() { "any".into() } else { r.1.to_lowercase() }, nullable: r.2 == 0, key: r.3 > 0 });
      }
    }
    let rows: i64 = conn.query_row(&format!("select count(*) from \"{}\"", n.replace('"', "\"\"")), [], |r| r.get(0)).unwrap_or(0);
    let fks: i64 = conn.query_row(&format!("select count(distinct id) from pragma_foreign_key_list('{q}')"), [], |r| r.get(0)).unwrap_or(0);
    tables.push(TableInfo { schema: "main".into(), name: n, rows: Some(rows.max(0) as u64), fks_out: fks.max(0) as u32, columns });
  }
  Ok(tables)
}

fn csv(d: &Def) -> Result<Vec<TableInfo>, String> {
  let path = Path::new(FILES_DIR).join(d.target);
  let text = std::fs::read_to_string(&path).map_err(|_| "Could not open".to_string())?;
  let first = text.lines().next().unwrap_or("");
  let header = super::query::parse_csv(first, 1).into_iter().next().unwrap_or_default();
  let rows = super::query::parse_csv(&text, usize::MAX).len().saturating_sub(1) as u64;
  let columns = header.into_iter().map(|name| Column { name: name.trim_start_matches('\u{feff}').to_string(), data_type: "text".into(), nullable: true, key: false }).collect();
  Ok(vec![TableInfo { schema: "file".into(), name: d.target.trim_end_matches(".csv").into(), rows: Some(rows), fks_out: 0, columns }])
}

/// Tables, columns, types, keys and row counts for one source.
#[tauri::command(async)]
pub fn anvil_schema(source: String) -> Result<SchemaInfo, String> {
  let d = find(&source).ok_or("Unknown source")?;
  let tables = match d.engine {
    Engine::SqlServer => sql_server(d)?,
    Engine::Postgres => postgres(d)?,
    Engine::Sqlite => sqlite(d)?,
    Engine::Csv => csv(d)?,
  };
  Ok(SchemaInfo { source, tables })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn groups_flat_lines_into_tables() {
    let s = SEP;
    let out = format!("dbo{s}patient{s}15000{s}patient_id{s}bigint{s}0{s}1{s}0\r\ndbo{s}patient{s}15000{s}surname{s}nvarchar(100){s}0{s}0{s}0\r\ndbo{s}patient_address{s}15000{s}address_id{s}bigint{s}0{s}1{s}1\r\n");
    let t = group_rows(&out);
    assert_eq!(t.len(), 2);
    assert_eq!(t[0].columns.len(), 2);
    assert!(t[0].columns[0].key && !t[0].columns[1].key);
    assert_eq!(t[0].rows, Some(15000));
    assert_eq!(t[1].fks_out, 1);
  }

  #[test]
  fn ignores_lines_that_are_not_data() {
    assert!(group_rows("Msg 208, Level 16\nnot|enough\n").is_empty());
  }
}
