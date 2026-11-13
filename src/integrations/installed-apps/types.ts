export type AppGroup = 'microsoft' | 'other'

export interface DetectedApp {
  id: string
  name: string
  group: AppGroup
  path: string
}

export interface FileHandler {
  name: string
  exePath: string
  isDefault: boolean
}
