mod store;

use std::sync::Arc;

pub use store::Template;
use store::Store;
use tauri::{AppHandle, Manager, State};

pub struct TemplateLibraryState {
  store: Arc<Store>,
}

/// One shared template store used by every feature that needs document
/// templates (School's Study Generator, Work's Proposal/Quote Generator,
/// and any future one) — a single `templates` table keyed by `owner`
/// rather than a separate store per feature.
pub fn init(app: &AppHandle) -> Result<TemplateLibraryState, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  let db_path = data_dir.join("template_library.sqlite3");

  let store = Arc::new(Store::open(db_path).map_err(|e| format!("Failed to open template store: {e}"))?);
  Ok(TemplateLibraryState { store })
}

#[tauri::command]
pub fn template_library_list(
  state: State<TemplateLibraryState>,
  owner: Option<String>,
) -> Result<Vec<Template>, String> {
  state.store.list_templates(owner.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn template_library_register(
  state: State<TemplateLibraryState>,
  template: Template,
) -> Result<(), String> {
  state.store.register_template(&template).map_err(|e| e.to_string())
}
