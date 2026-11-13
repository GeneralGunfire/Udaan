import { invoke } from '@tauri-apps/api/core'

/** Suppresses (true) or releases (false) Windows' own display/system sleep timers via SetThreadExecutionState — see src-tauri/src/power_state/mod.rs for why this is needed alongside the screensaver overlay. */
export function keepAwake(enabled: boolean): Promise<void> {
  return invoke('power_state_keep_awake', { enabled })
}
