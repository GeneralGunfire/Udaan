import { invoke } from '@tauri-apps/api/core'

/**
 * Disk and memory readouts from the Rust side (`system_health_stats`).
 * Field names are snake_case because they come straight off the Rust
 * structs — the app's convention is to map at the boundary only where a
 * component actually benefits, and these are passed through to a readout
 * verbatim.
 */
export interface MemoryStats {
  total_bytes: number
  used_bytes: number
  free_bytes: number
}

export interface DiskStats {
  name: string
  mount_point: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
}

export interface SystemStats {
  memory: MemoryStats
  disks: DiskStats[]
}

export function systemHealthStats(): Promise<SystemStats> {
  return invoke('system_health_stats')
}
