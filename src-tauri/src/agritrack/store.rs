use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde_json::Value;

use crate::db::configure_connection;

/// Every table this store owns, in the exact order the schema below
/// creates them — also doubles as the allowlist `agritrack_query_table`
/// validates against, so a caller can never inject an arbitrary table
/// name into the generated SQL.
pub const KNOWN_TABLES: &[&str] = &[
  "locations",
  "crops",
  "soil_properties",
  "crop_water_coefficients",
  "historical_climate_normals",
  "crop_yield_history",
  "daily_weather",
  "daily_crop_telemetry",
  "daily_economic",
  "disease_bulletins",
  "collection_log",
];

pub struct Store {
  conn: Mutex<Connection>,
}

impl Store {
  pub fn open(db_path: PathBuf) -> rusqlite::Result<Self> {
    let conn = Connection::open(db_path)?;
    configure_connection(&conn)?;
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS locations (
        location_id INTEGER PRIMARY KEY,
        province TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crops (
        crop_id INTEGER PRIMARY KEY,
        crop_name TEXT NOT NULL,
        location_id INTEGER REFERENCES locations(location_id),
        crop_latitude REAL,
        crop_longitude REAL,
        base_temp_c REAL,
        planting_date DATE
      );
      CREATE TABLE IF NOT EXISTS soil_properties (
        crop_id INTEGER REFERENCES crops(crop_id),
        soil_ph REAL,
        soil_texture TEXT,
        organic_carbon_pct REAL,
        elevation_m REAL
      );
      CREATE TABLE IF NOT EXISTS crop_water_coefficients (
        crop_name TEXT PRIMARY KEY,
        kc_initial REAL,
        kc_mid REAL,
        kc_late REAL,
        maturity_gdd_threshold REAL
      );
      CREATE TABLE IF NOT EXISTS historical_climate_normals (
        location_id INTEGER REFERENCES locations(location_id),
        day_of_year INTEGER,
        avg_rainfall_mm REAL,
        avg_temp_c REAL
      );
      CREATE TABLE IF NOT EXISTS crop_yield_history (
        crop_name TEXT,
        province TEXT,
        year INTEGER,
        yield_tonnes_per_ha REAL
      );
      CREATE TABLE IF NOT EXISTS daily_weather (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id INTEGER REFERENCES locations(location_id),
        date DATE NOT NULL,
        rainfall_mm REAL,
        temp_min_c REAL,
        temp_max_c REAL,
        humidity_pct REAL,
        evapotranspiration_mm REAL,
        solar_radiation REAL,
        soil_moisture_est REAL,
        rainfall_deficit_30d REAL,
        data_source TEXT,
        retrieved_at DATETIME,
        UNIQUE(location_id, date)
      );
      CREATE TABLE IF NOT EXISTS daily_crop_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crop_id INTEGER REFERENCES crops(crop_id),
        date DATE NOT NULL,
        ndvi_value REAL,
        ndvi_age_days INTEGER,
        water_stress_gap REAL,
        gdd_accumulated REAL,
        frost_risk_flag BOOLEAN,
        heat_stress_flag BOOLEAN,
        data_source TEXT,
        retrieved_at DATETIME,
        UNIQUE(crop_id, date)
      );
      CREATE TABLE IF NOT EXISTS daily_economic (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE NOT NULL,
        zar_usd_rate REAL,
        inflation_rate REAL,
        maize_price_safex REAL,
        data_source TEXT,
        retrieved_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS disease_bulletins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_found DATE,
        date_published DATE,
        category TEXT,
        disease_name TEXT,
        province_affected TEXT,
        source_url TEXT,
        summary TEXT
      );
      CREATE TABLE IF NOT EXISTS collection_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_date DATE,
        run_timestamp DATETIME,
        sources_succeeded TEXT,
        sources_failed TEXT,
        notes TEXT
      );",
    )?;

    let store = Self { conn: Mutex::new(conn) };
    store.seed_if_empty()?;
    Ok(store)
  }

  /// Reference data (locations/crops/water coefficients) is static and
  /// only needs to exist once — checked via `locations` row count so a
  /// second launch against an already-seeded DB is a no-op.
  fn seed_if_empty(&self) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM locations", [], |r| r.get(0))?;
    if count > 0 {
      return Ok(());
    }

    for (province, lat, lon) in PROVINCES {
      conn.execute(
        "INSERT INTO locations (province, latitude, longitude) VALUES (?1, ?2, ?3)",
        params![province, lat, lon],
      )?;
    }

    for (crop_name, province, lat, lon, base_temp_c, planting_date) in CROPS {
      let location_id: i64 = conn.query_row(
        "SELECT location_id FROM locations WHERE province = ?1",
        params![province],
        |r| r.get(0),
      )?;
      conn.execute(
        "INSERT INTO crops (crop_name, location_id, crop_latitude, crop_longitude, base_temp_c, planting_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![crop_name, location_id, lat, lon, base_temp_c, planting_date],
      )?;
    }

    for (crop_name, kc_initial, kc_mid, kc_late, gdd_threshold) in WATER_COEFFICIENTS {
      conn.execute(
        "INSERT OR IGNORE INTO crop_water_coefficients (crop_name, kc_initial, kc_mid, kc_late, maturity_gdd_threshold)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![crop_name, kc_initial, kc_mid, kc_late, gdd_threshold],
      )?;
    }

    Ok(())
  }

  /// Generic read path for the table-view frontend. `table` MUST come
  /// from `KNOWN_TABLES` (checked by the caller in mod.rs) since it is
  /// interpolated directly into the SQL string — rusqlite has no bind
  /// parameter for identifiers.
  pub fn query_table(
    &self,
    table: &str,
    date_from: Option<&str>,
    date_to: Option<&str>,
    province: Option<&str>,
    crop_name: Option<&str>,
    limit: i64,
  ) -> rusqlite::Result<Vec<Value>> {
    let conn = self.conn.lock().unwrap();

    let (select, joins, date_col) = match table {
      "locations" => ("locations.*", String::new(), None),
      "crops" => (
        "crops.*, locations.province AS province",
        " LEFT JOIN locations ON locations.location_id = crops.location_id".to_string(),
        None,
      ),
      "soil_properties" => (
        "soil_properties.*, crops.crop_name AS crop_name",
        " LEFT JOIN crops ON crops.crop_id = soil_properties.crop_id".to_string(),
        None,
      ),
      "crop_water_coefficients" => ("crop_water_coefficients.*", String::new(), None),
      "historical_climate_normals" => (
        "historical_climate_normals.*, locations.province AS province",
        " LEFT JOIN locations ON locations.location_id = historical_climate_normals.location_id".to_string(),
        None,
      ),
      "crop_yield_history" => ("crop_yield_history.*", String::new(), None),
      "daily_weather" => (
        "daily_weather.*, locations.province AS province",
        " LEFT JOIN locations ON locations.location_id = daily_weather.location_id".to_string(),
        Some("daily_weather.date"),
      ),
      "daily_crop_telemetry" => (
        "daily_crop_telemetry.*, crops.crop_name AS crop_name, locations.province AS province",
        " LEFT JOIN crops ON crops.crop_id = daily_crop_telemetry.crop_id\
          LEFT JOIN locations ON locations.location_id = crops.location_id"
          .to_string(),
        Some("daily_crop_telemetry.date"),
      ),
      "daily_economic" => ("daily_economic.*", String::new(), Some("daily_economic.date")),
      "disease_bulletins" => ("disease_bulletins.*", String::new(), Some("disease_bulletins.date_found")),
      "collection_log" => ("collection_log.*", String::new(), Some("collection_log.run_date")),
      _ => return Ok(Vec::new()),
    };

    let mut sql = format!("SELECT {select} FROM {table}{joins}");
    let mut conditions: Vec<String> = Vec::new();
    let mut bind: Vec<String> = Vec::new();

    if let (Some(col), Some(from)) = (date_col, date_from) {
      conditions.push(format!("{col} >= ?"));
      bind.push(from.to_string());
    }
    if let (Some(col), Some(to)) = (date_col, date_to) {
      conditions.push(format!("{col} <= ?"));
      bind.push(to.to_string());
    }
    if let Some(p) = province {
      if matches!(table, "crops" | "daily_weather" | "daily_crop_telemetry" | "historical_climate_normals") {
        conditions.push("locations.province = ?".to_string());
        bind.push(p.to_string());
      }
    }
    if let Some(c) = crop_name {
      if matches!(table, "daily_crop_telemetry" | "soil_properties") {
        conditions.push("crops.crop_name = ?".to_string());
        bind.push(c.to_string());
      } else if table == "crop_water_coefficients" || table == "crop_yield_history" {
        conditions.push("crop_name = ?".to_string());
        bind.push(c.to_string());
      }
    }

    if !conditions.is_empty() {
      sql.push_str(" WHERE ");
      sql.push_str(&conditions.join(" AND "));
    }
    if let Some(col) = date_col {
      sql.push_str(&format!(" ORDER BY {col} DESC"));
    }
    sql.push_str(" LIMIT ?");
    bind.push(limit.to_string());

    let mut stmt = conn.prepare(&sql)?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let bind_refs: Vec<&dyn rusqlite::ToSql> = bind.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

    let rows = stmt.query_map(bind_refs.as_slice(), |row| {
      let mut obj = serde_json::Map::new();
      for (i, name) in col_names.iter().enumerate() {
        let value: Value = match row.get_ref(i)? {
          rusqlite::types::ValueRef::Null => Value::Null,
          rusqlite::types::ValueRef::Integer(n) => Value::from(n),
          rusqlite::types::ValueRef::Real(f) => Value::from(f),
          rusqlite::types::ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).to_string()),
          rusqlite::types::ValueRef::Blob(_) => Value::Null,
        };
        obj.insert(name.clone(), value);
      }
      Ok(Value::Object(obj))
    })?;

    let mut out = Vec::new();
    for r in rows {
      out.push(r?);
    }
    Ok(out)
  }

  /// Every date that has weather data, ascending — the map's time
  /// slider domain. Returned as plain strings so the frontend doesn't
  /// have to guess at a range that may have gaps in it.
  pub fn available_dates(&self) -> rusqlite::Result<Vec<String>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare("SELECT DISTINCT date FROM daily_weather ORDER BY date ASC")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut out = Vec::new();
    for r in rows {
      out.push(r?);
    }
    Ok(out)
  }

  /// One row per province for a single date, with the crop-level
  /// telemetry already aggregated — what the map's extruded columns,
  /// heatmap and tooltips all read from.
  ///
  /// Aggregating here rather than in the frontend keeps the payload to
  /// nine rows per frame, which matters when the time slider is playing
  /// and this is re-queried on every tick.
  pub fn province_snapshot(&self, target: &str) -> rusqlite::Result<Vec<Value>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT
         l.location_id,
         l.province,
         l.latitude,
         l.longitude,
         w.date,
         w.rainfall_mm,
         w.temp_min_c,
         w.temp_max_c,
         w.humidity_pct,
         w.evapotranspiration_mm,
         w.solar_radiation,
         w.soil_moisture_est,
         w.rainfall_deficit_30d,
         (SELECT COUNT(*) FROM crops c WHERE c.location_id = l.location_id) AS crop_count,
         t.avg_ndvi,
         t.min_ndvi_age,
         t.avg_water_stress,
         t.avg_gdd,
         t.frost_crops,
         t.heat_crops,
         t.ndvi_crops
       FROM locations l
       LEFT JOIN daily_weather w
         ON w.location_id = l.location_id AND w.date = ?1
       LEFT JOIN (
         SELECT
           c.location_id,
           AVG(dt.ndvi_value) AS avg_ndvi,
           MIN(dt.ndvi_age_days) AS min_ndvi_age,
           AVG(dt.water_stress_gap) AS avg_water_stress,
           AVG(dt.gdd_accumulated) AS avg_gdd,
           SUM(CASE WHEN dt.frost_risk_flag THEN 1 ELSE 0 END) AS frost_crops,
           SUM(CASE WHEN dt.heat_stress_flag THEN 1 ELSE 0 END) AS heat_crops,
           SUM(CASE WHEN dt.ndvi_value IS NOT NULL THEN 1 ELSE 0 END) AS ndvi_crops
         FROM daily_crop_telemetry dt
         JOIN crops c ON c.crop_id = dt.crop_id
         WHERE dt.date = ?1
         GROUP BY c.location_id
       ) t ON t.location_id = l.location_id
       ORDER BY l.province",
    )?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(rusqlite::params![target], |row| Self::row_to_json(row, &col_names))?;
    let mut out = Vec::new();
    for r in rows {
      out.push(r?);
    }
    Ok(out)
  }

  /// Per-crop detail for one province on one date — the click-to-expand
  /// panel. Includes the crop's own coordinate so the panel can say
  /// where in the province the reading actually came from.
  pub fn crop_detail(&self, province: &str, target: &str) -> rusqlite::Result<Vec<Value>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
      "SELECT
         c.crop_id,
         c.crop_name,
         c.crop_latitude,
         c.crop_longitude,
         c.base_temp_c,
         c.planting_date,
         k.maturity_gdd_threshold,
         t.date,
         t.ndvi_value,
         t.ndvi_age_days,
         t.water_stress_gap,
         t.gdd_accumulated,
         t.frost_risk_flag,
         t.heat_stress_flag
       FROM crops c
       JOIN locations l ON l.location_id = c.location_id
       LEFT JOIN crop_water_coefficients k ON k.crop_name = c.crop_name
       LEFT JOIN daily_crop_telemetry t ON t.crop_id = c.crop_id AND t.date = ?2
       WHERE l.province = ?1
       ORDER BY c.crop_name",
    )?;
    let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map(rusqlite::params![province, target], |row| {
      Self::row_to_json(row, &col_names)
    })?;
    let mut out = Vec::new();
    for r in rows {
      out.push(r?);
    }
    Ok(out)
  }

  fn row_to_json(row: &rusqlite::Row, col_names: &[String]) -> rusqlite::Result<Value> {
    let mut obj = serde_json::Map::new();
    for (i, name) in col_names.iter().enumerate() {
      let value: Value = match row.get_ref(i)? {
        rusqlite::types::ValueRef::Null => Value::Null,
        rusqlite::types::ValueRef::Integer(n) => Value::from(n),
        rusqlite::types::ValueRef::Real(f) => Value::from(f),
        rusqlite::types::ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).to_string()),
        rusqlite::types::ValueRef::Blob(_) => Value::Null,
      };
      obj.insert(name.clone(), value);
    }
    Ok(Value::Object(obj))
  }

  pub fn latest_collection_log(&self) -> rusqlite::Result<Option<Value>> {
    let rows = self.query_table("collection_log", None, None, None, None, 1)?;
    Ok(rows.into_iter().next())
  }
}

/// (province, latitude, longitude) — representative coordinate for each
/// province's main tracked agricultural region (not necessarily the
/// province's geographic or administrative centre).
const PROVINCES: &[(&str, f64, f64)] = &[
  ("Eastern Cape", -33.5, 25.3),
  ("Free State", -28.5, 26.9),
  ("Gauteng", -25.8, 28.6),
  ("KwaZulu-Natal", -29.2, 31.4),
  ("Limpopo", -23.8, 30.2),
  ("Mpumalanga", -25.5, 30.9),
  ("North West", -26.1, 26.2),
  ("Northern Cape", -28.5, 21.3),
  ("Western Cape", -33.4, 18.8),
];

/// (crop_name, province, crop_latitude, crop_longitude, base_temp_c, planting_date)
/// Coordinates point at the crop's specific growing area within the
/// province where that differs meaningfully from the province-level
/// coordinate above (e.g. Western Cape wine grapes -> Breede River
/// Valley, not the Swartland wheat belt used for the province row).
/// planting_date is a representative date for the most recent SA
/// planting season for that crop.
const CROPS: &[(&str, &str, f64, f64, f64, &str)] = &[
  // Eastern Cape
  ("Citrus", "Eastern Cape", -33.6, 25.35, 13.0, "2025-08-01"),
  ("Apples", "Eastern Cape", -33.85, 23.6, 7.0, "2025-08-15"),
  ("Pineapples", "Eastern Cape", -33.5, 26.85, 15.0, "2025-09-01"),
  ("Maize", "Eastern Cape", -32.3, 27.4, 10.0, "2025-11-01"),
  // Free State
  ("Maize", "Free State", -28.5, 26.9, 10.0, "2025-11-01"),
  ("Wheat", "Free State", -29.0, 26.7, 4.5, "2025-05-15"),
  ("Sunflower", "Free State", -28.3, 27.2, 7.0, "2025-11-15"),
  ("Vegetables", "Free State", -29.1, 26.2, 8.0, "2025-09-01"),
  // Gauteng
  ("Vegetables", "Gauteng", -25.8, 28.6, 8.0, "2025-09-01"),
  ("Sunflower", "Gauteng", -25.8, 28.9, 7.0, "2025-11-15"),
  ("Maize", "Gauteng", -25.9, 28.3, 10.0, "2025-11-01"),
  // KwaZulu-Natal
  ("Sugarcane", "KwaZulu-Natal", -29.2, 31.4, 10.0, "2025-08-01"),
  ("Pineapples", "KwaZulu-Natal", -28.75, 32.05, 15.0, "2025-09-01"),
  ("Maize", "KwaZulu-Natal", -29.5, 30.4, 10.0, "2025-10-15"),
  // Limpopo
  ("Citrus", "Limpopo", -23.83, 30.16, 13.0, "2025-08-01"),
  ("Mangoes", "Limpopo", -23.6, 30.5, 12.0, "2025-08-15"),
  ("Bananas", "Limpopo", -23.9, 30.2, 14.0, "2025-09-01"),
  ("Tomatoes", "Limpopo", -23.7, 29.5, 10.0, "2025-08-15"),
  ("Potatoes", "Limpopo", -24.7, 28.9, 7.0, "2025-09-01"),
  // Mpumalanga
  ("Citrus", "Mpumalanga", -25.3, 31.0, 13.0, "2025-08-01"),
  ("Maize", "Mpumalanga", -25.9, 29.9, 10.0, "2025-11-01"),
  ("Bananas", "Mpumalanga", -25.35, 31.05, 14.0, "2025-09-01"),
  ("Potatoes", "Mpumalanga", -25.9, 30.1, 7.0, "2025-09-01"),
  // North West
  ("Maize", "North West", -26.15, 26.15, 10.0, "2025-11-01"),
  ("Sunflower", "North West", -25.8, 25.6, 7.0, "2025-11-15"),
  // Northern Cape
  ("Table grapes", "Northern Cape", -28.45, 21.25, 10.0, "2025-08-15"),
  ("Wheat", "Northern Cape", -29.6, 22.2, 4.5, "2025-05-15"),
  ("Lucerne", "Northern Cape", -28.7, 21.9, 5.0, "2025-03-01"),
  // Western Cape
  ("Wine grapes", "Western Cape", -33.85, 19.3, 10.0, "2025-09-01"),
  ("Apples", "Western Cape", -33.6, 19.3, 7.0, "2025-08-15"),
  ("Wheat", "Western Cape", -33.4, 18.8, 4.5, "2025-05-15"),
  ("Canola", "Western Cape", -33.2, 18.9, 5.0, "2025-05-01"),
  ("Onions", "Western Cape", -33.7, 18.95, 6.0, "2025-08-01"),
];

/// (crop_name, kc_initial, kc_mid, kc_late, maturity_gdd_threshold) —
/// standard FAO-56 single crop coefficients (Allen et al. 1998, Table 12)
/// per unique crop name; maturity_gdd_threshold is a representative
/// cumulative GDD (base temp as above) at physiological maturity.
const WATER_COEFFICIENTS: &[(&str, f64, f64, f64, f64)] = &[
  ("Citrus", 0.70, 0.65, 0.70, 3000.0),
  ("Apples", 0.45, 0.95, 0.70, 1800.0),
  ("Pineapples", 0.50, 0.30, 0.30, 3500.0),
  ("Maize", 0.30, 1.20, 0.60, 1400.0),
  ("Wheat", 0.30, 1.15, 0.25, 1700.0),
  ("Sunflower", 0.35, 1.10, 0.35, 1500.0),
  ("Vegetables", 0.60, 1.00, 0.80, 1000.0),
  ("Sugarcane", 0.40, 1.25, 0.75, 5000.0),
  ("Mangoes", 0.60, 0.75, 0.70, 3200.0),
  ("Bananas", 0.50, 1.10, 1.00, 3000.0),
  ("Tomatoes", 0.60, 1.15, 0.80, 1300.0),
  ("Potatoes", 0.50, 1.15, 0.75, 1300.0),
  ("Table grapes", 0.30, 0.85, 0.45, 2000.0),
  ("Wine grapes", 0.30, 0.70, 0.45, 1800.0),
  ("Lucerne", 0.40, 0.95, 0.90, 900.0),
  ("Canola", 0.35, 1.15, 0.35, 1600.0),
  ("Onions", 0.70, 1.05, 0.75, 1200.0),
];
