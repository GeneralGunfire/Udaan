/**
 * Windows shell-replacement safety controls — thin wrapper over the Rust
 * `shell_replace` module (src-tauri/src/shell_replace/mod.rs). Every write
 * here touches `HKLM\...\Winlogon\Shell`, so this client is deliberately
 * tiny and only ever called from the explicit Safe Mode panel — nothing
 * else in the app imports it.
 */
import { invoke } from '@tauri-apps/api/core'

export interface ShellStatus {
  currentShellValue: string
  hasBackup: boolean
  udaanIsShell: boolean
  backupFilePath: string
  isElevated: boolean
}

interface RawShellStatus {
  current_shell_value: string
  has_backup: boolean
  udaan_is_shell: boolean
  backup_file_path: string
  is_elevated: boolean
}

function fromRaw(raw: RawShellStatus): ShellStatus {
  return {
    currentShellValue: raw.current_shell_value,
    hasBackup: raw.has_backup,
    udaanIsShell: raw.udaan_is_shell,
    backupFilePath: raw.backup_file_path,
    isElevated: raw.is_elevated,
  }
}

/** Current status — safe to call anytime, never modifies anything. */
export async function shellStatus(): Promise<ShellStatus> {
  return fromRaw(await invoke<RawShellStatus>('shell_status'))
}

/** Backs up the CURRENT shell registry value to disk (plain text + a standalone .reg file) before anything is ever changed. */
export async function shellBackupCurrentValue(): Promise<ShellStatus> {
  return fromRaw(await invoke<RawShellStatus>('shell_backup_current_value'))
}

/** The in-app "Safe Mode" escape hatch — restores the backed-up (or default explorer.exe) shell value and relaunches explorer.exe immediately, no logoff required. May trigger a Windows UAC prompt. */
export async function shellRestoreDefault(): Promise<void> {
  await invoke('shell_restore_default')
}

/**
 * THE actual shell switch — sets Winlogon\Shell to shell-watchdog.exe,
 * which will launch Udaan (falling back to explorer.exe if it crashes or
 * fails to start) on the NEXT login/restart. Auto-backs-up the current
 * value first if none exists, and refuses to proceed if shell-watchdog.exe
 * isn't actually found next to Udaan.exe. May trigger a Windows UAC
 * prompt. Takes effect on next login, not immediately.
 */
export async function shellSetToUdaan(): Promise<ShellStatus> {
  return fromRaw(await invoke<RawShellStatus>('shell_set_to_udaan'))
}
