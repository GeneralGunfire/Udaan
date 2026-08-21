export interface ScreenshotEntry {
  path: string
  fileName: string
  createdAt: string
}

export interface MonitorInfo {
  id: number
  name: string
  isPrimary: boolean
}

export interface WindowInfo {
  id: number
  title: string
}
