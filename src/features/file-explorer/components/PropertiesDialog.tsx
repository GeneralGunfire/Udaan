import { AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog'
import { fileKind, formatFileSize, formatModified } from '../lib/fileKind'
import { iconForKind } from '../lib/iconForKind'
import { parentPath } from '../lib/pathUtils'
import type { FileEntry } from '@/integrations/file-explorer/types'

interface PropertiesDialogProps {
  entry: FileEntry | null
  onOpenChange: (open: boolean) => void
}

export function PropertiesDialog({ entry, onOpenChange }: PropertiesDialogProps) {
  const kind = entry ? fileKind(entry.extension, entry.isDir) : 'other'
  const Icon = iconForKind(kind)

  return (
    <Dialog open={!!entry} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {entry && (
          <DialogContent className="max-w-md">
            <div className="flex items-center gap-3">
              <div className="border-hairline bg-surface-raised flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border">
                <Icon width={20} height={20} className="text-text-secondary" />
              </div>
              <DialogTitle className="text-text-primary min-w-0 truncate text-base font-semibold">
                {entry.name}
              </DialogTitle>
            </div>

            <dl className="mt-5 flex flex-col gap-2.5 text-xs">
              <Row label="Type">{entry.isDir ? 'Folder' : `${entry.extension.toUpperCase() || 'File'} file`}</Row>
              {!entry.isDir && <Row label="Size">{formatFileSize(entry.sizeBytes)}</Row>}
              <Row label="Location">{parentPath(entry.path) ?? entry.path}</Row>
              <Row label="Date created">{formatModified(entry.createdMs)}</Row>
              <Row label="Date modified">{formatModified(entry.modifiedMs)}</Row>
            </dl>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-text-tertiary shrink-0">{label}</dt>
      <dd className="text-text-secondary min-w-0 text-right break-all">{children}</dd>
    </div>
  )
}
