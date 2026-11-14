# Udaan engine: what the UI can rely on

The engine (`src-tauri/src/engine/`) is the core of the OS. The UI renders and asks; the engine decides,
owns the OS state, and cleans up after itself. Every module has a `//!` header that explains its job in
plain language; this page is the map for people building UI on top of it.

**Rules for UI code**
- Never poll. Subscribe to an event, or use `usePoll` (`src/os/kernel/poll.ts`), which stops while the
  window is hidden.
- Never keep timers for OS behaviour (banner expiry, wallpaper rotation, window lifetime, edge placement):
  the engine owns them.
- A command the frontend calls must be registered in Rust. `src/os/kernel/contract.test.ts` enforces it.
- The engine tells every window the memory tier (`engine://tier`, mirrored as `<html data-tier>`):
  scale effects down when it is `tight`.

## Commands and events by area

| Area | Commands | Events |
|---|---|---|
| **Windows** (`tracker`, `window_actions`) | `shell_snapshot`, `shell_focus_window`, `shell_minimize_window`, `shell_toggle_maximize_window`, `shell_close_window`, `shell_snap_window`, `shell_snap_self`, `shell_set_windows_hidden`, `shell_toggle_desktop`, `shell_window_sizes`, `shell_window_icons`, `shell_monitor_of`, `shell_set_window_rect` | `shell://snapshot` (window list changed), `shell://foreground` (focus / full-screen only) |
| **Bars** (`edges`) | `engine_edge_bind(edge, windowPx, reservePx)`, `engine_edge_release` | (work-area changes arrive as `displays://changed`) |
| **Displays** | `displays_list` | `displays://changed` |
| **Popups** (`popup`) | `engine_popup_open(anchor, width, height, placement, focus)`, `engine_popup_resize`, `engine_popup_close` | `engine://popup-dismissed` (focus lost) |
| **Notifications** (`notify`) | `notify_push`, `notify_list`, `notify_unread_count`, `notify_mark_read`, `notify_mark_all_read`, `notify_dismiss`, `notify_dismiss_banner`, `notify_banners` | `notify://banners` (the stack on screen), `notifications:changed` (history) |
| **Search / Start** (`search`) | `search_query`, `search_register(source, entries)`, `search_record_launch`, `search_refresh_apps`, `search_status` | (none) |
| **Desktop contents** (`desktop_items`) | `desktop_items_list`, `desktop_items_dirs`, `desktop_recycle_bin` | `desktop://changed` |
| **Wallpapers** (`wallpapers`, `wallpaper_packs`) | `wallpaper_library`, `wallpaper_set`, `wallpaper_step`, `wallpaper_current`, `wallpaper_set_rotation`, `wallpaper_set_folders`, `wallpaper_pack_save`, `wallpaper_pack_delete`, `wallpaper_fit`, `wallpaper_thumb`, `wallpaper_scan` | `wallpaper://changed` |
| **Apps** (`apps`) | `shell_open_app`, `shell_prewarm_apps`, `shell_take_app_args`, `engine_app_closed` | |
| **Keyboard** (`keyboard`) | `shell_set_keyboard_hook` | `shell://hotkey` (`start`, `show-desktop`, `switcher-ctrl`, `dock-1`..`dock-9`, ...) |
| **Settings** (`taskbar_prefs`) | `taskbar_prefs_get/set/all` | `shell://pref-changed` (the engine announces every change) |
| **Health** | `engine_doctor`, `engine_health`, `engine_tier` | `engine://tier` |

## Behaviour to know about

- **Start search** ranks by title match quality (exact, prefix, word-start, substring, fuzzy, then
  subtitle/keywords), requires every query word to match, prefers apps over settings over files, and learns
  from `search_record_launch`. An empty query returns what the user opens most. Anything can contribute
  entries with `search_register("source", [...])` (Settings pages, actions).
- **Notifications** are decided in Rust: muted apps and Do Not Disturb go quietly to the history, identical
  repeats fold into one, bursts are limited, previews can be redacted, critical ones break through. The UI
  renders `notify://banners` and reports what the user did.
- **Wallpaper rotation** modes: off, every N minutes, once per login, day/night (dark pictures at night).
  Packs are suggested from picture names (Cars, Windows, macOS, Abstract, Landscapes) and editable.
- **Bars** are bound once with `engine_edge_bind`; the engine keeps them on their edge, releases the reserved
  strip however the window ends. The UI decides when a bar should step aside and calls
  `engine_edge_release` then (for example while something is full-screen).
- **The doctor** (`engine_doctor({heal})`) checks the desktop layer, the bars, the guard process, the
  keyboard hook and every background service, and repairs what it can. It also runs by itself after a
  display change or an Explorer restart.

## Safety nets (so the user's PC is never left altered)
- Explorer's taskbar is hidden only with its undo registered; a separate guard process (outside Udaan's
  process tree) restores it even if Udaan is killed outright.
- Bars give their reserved strip back on any exit.
- A crashed renderer reloads its page; a crashed browser process restarts Udaan.
- A damaged database is set aside (renamed, never deleted) and that feature starts fresh instead of
  stopping startup.
