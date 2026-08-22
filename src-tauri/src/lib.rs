mod asset_library;
mod audio_library;
mod claude_code;
mod client_tracker;
mod folder_watcher;
mod general_chat;
mod local_model;
mod pdf_tool;
mod schedule;
mod system_health;
mod template_library;
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
      local_model::local_model_start_ollama,
      local_model::local_model_stop_ollama,
      local_model::local_model_started_ollama,
      general_chat::general_chat_create_session,
      general_chat::general_chat_list_sessions,
      general_chat::general_chat_list_messages,
      general_chat::general_chat_add_message,
      general_chat::general_chat_update_message,
      general_chat::general_chat_delete_session,
      system_health::system_health_stats,
      audio_library::audio_library_scan_folder,
      audio_library::audio_library_read_file,
      audio_library::audio_library_stat_files,
      asset_library::asset_library_scan_folder,
      asset_library::asset_library_read_file,
      asset_library::asset_library_write_file,
      asset_library::asset_library_stat_files,
      template_library::template_library_list,
      template_library::template_library_register,
      client_tracker::client_tracker_list_contacts,
      client_tracker::client_tracker_upsert_contact,
      client_tracker::client_tracker_delete_contact,
      client_tracker::client_tracker_list_notes,
      client_tracker::client_tracker_add_note,
      client_tracker::client_tracker_list_follow_ups,
      client_tracker::client_tracker_add_follow_up,
      client_tracker::client_tracker_set_follow_up_done,
      folder_watcher::folder_watcher_poll,
      pdf_tool::pdf_tool_inspect,
      pdf_tool::pdf_tool_merge,
      pdf_tool::pdf_tool_split,
      pdf_tool::pdf_tool_stamp_text,
      pdf_tool::pdf_tool_generate_sample,
      schedule::schedule_list_events,
      schedule::schedule_create_event,
      schedule::schedule_update_event,
      schedule::schedule_delete_event,
      schedule::schedule_set_status,
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
      app.manage(local_model::WhisperServer::new());
      app.manage(local_model::OllamaProcess::default());
      let general_chat_state = general_chat::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(general_chat_state);
      let template_library_state = template_library::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(template_library_state);
      let client_tracker_state = client_tracker::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(client_tracker_state);
      app.manage(folder_watcher::FolderWatcherState::default());
      let schedule_state = schedule::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(schedule_state);

      if let Some(main_window) = app.get_webview_window("main") {
        webview_permissions::allow_media_capture(&main_window);
      }

      Ok(())
    })
    .on_window_event(|window, event| {
      // Best-effort: if the user started Ollama from Udaan's own button and
      // then closes the window, don't leave it running as an orphaned
      // background process. Only ever kills a process we spawned
      // ourselves — see OllamaProcess's own doc comment.
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        if let Some(state) = window.try_state::<local_model::OllamaProcess>() {
          state.kill_blocking();
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
