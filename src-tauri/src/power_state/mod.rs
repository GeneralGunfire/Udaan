//! Suppresses Windows' own display/system sleep timers while Udaan's
//! screensaver is active. The screensaver itself (features/screensaver in
//! the frontend) is a plain rendered overlay with no OS-level effect —
//! Windows' real power-saving timers run completely independently, so the
//! screen was still turning off on its own schedule underneath a visible
//! "screensaver" that had no actual say over it. `SetThreadExecutionState`
//! is the real fix: it tells Windows this process currently needs the
//! display and system kept awake, exactly like a real screensaver or a
//! video player does. Idempotent to call repeatedly and must be paired
//! with a release (ES_CONTINUOUS alone) when the screensaver dismisses,
//! or the suppression would persist past its own turn indefinitely.

#[cfg(target_os = "windows")]
mod windows_impl {
  use windows_sys::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
  };

  pub fn keep_awake(enabled: bool) {
    let flags = if enabled {
      ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
    } else {
      // Passing ES_CONTINUOUS alone clears any previously set state
      // without immediately resetting the idle timer — the display can
      // resume its own normal timeout from here.
      ES_CONTINUOUS
    };
    // SAFETY: SetThreadExecutionState takes a plain flags value and only
    // affects this thread's own execution-state registration with the OS
    // power manager — it has no memory-safety implications.
    unsafe {
      SetThreadExecutionState(flags);
    }
  }
}

#[cfg(not(target_os = "windows"))]
mod windows_impl {
  pub fn keep_awake(_enabled: bool) {}
}

/// Enables or disables display/system sleep suppression. Called with
/// `true` when Udaan's screensaver becomes active, `false` the moment it
/// dismisses — never left on indefinitely, since that would keep the
/// user's screen on even when they've genuinely walked away and Windows'
/// normal power policy should take back over.
#[tauri::command]
pub fn power_state_keep_awake(enabled: bool) {
  windows_impl::keep_awake(enabled);
}
