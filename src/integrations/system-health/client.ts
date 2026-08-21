import { invoke } from '@tauri-apps/api/core'
import type { SystemStats } from './types'

/**
 * Raw shape returned by the Rust `system_health_stats` command — Rust's
 * serde derive emits snake_case fields (total_bytes, mount_point, ...); we
 * normalize to camelCase here so the rest of the frontend never sees the
 * wire format.
 */
interface RawMemoryStats {
  total_bytes: number
  used_bytes: number
  free_bytes: number
}

interface RawDiskStats {
  name: string
  mount_point: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
}

interface RawSystemStats {
  memory: RawMemoryStats
  disks: RawDiskStats[]
}

/** Fetches real disk + RAM usage from the OS via the Rust `sysinfo`-backed command. */
export async function getSystemStats(): Promise<SystemStats> {
  const raw = await invoke<RawSystemStats>('system_health_stats')
  return {
    memory: {
      totalBytes: raw.memory.total_bytes,
      usedBytes: raw.memory.used_bytes,
      freeBytes: raw.memory.free_bytes,
    },
    disks: raw.disks.map((d) => ({
      name: d.name,
      mountPoint: d.mount_point,
      totalBytes: d.total_bytes,
      usedBytes: d.used_bytes,
      freeBytes: d.free_bytes,
    })),
  }
}
