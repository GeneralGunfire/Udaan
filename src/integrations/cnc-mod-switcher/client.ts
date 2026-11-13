import { invoke } from '@tauri-apps/api/core'
import type { GameStatus, SymlinkPrecondition } from './types'

/** Checked fresh every call — never cached, since Developer Mode/elevation can change between sessions. */
export function checkPrecondition(): Promise<SymlinkPrecondition> {
  return invoke('cnc_check_precondition')
}

/** Drive connection, precondition, and installed-mod status in one call. */
export function getStatus(): Promise<GameStatus> {
  return invoke('cnc_get_status')
}

/** Stages the given mod's files as symlinks at the game root, recording a restore point first. */
export function switchMod(modName: string, version: string): Promise<void> {
  return invoke('cnc_switch_mod', { modName, version })
}

/** Launches modded.exe (falling back to Generals.exe) from the game root. */
export function launchGame(): Promise<void> {
  return invoke('cnc_launch_game')
}

/** Undoes the most recent switch, returning the game root to its pre-switch state. */
export function restoreBackup(): Promise<void> {
  return invoke('cnc_restore_backup')
}
