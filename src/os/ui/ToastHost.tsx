import { AnimatePresence, motion } from 'framer-motion'
import { curve, dur } from '@/os/motion/systemMotion'
import { dismissToast, useToasts } from './toasts'

/** Bottom-right banners above the dock, like Windows toasts. */
export function ToastHost({ bottomOffset }: { bottomOffset: number }) {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed right-4 z-50 flex w-[364px] flex-col gap-2" style={{ bottom: bottomOffset }}>
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0, transition: { duration: dur.normal, ease: curve.decelerate } }}
            exit={{ opacity: 0, x: 40, transition: { duration: dur.fast, ease: curve.accelerate } }}
            className="os-acrylic pointer-events-auto rounded-[var(--os-radius-overlay)] px-4 py-3"
            onClick={() => dismissToast(t.id)}
          >
            <p className={t.tone === 'error' ? 'text-[13px] font-semibold text-[var(--color-danger)]' : 'text-[13px] font-semibold text-(--os-text)'}>
              {t.title}
            </p>
            {t.body && <p className="mt-0.5 text-[12px] leading-snug text-(--os-text-dim)">{t.body}</p>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
