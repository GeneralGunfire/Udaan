export interface SymlinkPrecondition {
  can_create_symlinks: boolean
  developer_mode_enabled: boolean
  is_admin: boolean
}

export interface InstalledMod {
  name: string
  version: string
  file_count: number
}

export interface GameStatus {
  drive_connected: boolean
  game_root: string | null
  precondition: SymlinkPrecondition
  installed_mods: InstalledMod[]
  has_backup: boolean
}
