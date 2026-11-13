mod store;

use std::sync::Arc;

pub use store::{
  Chapter, DailyReflection, Lesson, Note, PastPaper, Resource, StudyBlock, Subject,
  SubjectStreak, Test,
};
use store::Store;
use tauri::{AppHandle, Manager, State};

pub struct ScholarState {
  store: Arc<Store>,
}

pub fn init(app: &AppHandle) -> Result<ScholarState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
  let db_path = data_dir.join("scholar.sqlite3");
  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open scholar store: {e}"))?);
  Ok(ScholarState { store })
}

// --- Subjects ---

#[tauri::command]
pub fn scholar_list_subjects(state: State<ScholarState>) -> Result<Vec<Subject>, String> {
  state.store.list_subjects().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_create_subject(state: State<ScholarState>, subject: Subject) -> Result<(), String> {
  state.store.create_subject(&subject).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_update_subject(state: State<ScholarState>, subject: Subject) -> Result<(), String> {
  state.store.update_subject(&subject).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_delete_subject(state: State<ScholarState>, id: String) -> Result<(), String> {
  state.store.delete_subject(&id).map_err(|e| e.to_string())
}

// --- Blocks ---

#[tauri::command]
pub fn scholar_list_blocks_for_week(
  state: State<ScholarState>,
  week_start: String,
  week_end: String,
) -> Result<Vec<StudyBlock>, String> {
  state.store.list_blocks_for_week(&week_start, &week_end).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_list_blocks_for_date(
  state: State<ScholarState>,
  date: String,
) -> Result<Vec<StudyBlock>, String> {
  state.store.list_blocks_for_date(&date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_create_block(state: State<ScholarState>, block: StudyBlock) -> Result<(), String> {
  state.store.create_block(&block).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_update_block(state: State<ScholarState>, block: StudyBlock) -> Result<(), String> {
  state.store.update_block(&block).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_set_block_completed(
  state: State<ScholarState>,
  id: String,
  completed: bool,
) -> Result<(), String> {
  state.store.set_block_completed(&id, completed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_delete_block(state: State<ScholarState>, id: String) -> Result<(), String> {
  state.store.delete_block(&id).map_err(|e| e.to_string())
}

// --- Reflections ---

#[tauri::command]
pub fn scholar_get_reflection(
  state: State<ScholarState>,
  date: String,
) -> Result<Option<DailyReflection>, String> {
  state.store.get_reflection(&date).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_set_reflection(
  state: State<ScholarState>,
  reflection: DailyReflection,
) -> Result<(), String> {
  state.store.set_reflection(&reflection).map_err(|e| e.to_string())
}

// --- Streaks ---

#[tauri::command]
pub fn scholar_list_streaks(state: State<ScholarState>) -> Result<Vec<SubjectStreak>, String> {
  state.store.list_streaks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_update_streak(
  state: State<ScholarState>,
  streak: SubjectStreak,
) -> Result<(), String> {
  state.store.update_streak(&streak).map_err(|e| e.to_string())
}

// --- Resources ---

#[tauri::command]
pub fn scholar_list_resources(
  state: State<ScholarState>,
  subject_id: String,
) -> Result<Vec<Resource>, String> {
  state.store.list_resources(&subject_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_create_resource(
  state: State<ScholarState>,
  resource: Resource,
) -> Result<(), String> {
  state.store.create_resource(&resource).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_delete_resource(state: State<ScholarState>, id: String) -> Result<(), String> {
  state.store.delete_resource(&id).map_err(|e| e.to_string())
}

// --- Settings ---

#[tauri::command]
pub fn scholar_get_setting(
  state: State<ScholarState>,
  key: String,
) -> Result<Option<String>, String> {
  state.store.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_set_setting(
  state: State<ScholarState>,
  key: String,
  value: String,
) -> Result<(), String> {
  state.store.set_setting(&key, &value).map_err(|e| e.to_string())
}

// --- Chapters ---

#[tauri::command]
pub fn scholar_list_chapters(
  state: State<ScholarState>,
  subject_id: String,
) -> Result<Vec<Chapter>, String> {
  state.store.list_chapters(&subject_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_create_chapter(state: State<ScholarState>, chapter: Chapter) -> Result<(), String> {
  state.store.create_chapter(&chapter).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_set_chapter_status(
  state: State<ScholarState>,
  id: String,
  status: String,
  error: Option<String>,
) -> Result<(), String> {
  state
    .store
    .set_chapter_status(&id, &status, error.as_deref())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_set_chapter_completed(
  state: State<ScholarState>,
  id: String,
  completed: bool,
) -> Result<(), String> {
  state.store.set_chapter_completed(&id, completed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_rename_chapter(
  state: State<ScholarState>,
  id: String,
  name: String,
) -> Result<(), String> {
  state.store.rename_chapter(&id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_delete_chapter(state: State<ScholarState>, id: String) -> Result<(), String> {
  state.store.delete_chapter(&id).map_err(|e| e.to_string())
}

// --- Lessons ---

#[tauri::command]
pub fn scholar_list_lessons(
  state: State<ScholarState>,
  chapter_id: String,
) -> Result<Vec<Lesson>, String> {
  state.store.list_lessons(&chapter_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_list_lessons_for_subject(
  state: State<ScholarState>,
  subject_id: String,
) -> Result<Vec<Lesson>, String> {
  state.store.list_lessons_for_subject(&subject_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_replace_lessons(
  state: State<ScholarState>,
  chapter_id: String,
  lessons: Vec<Lesson>,
) -> Result<(), String> {
  state.store.replace_lessons(&chapter_id, &lessons).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_set_lesson_mastery(
  state: State<ScholarState>,
  id: String,
  mastery: String,
  last_score: String,
) -> Result<(), String> {
  state
    .store
    .set_lesson_mastery(&id, &mastery, &last_score)
    .map_err(|e| e.to_string())
}

// --- Notes ---

#[tauri::command]
pub fn scholar_list_notes(
  state: State<ScholarState>,
  subject_id: String,
) -> Result<Vec<Note>, String> {
  state.store.list_notes(&subject_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_upsert_note(state: State<ScholarState>, note: Note) -> Result<(), String> {
  state.store.upsert_note(&note).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_delete_note(state: State<ScholarState>, id: String) -> Result<(), String> {
  state.store.delete_note(&id).map_err(|e| e.to_string())
}

// --- Tests ---

#[tauri::command]
pub fn scholar_list_tests(
  state: State<ScholarState>,
  subject_id: String,
) -> Result<Vec<Test>, String> {
  state.store.list_tests(&subject_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_list_results(state: State<ScholarState>) -> Result<Vec<Test>, String> {
  state.store.list_results().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_create_test(state: State<ScholarState>, test: Test) -> Result<(), String> {
  state.store.create_test(&test).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_record_test_result(
  state: State<ScholarState>,
  id: String,
  score: i64,
  total: i64,
) -> Result<(), String> {
  let taken_at = chrono::Utc::now().to_rfc3339();
  state
    .store
    .record_test_result(&id, score, total, &taken_at)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_delete_test(state: State<ScholarState>, id: String) -> Result<(), String> {
  state.store.delete_test(&id).map_err(|e| e.to_string())
}

// --- Past papers ---

#[tauri::command]
pub fn scholar_list_past_papers(
  state: State<ScholarState>,
  subject_id: String,
) -> Result<Vec<PastPaper>, String> {
  state.store.list_past_papers(&subject_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_create_past_paper(
  state: State<ScholarState>,
  paper: PastPaper,
) -> Result<(), String> {
  state.store.create_past_paper(&paper).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_set_past_paper_chapters(
  state: State<ScholarState>,
  id: String,
  chapter_ids: String,
) -> Result<(), String> {
  state
    .store
    .set_past_paper_chapters(&id, &chapter_ids)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scholar_delete_past_paper(state: State<ScholarState>, id: String) -> Result<(), String> {
  state.store.delete_past_paper(&id).map_err(|e| e.to_string())
}

// --- Textbook page ingestion ---

/// Image extensions the "Add Chapter" picker accepts. Phone Link drops
/// phone camera shots as .jpg, but a screenshot or a scan of the same page
/// can be any of these, so the whole common set is allowed rather than
/// just the camera's own format.
const PAGE_EXTS: [&str; 6] = ["jpg", "jpeg", "png", "webp", "bmp", "heic"];

/// Hard ceiling per page image. A phone photo of a textbook page is
/// typically 1-5 MB; anything past this is not a page, and a file that
/// large is almost certainly a video or a scan of a whole book rather
/// than one page. Rejected with a clear message naming the file, so the
/// user knows which one to retake.
const MAX_PAGE_BYTES: u64 = 24 * 1024 * 1024;

/// Checks that the photographed textbook pages for one chapter are all
/// present and usable, before a generation turn is spent on them.
///
/// The images themselves are NOT read or returned here. The vision path
/// hands the Claude CLI the file paths and it opens them with its own Read
/// tool (see `ai_claude_complete`), so encoding them would be wasted work
/// — but something still has to fail loudly on a page that was moved,
/// renamed, or is the wrong kind of file, naming which one. Without this
/// the only symptom is the model saying it could not read an attachment.
///
/// Deliberately a custom command over `std::fs` rather than the Tauri `fs:`
/// plugin: the plugin would need a broad read scope covering wherever
/// Phone Link happens to save (user-configurable, so not scopeable up
/// front), whereas this only ever stats the exact files the user picked.
#[tauri::command]
pub fn scholar_verify_pages(paths: Vec<String>) -> Result<(), String> {
  if paths.is_empty() {
    return Err("No pages were selected.".into());
  }
  for path in &paths {
    let p = std::path::Path::new(path);
    let shown = p.file_name().and_then(|n| n.to_str()).unwrap_or(path);
    let ext = p
      .extension()
      .and_then(|e| e.to_str())
      .map(|e| e.to_ascii_lowercase())
      .unwrap_or_default();
    if !PAGE_EXTS.contains(&ext.as_str()) {
      return Err(format!(
        "{shown} is not a page image (expected one of {}).",
        PAGE_EXTS.join(", ")
      ));
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("Cannot read {shown}: {e}"))?;
    if !meta.is_file() {
      return Err(format!("{shown} is not a file."));
    }
    if meta.len() == 0 {
      return Err(format!("{shown} is empty."));
    }
    if meta.len() > MAX_PAGE_BYTES {
      return Err(format!(
        "{shown} is {:.1} MB - too large for one page.",
        meta.len() as f64 / (1024.0 * 1024.0)
      ));
    }
  }
  Ok(())
}

/// The default directory the "Add Chapter" picker opens in: where
/// Microsoft Phone Link saves photos pulled off the phone.
///
/// Phone Link's save location is user-configurable, so this is a best
/// guess at the default (`Pictures\Camera Roll`, falling back to
/// `Pictures`) and returns `None` when neither exists rather than handing
/// the dialog a path that isn't there - the picker then just opens
/// wherever the OS would, and the user navigates once.
#[tauri::command]
pub fn scholar_phone_photos_dir() -> Option<String> {
  let pictures = dirs::picture_dir()?;
  let camera_roll = pictures.join("Camera Roll");
  if camera_roll.is_dir() {
    return camera_roll.to_str().map(str::to_string);
  }
  if pictures.is_dir() {
    return pictures.to_str().map(str::to_string);
  }
  None
}
