mod asset_library;
mod audio_library;
mod claude_code;
mod local_model;
mod system_health;
mod webview_permissions;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      claude_code::claude_code_submit_task,
      claude_code::claude_code_list_tasks,
      claude_code::claude_code_get_task,
      claude_code::claude_code_open_in_vscode,
      claude_code::claude_code_check_cli,
      local_model::local_model_transcribe,
      local_model::local_model_transcribe_bytes,
      system_health::system_health_stats,
      audio_library::audio_library_scan_folder,
      audio_library::audio_library_read_file,
      asset_library::asset_library_scan_folder,
      asset_library::asset_library_read_file,
      asset_library::asset_library_write_file,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let state = claude_code::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(state);

      if let Some(main_window) = app.get_webview_window("main") {
        webview_permissions::allow_media_capture(&main_window);
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
