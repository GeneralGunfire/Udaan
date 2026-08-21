import { motion } from 'framer-motion'
import udaanMark from '@/assets/udaan-mark.png'
import { Composer } from './components/Composer'

/**
 * Home view — General Chat. Replaces the old Dashboard landing page.
 * Signature moment is the radial glow behind the composer card.
 */
export function GeneralChatView() {
  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center px-6">
      <div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2"
        style={{
          background:
            'radial-gradient(circle, rgb(127 224 208 / 30%) 0%, rgb(24 95 165 / 18%) 40%, transparent 70%)',
          filter: 'blur(20px)',
        }}
      />

      <motion.img
        src={udaanMark}
        alt=""
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="relative mb-3 h-16 w-16 object-contain"
        style={{
          filter:
            'drop-shadow(0 4px 28px rgb(55 180 200 / 55%)) drop-shadow(0 2px 12px rgb(0 0 0 / 70%))',
        }}
      />

      <h2
        className="font-display relative mb-1.5 text-center text-[17px] font-bold tracking-[0.28em] text-white"
        style={{
          textShadow: '0 2px 18px rgb(0 0 0 / 80%), 0 1px 4px rgb(0 0 0 / 95%)',
        }}
      >
        UDAAN
      </h2>

      <h1
        className="font-display relative mb-2 text-center text-[26px] leading-tight font-semibold text-balance text-white"
        style={{
          textShadow: '0 2px 20px rgb(0 0 0 / 75%), 0 1px 3px rgb(0 0 0 / 90%)',
        }}
      >
        Your ideas, set in motion
      </h1>
      <p
        className="relative mb-6 max-w-md text-center text-[12px] leading-relaxed text-white/70"
        style={{ textShadow: '0 1px 12px rgb(0 0 0 / 70%)' }}
      >
        One workstation for School, Work, Creativity, and everything else —
        local models, routing, and Claude, in a single command bar.
      </p>

      <Composer />
    </div>
  )
}
