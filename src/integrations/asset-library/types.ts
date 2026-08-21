export type AssetKind = 'image' | 'video' | 'other'

export interface AssetEntry {
  /** Absolute filesystem path — the stable identity for an asset. */
  path: string
  fileName: string
  sizeBytes: number
  kind: AssetKind
}
