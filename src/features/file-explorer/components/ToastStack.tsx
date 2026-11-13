import { AnimatePresence, motion } from 'framer-motion'
import { spring, zIndex } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import type { Toast } from '../hooks/useToasts'

interface ToastStackProps {
  toasts: Toast[]
}

/** Bottom-center toast stack for transfer/action confirmations (Copied, Moved, etc.). */
export function ToastStack({ toasts }: ToastStackProps) {
  return (
    <div
      className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5"
      style={{ zIndex: zIndex.tooltip }}
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={spring.standard}
            className={cn(
              'glass-surface border-hairline rounded-full border px-3.5 py-2 text-xs font-medium',
              toast.tone === 'danger' ? 'text-danger' : 'text-text-primary',
            )}
            style={{ boxShadow: 'var(--shadow-panel)' }}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
