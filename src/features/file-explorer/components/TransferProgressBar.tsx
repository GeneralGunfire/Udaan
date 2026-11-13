import { AnimatePresence, motion } from 'framer-motion'
import { spring } from '@/shared/lib/motion'
import type { ActiveTransfer } from '../hooks/useTransferProgress'

interface TransferProgressBarProps {
  transfer: ActiveTransfer | null
}

/** Shown only for transfers substantial enough to take a moment — small copies finish before the backend emits a first progress event. */
export function TransferProgressBar({ transfer }: TransferProgressBarProps) {
  const known = !!transfer && transfer.total > 0
  const percent = known ? Math.min(100, Math.round((transfer.done / transfer.total) * 100)) : 0

  return (
    <AnimatePresence>
      {transfer && known && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={spring.standard}
          className="border-hairline bg-surface-hover overflow-hidden border-t px-3 py-2"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-secondary min-w-0 flex-1 truncate text-xs">
              {transfer.label} — {transfer.currentName || '…'}
            </span>
            <span className="text-text-tertiary shrink-0 text-2xs tabular-nums">
              {transfer.done} / {transfer.total}
            </span>
          </div>
          <div className="bg-surface-overlay mt-1.5 h-1 overflow-hidden rounded-full">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'var(--color-accent)' }}
              animate={{ width: `${percent}%` }}
              transition={{ duration: 0.15 }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
