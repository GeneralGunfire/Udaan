//! Study — textbook library + book-aware tutor chat. Reuses
//! document_reader's PDF text extraction (extract_pdf logic is duplicated
//! minimally here since document_reader's fn isn't public across module
//! boundaries in a way that avoids re-parenting; .docx text extraction
//! happens on the frontend via mammoth, same as Document Reader).
//!
//! Retrieval: local embeddings (all-MiniLM-L6-v2 via a long-lived Python
//! subprocess, embed_process.rs) — chosen over OmniRoute's own
//! /v1/embeddings endpoint, which requires paid provider credentials and
//! is therefore unusable under this app's no-auth constraint (confirmed
//! live against the running daemon before choosing this approach).

mod embed_process;
mod store;

use std::sync::Arc;

pub use store::{Book, StudyMessage, StudySession};
use store::{bytes_to_f32_vec, Store};
use tauri::{AppHandle, Manager, State};

pub struct StudyState {
  store: Arc<Store>,
  embedder: Arc<embed_process::EmbedProcess>,
}

pub fn init(app: &AppHandle) -> Result<StudyState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("study.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open study store: {e}"))?);
  let embedder = Arc::new(embed_process::EmbedProcess::new());
  Ok(StudyState { store, embedder })
}

/// Groups extracted paragraphs into chunks of roughly `target_words` words
/// each, never splitting a paragraph across chunks unless that single
/// paragraph alone exceeds the target (rare, but a very long unbroken
/// paragraph shouldn't produce an oversized, less-precise chunk).
fn chunk_paragraphs(paragraphs: &[String], target_words: usize) -> Vec<String> {
  let mut chunks = Vec::new();
  let mut current = String::new();
  let mut current_words = 0usize;

  for para in paragraphs {
    let para_words = para.split_whitespace().count();
    if current_words > 0 && current_words + para_words > target_words {
      chunks.push(current.trim().to_string());
      current.clear();
      current_words = 0;
    }
    if !current.is_empty() {
      current.push_str("\n\n");
    }
    current.push_str(para);
    current_words += para_words;
  }
  if !current.trim().is_empty() {
    chunks.push(current.trim().to_string());
  }
  chunks
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
  let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
  let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
  let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
  if norm_a == 0.0 || norm_b == 0.0 {
    return 0.0;
  }
  dot / (norm_a * norm_b)
}

#[derive(serde::Serialize)]
pub struct IndexResult {
  pub book: Book,
  pub warning: Option<String>,
}

/// Uploads and indexes a book: extracts text, chunks it, embeds every
/// chunk, and stores everything. `.docx` text must be extracted on the
/// frontend (mammoth) and passed in as `paragraphs` — same split as
/// Document Reader, which has the identical constraint. For `.pdf`,
/// `paragraphs` may be omitted and extraction happens here.
#[tauri::command]
pub async fn study_add_book(
  state: State<'_, StudyState>,
  file_path: String,
  title: String,
  file_kind: String,
  paragraphs: Option<Vec<String>>,
) -> Result<IndexResult, String> {
  let extracted = match paragraphs {
    Some(p) => (p, None),
    None => extract_pdf_paragraphs(&file_path)?,
  };
  let (paragraphs, extraction_warning) = extracted;

  if paragraphs.is_empty() {
    return Err("This document has no extractable text.".into());
  }

  let chunk_texts = chunk_paragraphs(&paragraphs, 220);
  if chunk_texts.is_empty() {
    return Err("This document produced no indexable chunks.".into());
  }

  // Embed in batches rather than one giant request — keeps memory bounded
  // and gives a natural point to fail fast if the embedder is unreachable,
  // rather than committing to one enormous all-or-nothing call.
  const BATCH_SIZE: usize = 32;
  let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(chunk_texts.len());
  for batch in chunk_texts.chunks(BATCH_SIZE) {
    let batch_vec: Vec<String> = batch.to_vec();
    let batch_embeddings = state
      .embedder
      .embed(batch_vec)
      .await
      .map_err(|e| format!("Failed to index book (embedding step): {e}"))?;
    embeddings.extend(batch_embeddings);
  }

  if embeddings.len() != chunk_texts.len() {
    return Err(format!(
      "Embedding count mismatch: expected {} vectors, got {}",
      chunk_texts.len(),
      embeddings.len()
    ));
  }

  let book_id = uuid::Uuid::new_v4().to_string();
  let now = chrono::Utc::now().to_rfc3339();

  let indexed: Vec<(i64, String, Vec<f32>)> = chunk_texts
    .into_iter()
    .zip(embeddings)
    .enumerate()
    .map(|(i, (text, embedding))| (i as i64, text, embedding))
    .collect();

  state
    .store
    .insert_chunks(&book_id, &indexed)
    .map_err(|e| format!("Failed to save book chunks: {e}"))?;

  let book = Book {
    id: book_id,
    title,
    file_path,
    file_kind,
    chunk_count: indexed.len() as i64,
    uploaded_at: now,
    index_warning: extraction_warning.clone(),
  };
  state.store.create_book(&book).map_err(|e| format!("Failed to save book: {e}"))?;

  Ok(IndexResult { book, warning: extraction_warning })
}

/// Mirrors document_reader's own PDF extraction (same lopdf-based
/// approach, same "too little extractable text" guard) — kept as a
/// distinct small function rather than exposing document_reader's
/// internal fn across the module boundary, since the two features'
/// extraction needs may diverge later (e.g. Study chunking by
/// paragraph vs. Document Reader's by page).
fn extract_pdf_paragraphs(file_path: &str) -> Result<(Vec<String>, Option<String>), String> {
  let doc = lopdf::Document::load(file_path).map_err(|e| format!("Failed to open PDF — the file may be corrupted: {e}"))?;

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
      paragraphs.push(cleaned.join(" "));
    }
  }

  let extractable_ratio = non_empty_pages as f32 / page_ids.len() as f32;
  if paragraphs.is_empty() || extractable_ratio < 0.2 {
    return Err(
      "NO_EXTRACTABLE_TEXT: This looks like a scanned/image-only PDF with little to no extractable text. \
       It can still be added, but the tutor won't have real content to answer questions from."
        .into(),
    );
  }

  // A partial-but-usable extraction (some pages had no text, most did)
  // gets a soft warning rather than a hard error, so the book is still
  // indexed but the user knows some content may be missing from answers.
  let warning = if extractable_ratio < 0.85 {
    Some(format!(
      "Only {non_empty_pages} of {} pages had extractable text — some content may be missing from the tutor's context.",
      page_ids.len()
    ))
  } else {
    None
  };

  Ok((paragraphs, warning))
}

#[tauri::command]
pub fn study_list_books(state: State<StudyState>) -> Result<Vec<Book>, String> {
  state.store.list_books().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_delete_book(state: State<StudyState>, id: String) -> Result<(), String> {
  state.store.delete_book(&id).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct RetrievedChunk {
  pub book_id: String,
  pub text: String,
  pub score: f32,
}

/// Finds the top-N most relevant chunks across the given books for a
/// query, via a local embedding + cosine-similarity scan. Returns an
/// empty vec (not an error) when nothing scores above `min_score` — the
/// caller (study_ask) uses that to have the model say "not covered by
/// this book" honestly rather than being fed irrelevant context.
#[tauri::command]
pub async fn study_retrieve(
  state: State<'_, StudyState>,
  book_ids: Vec<String>,
  query: String,
  top_n: usize,
) -> Result<Vec<RetrievedChunk>, String> {
  let chunks = state.store.chunks_for_books(&book_ids).map_err(|e| e.to_string())?;
  if chunks.is_empty() {
    return Ok(Vec::new());
  }

  let query_embedding = state
    .embedder
    .embed(vec![query])
    .await
    .map_err(|e| format!("Failed to embed query: {e}"))?
    .into_iter()
    .next()
    .ok_or("No query embedding returned")?;

  const MIN_SCORE: f32 = 0.25;
  let mut scored: Vec<RetrievedChunk> = chunks
    .iter()
    .map(|c| RetrievedChunk {
      book_id: c.book_id.clone(),
      text: c.text.clone(),
      score: cosine_similarity(&query_embedding, &bytes_to_f32_vec(&c.embedding)),
    })
    .filter(|c| c.score >= MIN_SCORE)
    .collect();

  scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
  scored.truncate(top_n);
  Ok(scored)
}

#[tauri::command]
pub fn study_create_session(state: State<StudyState>, session: StudySession) -> Result<(), String> {
  state.store.create_session(&session).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_touch_session(state: State<StudyState>, id: String, updated_at: String) -> Result<(), String> {
  state.store.touch_session(&id, &updated_at).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_list_sessions(state: State<StudyState>) -> Result<Vec<StudySession>, String> {
  state.store.list_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_delete_session(state: State<StudyState>, id: String) -> Result<(), String> {
  state.store.delete_session(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_add_message(state: State<StudyState>, message: StudyMessage) -> Result<(), String> {
  state.store.insert_message(&message).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn study_list_messages(state: State<StudyState>, session_id: String) -> Result<Vec<StudyMessage>, String> {
  state.store.list_messages(&session_id).map_err(|e| e.to_string())
}
