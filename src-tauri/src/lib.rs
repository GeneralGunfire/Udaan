mod agent_workspace;
mod agritrack;
mod asset_library;
mod audio_library;
mod audio_recorder;
mod boot_optimize;
mod claude_code;
mod claude_usage;
mod cnc_mod_switcher;
mod client_tracker;
mod daily_brief;
mod db;
mod document_reader;
mod file_explorer;
mod folder_watcher;
mod general_chat;
mod installed_apps;
mod local_model;
mod notes;
mod omniroute;
mod pdf_tool;
mod power_state;
mod quick_settings;
mod schedule;
mod shell_replace;
mod omni_find;
mod studio;
mod study;
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
    .plugin(tauri_plugin_shell::init())
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
      omniroute::omniroute_start,
      omniroute::omniroute_stop,
      omniroute::omniroute_started_by_app,
      local_model::tts_list_voices,
      local_model::tts_synthesize,
      document_reader::document_reader_extract,
      document_reader::document_reader_get_position,
      document_reader::document_reader_save_position,
      notes::notes_list,
      notes::notes_read_body,
      notes::notes_create,
      notes::notes_save_body,
      notes::notes_delete,
      notes::notes_set_order,
      notes::notes_get_active,
      notes::notes_set_active,
      agritrack::agritrack_list_tables,
      agritrack::agritrack_query_table,
      agritrack::agritrack_run_collector_now,
      agritrack::agritrack_available_dates,
      agritrack::agritrack_province_snapshot,
      agritrack::agritrack_crop_detail,
      claude_usage::claude_usage_get_report,
      general_chat::general_chat_create_session,
      general_chat::general_chat_list_sessions,
      general_chat::general_chat_list_messages,
      general_chat::general_chat_add_message,
      general_chat::general_chat_update_message,
      general_chat::general_chat_delete_session,
      general_chat::general_chat_set_memory_fact,
      general_chat::general_chat_delete_memory_fact,
      general_chat::general_chat_list_memory_facts,
      agent_workspace::agent_read_file,
      agent_workspace::agent_write_file,
      agent_workspace::agent_list_directory,
      agent_workspace::agent_delete_file,
      agent_workspace::agent_workspace_add_file,
      agent_workspace::agent_workspace_path,
      cnc_mod_switcher::cnc_check_precondition,
      cnc_mod_switcher::cnc_get_status,
      cnc_mod_switcher::cnc_switch_mod,
      cnc_mod_switcher::cnc_launch_game,
      cnc_mod_switcher::cnc_restore_backup,
      daily_brief::daily_brief_get_today,
      daily_brief::daily_brief_get_by_date,
      daily_brief::daily_brief_list_history,
      daily_brief::daily_brief_save,
      daily_brief::daily_brief_delete_all,
      daily_brief::daily_brief_fetch_feed,
      power_state::power_state_keep_awake,
      system_health::system_health_stats,
      audio_library::audio_library_scan_folder,
      audio_library::audio_library_read_cover,
      audio_library::audio_library_get_settings,
      audio_library::audio_library_save_settings,
      audio_library::audio_library_list_playlists,
      audio_library::audio_library_save_playlist,
      audio_library::audio_library_delete_playlist,
      audio_library::audio_library_list_favorites,
      audio_library::audio_library_set_favorite,
      audio_library::audio_library_analyze_track,
      audio_library::audio_library_list_analyzed,
      audio_library::audio_library_stem_status,
      audio_library::audio_library_separate_stems,
      audio_library::audio_library_clear_stems,
      audio_library::audio_library_stems_disk_usage,
      // Studio — native audio engine. The module is a global behind a
      // mutex (see studio/commands.rs) rather than Tauri managed state,
      // so there is nothing to `.manage()` here; the engine is created
      // lazily on the first call and torn down when Studio closes.
      studio::commands::studio_start_engine,
      studio::commands::studio_stop_engine,
      studio::commands::studio_engine_status,
      studio::commands::studio_audio_options,
      studio::commands::studio_estimate_latency,
      studio::commands::studio_apply_audio_config,
      studio::commands::studio_play,
      studio::commands::studio_stop,
      studio::commands::studio_stop_and_rewind,
      studio::commands::studio_seek,
      studio::commands::studio_set_loop,
      studio::commands::studio_set_tempo,
      studio::commands::studio_set_metronome,
      studio::commands::studio_upsert_track,
      studio::commands::studio_remove_track,
      studio::commands::studio_set_mixer,
      studio::commands::studio_set_master_gain,
      studio::commands::studio_set_notes,
      studio::commands::studio_load_sample,
      studio::commands::studio_unload_sample,
      studio::commands::studio_note_on,
      studio::commands::studio_note_off,
      studio::commands::studio_set_sustain,
      studio::commands::studio_all_notes_off,
      studio::commands::studio_start_recording,
      studio::commands::studio_stop_recording,
      studio::commands::studio_recording_status,
      studio::commands::studio_export_wav,
      studio::samples::studio_ensure_samples,
      studio::samples::studio_sample_cache_info,
      studio::samples::studio_clear_sample_cache,
      // OmniFind — web search and page extraction for deep research.
      // Native rather than frontend fetch: search engines send no CORS
      // headers and many sites block non-browser agents.
      omni_find::omni_find_search,
      omni_find::omni_find_fetch_page,
      audio_library::audio_library_import_file,
      audio_recorder::audio_recorder_status,
      audio_recorder::audio_recorder_start,
      audio_recorder::audio_recorder_stop,
      audio_recorder::audio_recorder_open_downloads,
      audio_recorder::audio_recorder_rename,
      audio_recorder::audio_recorder_get_settings,
      audio_recorder::audio_recorder_save_settings,
      audio_library::audio_library_list_dj_presets,
      audio_library::audio_library_save_dj_preset,
      audio_library::audio_library_delete_dj_preset,
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
      installed_apps::installed_apps_launch_by_exe_name,
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
      study::study_add_book,
      study::study_list_books,
      study::study_delete_book,
      study::study_retrieve,
      study::study_create_session,
      study::study_touch_session,
      study::study_list_sessions,
      study::study_delete_session,
      study::study_add_message,
      study::study_list_messages,
      boot_optimize::boot_optimize_run,
      taskbar::taskbar_list_windows,
      taskbar::taskbar_focus_window,
      taskbar::taskbar_minimize_window,
      taskbar::taskbar_close_window,
      taskbar::taskbar_minimize_all,
      taskbar::taskbar_open_task_manager,
      taskbar::taskbar_cursor_position,
      taskbar::taskbar_foreground_window,
      taskbar::taskbar_register_appbar,
      taskbar::taskbar_unregister_appbar,
      taskbar::taskbar_hide_windows_taskbar,
      taskbar::taskbar_show_windows_taskbar,
      taskbar::taskbar_force_topmost,
      taskbar::taskbar_register_thumbnail,
      taskbar::taskbar_update_thumbnail,
      taskbar::taskbar_unregister_thumbnail,
      taskbar::taskbar_unregister_all_thumbnails,
      taskbar_prefs::taskbar_prefs_list_pinned,
      taskbar_prefs::taskbar_prefs_set_pinned,
      taskbar_prefs::taskbar_prefs_get,
      taskbar_prefs::taskbar_prefs_set,
      window_watcher::window_watcher_set_enabled,
      window_watcher::window_watcher_status,
      quick_settings::quick_settings_battery_status,
      quick_settings::quick_settings_send_volume_command,
      quick_settings::quick_settings_network_online,
      quick_settings::quick_settings_wifi_details,
      quick_settings::quick_settings_set_wifi_radio_enabled,
      quick_settings::quick_settings_open_system_utility,
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
      app.manage(taskbar::ThumbnailRegistry::default());
      app.manage(omniroute::OmniRouteProcess::default());
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
      let study_state = study::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(study_state);
      let notes_state = notes::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(notes_state);

      let agritrack_state = agritrack::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(agritrack_state);
      let audio_library_state = audio_library::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(audio_library_state);
      let audio_recorder_state = audio_recorder::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(audio_recorder_state);
      let daily_brief_state = daily_brief::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(daily_brief_state);
      app.manage(claude_usage::ClaudeUsageState::default());

      if let Some(main_window) = app.get_webview_window("main") {
        webview_permissions::allow_media_capture(&main_window);
        // Udaan is a full desktop-replacement shell, not a windowed app —
        // it should always fill the screen on launch rather than opening
        // at tauri.conf.json's fixed 1440x900 default size.
        if let Err(e) = main_window.maximize() {
          log::error!("Failed to maximize main window on startup: {e}");
        }
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
      // Best-effort: if the user started OmniRoute from Udaan's own button
      // and then closes the window, don't leave it running as an orphaned
      // background process. Only ever kills a process we spawned ourselves
      // — see OmniRouteProcess's own doc comment.
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        if let Some(state) = window.try_state::<omniroute::OmniRouteProcess>() {
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

        // Same "never leave the OS in a weird state" guarantee for DWM
        // live thumbnails: if the taskbar-popup window closes (app quit,
        // crash-adjacent teardown) while any thumbnail is still
        // registered, sweep every tracked handle rather than relying
        // solely on the frontend's own per-window/on-hide unregister
        // calls (see taskbar::taskbar_unregister_all_thumbnails).
        if window.label() == "taskbar-popup" {
          if let Some(registry) = window.try_state::<taskbar::ThumbnailRegistry>() {
            taskbar::unregister_all_thumbnails_by_state(&registry);
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
