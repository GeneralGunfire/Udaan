/**
 * Stage 2 boot performance pass — thin wrapper over the Rust
 * `boot_optimize` module (src-tauri/src/boot_optimize/mod.rs). Only ever
 * called once, from the splash screen, on startup.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface StartupProgram {
  name: string
  command: string
  source: string
}

export interface BootOptimizeReport {
  tempFilesDeleted: number
  tempBytesFreed: number
  startupPrograms: StartupProgram[]
  diskFreeBytes: number
  diskTotalBytes: number
  memoryFreeBytes: number
  memoryTotalBytes: number
  dnsCacheFlushed: boolean
  logFilePath: string
}

interface RawBootOptimizeReport {
  temp_files_deleted: number
  temp_bytes_freed: number
  startup_programs: StartupProgram[]
  disk_free_bytes: number
  disk_total_bytes: number
  memory_free_bytes: number
  memory_total_bytes: number
  dns_cache_flushed: boolean
  log_file_path: string
}

function fromRaw(raw: RawBootOptimizeReport): BootOptimizeReport {
  return {
    tempFilesDeleted: raw.temp_files_deleted,
    tempBytesFreed: raw.temp_bytes_freed,
    startupPrograms: raw.startup_programs,
    diskFreeBytes: raw.disk_free_bytes,
    diskTotalBytes: raw.disk_total_bytes,
    memoryFreeBytes: raw.memory_free_bytes,
    memoryTotalBytes: raw.memory_total_bytes,
    dnsCacheFlushed: raw.dns_cache_flushed,
    logFilePath: raw.log_file_path,
  }
}

export interface BootOptimizeProgress {
  step: string
  detail: string
}

/** Runs the full Stage 2 pass (temp cleanup, startup-program audit, disk/memory check, DNS flush). */
export async function runBootOptimize(): Promise<BootOptimizeReport> {
  const raw = await invoke<RawBootOptimizeReport>('boot_optimize_run')
  return fromRaw(raw)
}

/** Subscribes to granular sub-step progress emitted while `runBootOptimize` is in flight. */
export async function onBootOptimizeProgress(
  callback: (progress: BootOptimizeProgress) => void,
): Promise<() => void> {
  return listen<BootOptimizeProgress>('boot:optimize-progress', (event) => callback(event.payload))
}
