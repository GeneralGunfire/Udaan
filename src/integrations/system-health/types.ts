export interface MemoryStats {
  totalBytes: number
  usedBytes: number
  freeBytes: number
}

export interface DiskStats {
  name: string
  mountPoint: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
}

export interface SystemStats {
  memory: MemoryStats
  disks: DiskStats[]
}
