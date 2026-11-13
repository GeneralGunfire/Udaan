import { AnimatePresence, motion } from 'framer-motion'
import { spring } from '@/shared/lib/motion'
import { Button } from '@/shared/components/ui/button'
import { ClipboardIcon, WindowCloseIcon } from '@/shared/icons'
import type { ClipboardState } from '../lib/types'

interface ClipboardStatusBarProps {
  clipboard: ClipboardState | null
  onPaste: () => void
  onClear: () => void
}

/** Persistent strip showing what's on the clipboard and ready to paste — makes copy/cut state visible instead of invisible. */
export function ClipboardStatusBar({ clipboard, onPaste, onClear }: ClipboardStatusBarProps) {
  return (
    <AnimatePresence>
      {clipboard && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={spring.standard}
          className="border-hairline bg-surface-hover flex items-center gap-2 overflow-hidden border-t px-3 py-2"
        >
          <ClipboardIcon width={14} height={14} className="text-text-tertiary shrink-0" />
          <span className="text-text-secondary min-w-0 flex-1 truncate text-xs">
            {clipboard.paths.length} item{clipboard.paths.length === 1 ? '' : 's'}{' '}
            {clipboard.mode === 'cut' ? 'cut' : 'copied'} — ready to paste
          </span>
          <Button type="button" variant="surface" size="pill-sm" onClick={onPaste}>
            Paste here
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear clipboard">
            <WindowCloseIcon width={12} height={12} />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
