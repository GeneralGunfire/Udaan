mod agent_workspace;
mod scholar;
mod ai_fallback;
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
mod engine;
mod file_explorer;
mod folder_watcher;
mod general_chat;
mod installed_apps;
mod local_model;
mod notes;
mod notifications;
mod omniroute;
mod pdf_tool;
mod power_state;
mod quick_settings;
mod schedule;
mod shell;
mod shell_replace;
mod omni_find;
mod studio;
mod study;
mod system_health;
mod taskbar;
mod taskbar_prefs;
mod focus_video;
mod news_image;
mod sound_fx;
mod tv;
mod utilities;
mod template_library;
mod webview_permissions;
mod window_watcher;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// WebView2 keeps HTTP and compiled-script caches between runs. After a new
/// build those can hand a window pieces of the previous frontend, so the
/// first launch of a changed exe clears them. Only caches are removed: local
/// storage, IndexedDB and cookies (settings, pins, layouts) are untouched.
/// Runs before any webview exists, and only when the exe actually changed,
/// which can only happen with no other instance running.
fn clear_stale_webview_cache() {
  let Ok(exe) = std::env::current_exe() else { return };
  let Ok(meta) = std::fs::metadata(&exe) else { return };
  let stamp = format!(
    "{}-{}",
    meta.len(),
    meta.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
  );
  let Some(base) = dirs::data_local_dir().map(|d| d.join("dev.udaan.workstation")) else { return };
  let stamp_file = base.join("build.stamp");
  if std::fs::read_to_string(&stamp_file).map(|s| s == stamp).unwrap_or(false) {
    return;
  }
  for dir in ["Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache"] {
    let _ = std::fs::remove_dir_all(base.join("EBWebView").join("Default").join(dir));
  }
  let _ = std::fs::create_dir_all(&base);
  let _ = std::fs::write(&stamp_file, stamp);
}

pub fn run() {
  eprintln!("[udaan] run() entered");
  clear_stale_webview_cache();
  eprintln!("[udaan] clear_stale_webview_cache done");
  tauri::Builder::default()
    // Exactly one Udaan: a second launch just brings up Start in the running one.
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      use tauri::Emitter;
      let _ = app.emit("launcher:toggle", ());
    }))
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
      engine::engine_health,
      focus_video::focus_video_port,
      claude_code::claude_code_submit_task,
      claude_code::claude_code_list_tasks,
      claude_code::claude_code_get_task,
      claude_code::claude_code_open_in_vscode,
      claude_code::claude_code_check_cli,
      omniroute::omniroute_start,
      ai_fallback::ai_claude_complete,
      tv::tv_host_open,
      tv::tv_host_show,
      tv::tv_host_running,
      tv::tv_host_close,
      tv::tv_host_nav,
      sound_fx::keepalive::speaker_keepalive_set,
      sound_fx::sound_fx_curve,
      news_image::news_page_image,
      tv::tv_top_movies,
      utilities::clip_history_list,
      utilities::clip_history_copy,
      utilities::clip_history_pin,
      utilities::clip_history_delete,
      utilities::screenshot_capture,
      utilities::screenshot_save,
      utilities::photos_scan,
      utilities::photos_thumb,
      utilities::photos_save_copy,
      utilities::storage_scan,
      utilities::storage_cleanables,
      utilities::storage_clean,
      utilities::storage_drives,
      ai_fallback::chat_save_image,
      ai_fallback::chat_download_image,
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
      notifications::notifications_list,
      notifications::notifications_unread_count,
      notifications::notifications_mark_read,
      notifications::notifications_mark_all_read,
      notifications::notifications_dismiss,
      notifications::notifications_push,
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
      pdf_tool::pdf_tool_rotate,
      pdf_tool::pdf_tool_delete_pages,
      pdf_tool::pdf_tool_compress,
      pdf_tool::pdf_tool_generate_sample,
      schedule::schedule_list_events,
      schedule::schedule_create_event,
      schedule::schedule_update_event,
      schedule::schedule_delete_event,
      schedule::schedule_set_status,
      shell::shell_snapshot,
      shell::shell_focus_window,
      shell::shell_minimize_window,
      shell::shell_set_windows_hidden,
      shell::shell_toggle_maximize_window,
      shell::shell_close_window,
      shell::shell_toggle_desktop,
      shell::shell_set_explorer_chrome_hidden,
      shell::shell_set_keyboard_hook,
      shell::shell_reserve_bottom_edge,
      shell::shell_place_at_bottom,
      shell::shell_keep_at_top,
      shell::shell_set_material,
      shell::shell_set_window_rect,
      shell::shell_reserve_top_edge,
      shell::shell_monitor_of,
      shell::shell_open_app,
      shell::shell_prewarm_apps,
      shell::shell_take_app_args,
      shell::shell_file_icons,
      shell::shell_invalidate_icon,
      shell::shell_app_names,
      shell::shell_resolve_launch,
      shell::shell_window_sizes,
      shell::shell_window_icons,
      shell::shell_snap_window,
      shell::shell_snap_self,
      shell::apps::shell_installed_apps,
      shell::apps::shell_installed_app_icons,
      shell::fs::shell_recycle,
      shell::fs::shell_recycle_bin_info,
      shell::fs::shell_empty_recycle_bin,
      shell::fs::shell_watch_dirs,
      shell::clipboard::shell_clipboard_set_files,
      shell::clipboard::shell_clipboard_get_files,
      shell::verbs::shell_invoke_verb,
      shell::verbs::shell_idle_ms,
      shell::verbs::shell_power,
      shell::session::shell_autostart_enabled,
      shell::session::shell_set_autostart,
      shell::corners::shell_set_hot_corners,
      shell::media::shell_volume,
      shell::procs::shell_processes,
      shell::procs::shell_system_load,
      shell::gesture::shell_set_gesture,
      shell::gesture::shell_set_dock_band,
      webview_permissions::shell_set_webview_memory_low,
      shell::gesture::shell_window_snapshots,
      shell::network::shell_network_status,
      shell::procs::shell_end_process,
      shell::media::shell_set_volume,
      shell::media::shell_now_playing,
      shell::media::shell_media_command,
      shell::media::shell_media_seek,
      shell::live_audio::live_audio_sources,
      shell::live_audio::live_audio_start,
      shell::live_audio::live_audio_stop,
      shell::live_audio::live_audio_set_level,
      shell::live_audio::live_audio_ping,
      shell::edge_light::edge_light_set_enabled,
      shell::verbs::shell_user_name,
      shell_replace::shell_backup_current_value,
      shell_replace::shell_status,
      shell_replace::shell_restore_default,
      shell_replace::shell_set_to_udaan,
      scholar::scholar_list_subjects,
      scholar::scholar_create_subject,
      scholar::scholar_update_subject,
      scholar::scholar_delete_subject,
      scholar::scholar_list_blocks_for_week,
      scholar::scholar_list_blocks_for_date,
      scholar::scholar_create_block,
      scholar::scholar_update_block,
      scholar::scholar_set_block_completed,
      scholar::scholar_delete_block,
      scholar::scholar_get_reflection,
      scholar::scholar_set_reflection,
      scholar::scholar_list_streaks,
      scholar::scholar_update_streak,
      scholar::scholar_list_resources,
      scholar::scholar_create_resource,
      scholar::scholar_delete_resource,
      scholar::scholar_get_setting,
      scholar::scholar_set_setting,
      scholar::scholar_list_chapters,
      scholar::scholar_create_chapter,
      scholar::scholar_set_chapter_status,
      scholar::scholar_set_chapter_completed,
      scholar::scholar_rename_chapter,
      scholar::scholar_delete_chapter,
      scholar::scholar_list_lessons,
      scholar::scholar_list_lessons_for_subject,
      scholar::scholar_replace_lessons,
      scholar::scholar_set_lesson_mastery,
      scholar::scholar_list_notes,
      scholar::scholar_upsert_note,
      scholar::scholar_delete_note,
      scholar::scholar_list_tests,
      scholar::scholar_list_results,
      scholar::scholar_create_test,
      scholar::scholar_record_test_result,
      scholar::scholar_delete_test,
      scholar::scholar_list_past_papers,
      scholar::scholar_create_past_paper,
      scholar::scholar_set_past_paper_chapters,
      scholar::scholar_delete_past_paper,
      scholar::scholar_verify_pages,
      scholar::scholar_phone_photos_dir,
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
      eprintln!("[udaan] setup() entered");
      engine::install(app.handle());
      focus_video::start();
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      eprintln!("[udaan] about to init claude_code");
      let state = claude_code::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      eprintln!("[udaan] claude_code init done");
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
      let scholar_state = scholar::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(scholar_state);
      let study_state = study::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(study_state);
      let notes_state = notes::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(notes_state);
      let notifications_state = notifications::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(notifications_state);
      notifications::windows_mirror::start(app.handle().clone());

      let audio_library_state = audio_library::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(audio_library_state);
      let audio_recorder_state = audio_recorder::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(audio_recorder_state);
      let daily_brief_state = daily_brief::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
      app.manage(daily_brief_state);
      app.manage(claude_usage::ClaudeUsageState::default());

      // All state is registered: only now may the shell's pages start loading.
      engine::create_windows(app.handle());

      if let Some(main_window) = app.get_webview_window("main") {
        webview_permissions::allow_media_capture(&main_window);
        if let Err(e) = shell::install_desktop(&main_window) {
          log::error!("Failed to install the desktop layer: {e}");
        }
      }

      shell::shell_set_keyboard_hook(true);
      shell::session::refresh_autostart_target();
      shell::start(app.handle().clone());
      shell::gesture::start(app.handle().clone());
      utilities::start_clipboard_watch(app.handle().clone());

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
        // The desktop is the shell itself: closing it (Alt+F4, or a
        // graceful `taskkill`) quits Udaan, which restores Explorer's
        // taskbar and releases the keyboard hook in RunEvent::Exit.
        // Closing any app window only closes that app.
        if window.label() == "main" {
          if let Some(state) = window.try_state::<omniroute::OmniRouteProcess>() {
            state.kill_blocking();
          }
          window.app_handle().exit(0);
        }

        // Mirror the same "never leave the OS in a weird state" principle
        // for the taskbar window: if it registered itself as a real
        // Windows AppBar (see taskbar::taskbar_register_appbar), losing
        // that window without unregistering would leave the desktop work
        // area permanently shrunk. This always runs on close regardless
        // of how the window closes (crash aside), independent of whatever
        // cleanup the frontend itself attempts.
        if window.label() == "taskbar" || window.label() == "menubar" {
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
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        shell::live_audio::restore_all();
        shell::edge_light::shutdown();
        // Give reserved screen edges back even if a window was torn down
        // without a close event, so maximized windows fill the screen again.
        for label in ["taskbar", "menubar"] {
          if let Some(w) = app.get_webview_window(label) {
            if let Ok(hwnd) = w.hwnd() {
              taskbar::unregister_appbar_by_hwnd(hwnd.0 as isize);
            }
          }
        }
        shell::restore_on_exit();
        // Anything still registered with the engine's guard: undo it.
        engine::guard::run_all();
      }
    });
}
