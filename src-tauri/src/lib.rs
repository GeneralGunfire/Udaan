mod asset_library;
mod audio_library;
mod claude_code;
mod client_tracker;
mod db;
mod document_reader;
mod file_explorer;
mod folder_watcher;
mod general_chat;
mod installed_apps;
mod local_model;
mod pdf_tool;
mod quick_settings;
mod schedule;
mod shell_replace;
mod system_health;
mod taskbar;
mod taskbar_prefs;
mod template_library;
mod webview_permissions;
mod window_watcher;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(
      // Global Start Menu trigger. NOTE: the underlying `global-hotkey`
      // crate (verified by inspecting its source) has no support for the
      // bare Windows/Super key as a registerable shortcut — only real
      // modifier+key combos. True "press Windows key alone to open Start"
      // fidelity is therefore a known, documented gap in this pass (per
      // the task's own "note anything not feasible rather than faking
      // it" instruction) — Ctrl+Space is the actual reliable global
      // trigger, registered below and also still bound as a local
      // in-window shortcut in App.tsx for when Udaan has focus.
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
          use tauri_plugin_global_shortcut::ShortcutState;
          if event.state != ShortcutState::Pressed {
            return;
          }
          if shortcut.matches(
            tauri_plugin_global_shortcut::Modifiers::CONTROL,
            tauri_plugin_global_shortcut::Code::Space,
          ) {
            let _ = app.emit("global-shortcut:open-launchpad", ());
          }
        })
        .build(),
    )
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
      local_model::local_model_stop_external_ollama,
      local_model::tts_list_voices,
      local_model::tts_synthesize,
      document_reader::document_reader_extract,
      document_reader::document_reader_get_position,
      document_reader::document_reader_save_position,
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
      file_explorer::file_explorer_list_dir,
      file_explorer::file_explorer_search,
      file_explorer::file_explorer_create_folder,
      file_explorer::file_explorer_create_file,
      file_explorer::file_explorer_rename,
      file_explorer::file_explorer_delete,
      file_explorer::file_explorer_soft_delete,
      file_explorer::file_explorer_restore,
      file_explorer::file_explorer_copy,
      file_explorer::file_explorer_move,
      file_explorer::file_explorer_check_conflicts,
      file_explorer::file_explorer_duplicate,
      file_explorer::file_explorer_read_file,
      file_explorer::file_explorer_read_thumbnail,
      file_explorer::file_explorer_read_text_preview,
      file_explorer::file_explorer_open_with_system,
      file_explorer::file_explorer_quick_access,
      file_explorer::file_explorer_stat,
      installed_apps::installed_apps_detect,
      installed_apps::installed_apps_launch,
      installed_apps::installed_apps_default_handler,
      installed_apps::installed_apps_handlers_for_extension,
      installed_apps::installed_apps_open_file_with,
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
      shell_replace::shell_backup_current_value,
      shell_replace::shell_status,
      shell_replace::shell_restore_default,
      shell_replace::shell_set_to_udaan,
      taskbar::taskbar_list_windows,
      taskbar::taskbar_focus_window,
      taskbar::taskbar_minimize_window,
      taskbar::taskbar_close_window,
      taskbar::taskbar_minimize_all,
      taskbar::taskbar_foreground_window,
      taskbar::taskbar_register_appbar,
      taskbar::taskbar_unregister_appbar,
      taskbar::taskbar_hide_windows_taskbar,
      taskbar::taskbar_show_windows_taskbar,
      taskbar::taskbar_force_topmost,
      taskbar_prefs::taskbar_prefs_list_pinned,
      taskbar_prefs::taskbar_prefs_set_pinned,
      taskbar_prefs::taskbar_prefs_get,
      taskbar_prefs::taskbar_prefs_set,
      window_watcher::window_watcher_set_enabled,
      window_watcher::window_watcher_status,
      quick_settings::quick_settings_battery_status,
      quick_settings::quick_settings_send_volume_command,
      quick_settings::quick_settings_network_online,
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
      let taskbar_prefs_state = taskbar_prefs::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(taskbar_prefs_state);
      let document_reader_state = document_reader::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(document_reader_state);

      if let Some(main_window) = app.get_webview_window("main") {
        webview_permissions::allow_media_capture(&main_window);
      }

      {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        // Best-effort: another app may already own this combo, or the OS
        // may refuse registration in some environments — a failed global
        // shortcut should never stop the rest of the app from starting,
        // so this is logged, not propagated as a setup error.
        if let Err(e) = app.global_shortcut().register("Ctrl+Space") {
          log::warn!("Could not register global Start Menu shortcut (Ctrl+Space): {e}");
        }
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

        // Mirror the same "never leave the OS in a weird state" principle
        // for the taskbar window: if it registered itself as a real
        // Windows AppBar (see taskbar::taskbar_register_appbar), losing
        // that window without unregistering would leave the desktop work
        // area permanently shrunk. This always runs on close regardless
        // of how the window closes (crash aside), independent of whatever
        // cleanup the frontend itself attempts.
        if window.label() == "taskbar" {
          if let Ok(hwnd) = window.hwnd() {
            taskbar::unregister_appbar_by_hwnd(hwnd.0 as isize);
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
