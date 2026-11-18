//! TV catalogue and library (src/os/apps/tv).
//!
//! The catalogue is Apple's public iTunes feeds and search: no key, no account. A title's
//! full details (runtime, rating, trailer) come from a lookup. The user's library (watch list,
//! progress, installed apps) is one JSON file that the frontend owns; this side only reads and
//! writes it safely.

use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Title {
  pub id: String,
  /// "movie" or "show" (a show is one season; the lookup id is the season's).
  pub kind: String,
  pub title: String,
  pub image: String,
  pub image_hi: String,
  pub genre: String,
  pub summary: String,
  pub year: String,
  pub runtime_min: Option<u32>,
  pub rating: String,
  /// A trailer (H.264 .m4v) when Apple has one, else empty.
  pub preview_url: String,
  /// The show's name for a season, the director for a film.
  pub artist: String,
}

/// Apple artwork URLs end in `<w>x<h>bb.jpg` and serve any size up to the original.
fn art(url: &str, w: u32, h: u32) -> String {
  match url.rfind('/') {
    Some(i) => format!("{}/{}x{}bb.jpg", &url[..i], w, h),
    None => url.to_string(),
  }
}

fn client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder().timeout(Duration::from_secs(12)).build().map_err(|e| e.to_string())
}

fn s(v: &Value) -> String {
  v.as_str().unwrap_or("").to_string()
}

fn clip(text: &str, n: usize) -> String {
  text.chars().take(n).collect()
}

/// One item from the search / lookup API.
fn from_result(v: &Value) -> Option<Title> {
  let (kind, id, title) = if v["kind"] == "feature-movie" {
    ("movie", v["trackId"].as_i64()?, s(&v["trackName"]))
  } else if v["collectionType"] == "TV Season" {
    ("show", v["collectionId"].as_i64()?, s(&v["collectionName"]))
  } else {
    return None;
  };
  if title.is_empty() {
    return None;
  }
  let thumb = v["artworkUrl100"].as_str().or_else(|| v["artworkUrl60"].as_str()).unwrap_or("");
  let summary = ["longDescription", "shortDescription", "description"].iter().map(|k| s(&v[*k])).find(|t| !t.is_empty()).unwrap_or_default();
  Some(Title {
    id: id.to_string(),
    kind: kind.into(),
    title,
    image: art(thumb, 600, 900),
    image_hi: art(thumb, 1400, 2100),
    genre: s(&v["primaryGenreName"]),
    summary: clip(&summary, 700),
    year: s(&v["releaseDate"]).chars().take(4).collect(),
    runtime_min: v["trackTimeMillis"].as_u64().map(|ms| (ms / 60_000) as u32).filter(|m| *m > 0),
    rating: s(&v["contentAdvisoryRating"]),
    preview_url: s(&v["previewUrl"]),
    artist: s(&v["artistName"]),
  })
}

async fn results(req: reqwest::RequestBuilder) -> Result<Vec<Title>, String> {
  let json: Value = req.send().await.map_err(|e| format!("Couldn't reach the catalogue: {e}"))?.json().await.map_err(|e| e.to_string())?;
  Ok(json["results"].as_array().map(|a| a.iter().filter_map(from_result).collect()).unwrap_or_default())
}

/// Films and series matching `term`, for the TV search page.
#[tauri::command]
pub async fn tv_search(term: String) -> Result<Vec<Title>, String> {
  let t = term.trim().to_string();
  if t.is_empty() {
    return Ok(vec![]);
  }
  let c = client()?;
  let q = |media: &str, entity: &str| c.get("https://itunes.apple.com/search").query(&[("term", t.as_str()), ("country", "za"), ("media", media), ("entity", entity), ("limit", "20")]);
  let (movies, shows) = tokio::join!(results(q("movie", "movie")), results(q("tvShow", "tvSeason")));
  if movies.is_err() && shows.is_err() {
    return Err(movies.err().unwrap());
  }
  let mut out = movies.unwrap_or_default();
  // One entry per show (the catalogue lists every season separately).
  let mut seen = std::collections::HashSet::new();
  for sh in shows.unwrap_or_default() {
    if seen.insert(sh.artist.to_lowercase()) {
      out.push(sh);
    }
  }
  Ok(out)
}

/// Full details for one title id (runtime, rating, trailer).
#[tauri::command]
pub async fn tv_lookup(id: String) -> Result<Option<Title>, String> {
  if !id.chars().all(|c| c.is_ascii_digit()) {
    return Err("Bad title id.".into());
  }
  let c = client()?;
  let list = results(c.get("https://itunes.apple.com/lookup").query(&[("id", id.as_str()), ("country", "za")])).await?;
  Ok(list.into_iter().next())
}

/// This week's top films or series on Apple's store, with ids so each can be opened.
#[tauri::command]
pub async fn tv_browse(kind: String) -> Result<Vec<Title>, String> {
  let (url, kind) = match kind.as_str() {
    "movie" => ("https://itunes.apple.com/za/rss/topmovies/limit=50/json", "movie"),
    "show" => ("https://itunes.apple.com/za/rss/toptvseasons/limit=50/json", "show"),
    _ => return Err("Unknown list.".into()),
  };
  let json: Value = client()?.get(url).send().await.map_err(|e| format!("Couldn't reach the catalogue: {e}"))?.json().await.map_err(|e| e.to_string())?;
  let entries = json["feed"]["entry"].as_array().cloned().unwrap_or_default();
  Ok(
    entries
      .iter()
      .filter_map(|e| {
        let title = e["im:name"]["label"].as_str()?.to_string();
        let thumb = e["im:image"].as_array()?.last()?["label"].as_str()?.to_string();
        let id = e["id"]["attributes"]["im:id"].as_str()?.to_string();
        Some(Title {
          id,
          kind: kind.into(),
          title,
          image: art(&thumb, 600, 900),
          image_hi: art(&thumb, 1400, 2100),
          genre: s(&e["category"]["attributes"]["label"]),
          summary: clip(&s(&e["summary"]["label"]), 700),
          year: s(&e["im:releaseDate"]["label"]).chars().take(4).collect(),
          runtime_min: None,
          rating: String::new(),
          preview_url: String::new(),
          artist: s(&e["im:artist"]["label"]),
        })
      })
      .collect(),
  )
}

fn library_path(app: &AppHandle) -> Result<PathBuf, String> {
  let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("tv");
  std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  Ok(d.join("library.json"))
}

/// The saved library as JSON text, or empty when nothing was saved yet.
#[tauri::command]
pub async fn tv_library_get(app: AppHandle) -> Result<String, String> {
  match std::fs::read_to_string(library_path(&app)?) {
    Ok(t) => Ok(t),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
    Err(e) => Err(e.to_string()),
  }
}

/// Saves the library through a temp file, so a crash can't leave half a list.
#[tauri::command]
pub async fn tv_library_set(app: AppHandle, json: String) -> Result<(), String> {
  serde_json::from_str::<Value>(&json).map_err(|e| format!("Library isn't valid JSON: {e}"))?;
  let p = library_path(&app)?;
  let tmp = p.with_extension("tmp");
  std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
  std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}
