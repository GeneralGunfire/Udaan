import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { spring, duration, zIndex, prefersReducedMotion } from '@/shared/lib/motion'
import { readTextPreview } from '@/integrations/file-explorer/client'
import { openFileWith } from '@/integrations/installed-apps/client'
import { useImageThumbnail } from '../hooks/useImageThumbnail'
import { formatFileSize, formatModified, fileKind } from '../lib/fileKind'
import { iconForKind } from '../lib/iconForKind'
import { openFileWithBestHandler, NoHandlerError } from '../lib/openFile'
import { OpenInAppMenu } from './OpenInAppMenu'
import { WindowCloseIcon } from '@/shared/icons'
import type { FileEntry } from '@/integrations/file-explorer/types'

interface FilePreviewModalProps {
  entry: FileEntry | null
  onClose: () => void
}

/**
 * Preview-first file opening: double-click always opens this modal first
 * (image/text render inline, other types show an icon + file-info card).
 * Opening the real file externally is always an explicit confirmed step
 * via "Open in App ▾" — never automatic — and the picker lets the user
 * choose a specific installed handler instead of always taking the
 * system default.
 */
export function FilePreviewModal({ entry, onClose }: FilePreviewModalProps) {
  const reduced = prefersReducedMotion()
  const kind = entry ? fileKind(entry.extension, entry.isDir) : 'other'
  const imageUrl = useImageThumbnail(kind === 'image' ? entry?.path ?? null : null)
  const [textContent, setTextContent] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    if (entry && kind === 'text') {
      readTextPreview(entry.path)
        .then(setTextContent)
        .catch(() => setTextContent(null))
    } else {
      setTextContent(null)
    }
  }, [entry, kind])

  useEffect(() => {
    setOpenError(null)
  }, [entry])

  // Matches the Escape-to-close convention every other overlay in the app
  // follows (Launchpad, WallpaperPicker) — this one previously only closed
  // via the backdrop click or the header's close button.
  useEffect(() => {
    if (!entry) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [entry, onClose])

  const Icon = entry ? iconForKind(kind) : iconForKind('other')

  async function handleChooseHandler(exePath: string | null) {
    if (!entry) return
    setOpenError(null)
    try {
      if (exePath) {
        await openFileWith(exePath, entry.path)
      } else {
        await openFileWithBestHandler(entry)
      }
    } catch (err) {
      setOpenError(err instanceof NoHandlerError ? err.message : `Couldn't open "${entry.name}".`)
    }
  }

  return (
    <AnimatePresence>
      {entry && (
        <div className="fixed inset-0" style={{ zIndex: zIndex.overlay }}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : duration.backdrop }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
              transition={spring.panel}
              className="glass-surface flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
              style={{ boxShadow: 'var(--shadow-panel)' }}
            >
              <div className="border-hairline flex items-center justify-between gap-3 border-b px-4 py-3">
                <span className="text-text-primary min-w-0 truncate text-sm font-medium">{entry.name}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <OpenInAppMenu extension={entry.extension} onChoose={handleChooseHandler} />
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close preview"
                    className="text-text-tertiary hover:text-text-primary flex h-7 w-7 items-center justify-center rounded-lg hover:bg-(--os-hover)"
                  >
                    <WindowCloseIcon width={14} height={14} />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                {kind === 'image' && imageUrl && (
                  <img src={imageUrl} alt={entry.name} className="mx-auto max-h-[60vh] rounded-lg object-contain" />
                )}
                {kind === 'text' && (
                  <pre className="text-text-secondary font-mono whitespace-pre-wrap text-xs leading-relaxed">
                    {textContent ?? 'Loading…'}
                  </pre>
                )}
                {kind !== 'image' && kind !== 'text' && (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <Icon width={40} height={40} className="text-text-tertiary" />
                    <p className="text-text-secondary text-sm">{entry.name}</p>
                    <p className="text-text-tertiary text-xs">
                      {formatFileSize(entry.sizeBytes)} · Modified {formatModified(entry.modifiedMs)}
                    </p>
                  </div>
                )}
                {openError && <p className="text-danger mt-3 text-center text-xs">{openError}</p>}
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  )
}
