import {
  FolderIcon,
  ImageIcon,
  WaveformIcon,
  FilmIcon,
  FileTextIcon,
  PdfFileIcon,
  GenericFileIcon,
  type IconComponent,
} from '@/shared/icons'
import type { FileKind } from './fileKind'

const ICON_BY_KIND: Record<FileKind, IconComponent> = {
  folder: FolderIcon,
  image: ImageIcon,
  audio: WaveformIcon,
  video: FilmIcon,
  text: FileTextIcon,
  pdf: PdfFileIcon,
  other: GenericFileIcon,
}

export function iconForKind(kind: FileKind): IconComponent {
  return ICON_BY_KIND[kind]
}
