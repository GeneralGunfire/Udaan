//! Document text extraction (for TTS + resume persistence) for the Document
//! Reader feature. Rendering with real formatting (docx via mammoth, PDF via
//! pdfjs-dist, markdown via `marked`) happens on the frontend — this module
//! only produces the clean plain-text paragraph stream TTS reads from, plus
//! a small SQLite-backed per-document resume-position store (same
//! `db::configure_connection` convention as taskbar_prefs/schedule).

mod store;

use std::sync::Arc;

pub use store::ReadingPosition;
use store::Store;
use tauri::{AppHandle, Manager, State};

pub struct DocumentReaderState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<DocumentReaderState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("document_reader.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open document_reader store: {e}"))?);
  Ok(DocumentReaderState { store })
}

#[derive(serde::Serialize)]
pub struct ExtractedDocument {
  /// Clean paragraphs for TTS + resume-position indexing. Rendering is a
  /// separate frontend concern — these indices are matched to rendered DOM
  /// nodes via `data-para-index` attributes assigned in the same order.
  pub paragraphs: Vec<String>,
  /// Set when extraction succeeded but something was skipped/degraded (e.g.
  /// a table's contents were summarized rather than read verbatim).
  pub warning: Option<String>,
}

/// Extracts clean, TTS-ready paragraphs from a document. `.docx`/`.md`
/// extraction happens on the frontend (mammoth/marked already parse into
/// HTML there, and re-implementing that parsing here would just be a second,
/// divergent source of truth) — call this only for `.txt`/`.pdf`.
#[tauri::command(async)]
pub fn document_reader_extract(file_path: String) -> Result<ExtractedDocument, String> {
  let ext = std::path::Path::new(&file_path)
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase();

  match ext.as_str() {
    "txt" => extract_txt(&file_path),
    "pdf" => extract_pdf(&file_path),
    other => Err(format!("document_reader_extract does not handle .{other} — extract on the frontend instead")),
  }
}

fn extract_txt(file_path: &str) -> Result<ExtractedDocument, String> {
  let bytes = std::fs::read(file_path).map_err(|e| format!("Failed to read file: {e}"))?;
  let text = String::from_utf8(bytes.clone()).unwrap_or_else(|_| String::from_utf8_lossy(&bytes).into_owned());

  let paragraphs: Vec<String> = text
    .split("\n\n")
    .map(|p| p.split_whitespace().collect::<Vec<_>>().join(" "))
    .filter(|p| !p.is_empty())
    .collect();

  if paragraphs.is_empty() {
    return Err("This file appears to be empty.".into());
  }

  Ok(ExtractedDocument { paragraphs, warning: None })
}

fn extract_pdf(file_path: &str) -> Result<ExtractedDocument, String> {
  let doc = lopdf::Document::load(file_path)
    .map_err(|e| format!("Failed to open PDF — the file may be corrupted: {e}"))?;

  let page_ids: Vec<_> = doc.get_pages().into_values().collect();
  if page_ids.is_empty() {
    return Err("This PDF has no pages.".into());
  }

  let mut paragraphs = Vec::new();
  let mut non_empty_pages = 0usize;

  for page_id in &page_ids {
    let page_text = doc.extract_text(&[page_id.0]).unwrap_or_default();
    let cleaned: Vec<String> = page_text
      .split('\n')
      .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
      .filter(|line| !line.is_empty())
      .collect();

    if !cleaned.is_empty() {
      non_empty_pages += 1;
      // lopdf extracts line-by-line rather than paragraph-by-paragraph —
      // group a page's lines into one paragraph per page as a reasonable
      // approximation, since PDFs don't reliably encode paragraph breaks.
      paragraphs.push(cleaned.join(" "));
    }
  }

  // A handful of pages with a stray text fragment (e.g. a page number OCR'd
  // into the PDF's metadata) shouldn't count as "has real text" — require a
  // meaningful fraction of pages to have actual extractable content before
  // treating this as a real (non-scanned) PDF.
  let extractable_ratio = non_empty_pages as f32 / page_ids.len() as f32;
  if paragraphs.is_empty() || extractable_ratio < 0.2 {
    return Err(
      "NO_EXTRACTABLE_TEXT: This looks like a scanned/image-only PDF with no extractable text. \
       OCR isn't supported yet, so this document can't be read aloud."
        .into(),
    );
  }

  Ok(ExtractedDocument { paragraphs, warning: None })
}

#[tauri::command(async)]
pub fn document_reader_get_position(
  state: State<DocumentReaderState>,
  document_key: String,
) -> Result<Option<ReadingPosition>, String> {
  state.store.get_position(&document_key).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn document_reader_save_position(
  state: State<DocumentReaderState>,
  document_key: String,
  paragraph_index: i64,
  sentence_index: i64,
  scroll_position: f64,
) -> Result<(), String> {
  state
    .store
    .save_position(&document_key, paragraph_index, sentence_index, scroll_position)
    .map_err(|e| e.to_string())
}
