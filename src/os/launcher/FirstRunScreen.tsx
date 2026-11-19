import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SETUP_STEPS, isFreshInstall, runFirstRunSetup } from '@/os/kernel/firstRun'
import { setPref } from '@/os/kernel/prefs'
import { deactivateShell } from '@/os/kernel/session'

/**
 * The screen a new install shows while it gets this PC ready, so it is clear Udaan is working. It shows each
 * step, a progress bar, and a Stop button that keeps the defaults and goes straight to the desktop.
 * It appears only on a fresh install and only once.
 */
export function FirstRunScreen() {
  const [show, setShow] = useState(false)
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<boolean[]>(() => SETUP_STEPS.map(() => false))
  const [finished, setFinished] = useState(false)
  const stopped = useRef(false)
  // After the steps: which taskbar does the person want? Resolved by the two buttons below.
  const [choosing, setChoosing] = useState(false)
  const chosen = useRef<(() => void) | null>(null)

  useEffect(() => {
    let live = true
    void isFreshInstall().then(async (fresh) => {
      if (!fresh || !live) return
      setShow(true)
      await runFirstRunSetup({
        cancelled: () => stopped.current,
        onProgress: (i, status) => {
          if (!live) return
          setIndex(i)
          if (status === 'done') setDone((d) => d.map((v, k) => (k === i ? true : v)))
        },
      })
      if (!live) return
      if (!stopped.current) {
        setChoosing(true)
        await new Promise<void>((r) => (chosen.current = r))
        if (!live) return
        setChoosing(false)
      }
      setFinished(true)
      setTimeout(() => live && setShow(false), stopped.current ? 0 : 900)
    })
    return () => {
      live = false
    }
  }, [])

  const doneCount = done.filter(Boolean).length
  const pct = finished ? 100 : Math.round(((doneCount + 0.35) / SETUP_STEPS.length) * 100)

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="dialog"
          aria-label="Setting up Udaan"
          className="fixed inset-0 z-[130] flex cursor-default select-none flex-col items-center justify-center bg-black text-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          <p className="text-[34px] font-light uppercase tracking-[0.5em] pl-[0.5em]">Udaan</p>
          <p className="mt-3 text-[14px] text-white/55">{choosing ? 'One last thing: how should your desktop look?' : finished ? (stopped.current ? 'Setup stopped. Udaan is ready with its defaults.' : 'All set. Welcome.') : 'Getting this PC ready. This only happens once.'}</p>

          <div className="mt-10 w-[360px]">
            <div className="h-[3px] overflow-hidden rounded-full bg-white/15">
              <motion.div className="h-full rounded-full bg-white" initial={{ width: '4%' }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <ul className="mt-6 space-y-3">
              {SETUP_STEPS.map((s, i) => {
                const isDone = done[i]
                const active = !finished && i === index && !isDone
                return (
                  <li key={s.id} className="flex items-center gap-3">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${isDone ? 'bg-white text-black' : active ? 'border border-white/70' : 'border border-white/20'}`}>
                      {isDone ? '✓' : active ? <motion.span className="h-1.5 w-1.5 rounded-full bg-white" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[14px] ${isDone || active ? 'text-white' : 'text-white/40'}`}>{s.label}</span>
                      {active && <span className="block text-[12px] text-white/45">{s.detail}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          {choosing && (
            <div className="mt-8 flex gap-3">
              <button type="button" onClick={() => chosen.current?.()} className="rounded-2xl bg-white px-5 py-3 text-left text-[13.5px] font-semibold text-black transition hover:bg-white/90">
                Udaan dock and top bar
                <span className="mt-0.5 block text-[12px] font-normal text-black/55">Replaces the Windows taskbar</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void setPref('dock.enabled', false).then(() => deactivateShell())
                  chosen.current?.()
                }}
                className="rounded-2xl border border-white/25 px-5 py-3 text-left text-[13.5px] font-semibold text-white transition hover:bg-white/10"
              >
                Keep the Windows taskbar
                <span className="mt-0.5 block text-[12px] font-normal text-white/55">Udaan apps, your taskbar. Change any time in Settings.</span>
              </button>
            </div>
          )}

          {!finished && !choosing && (
            <button
              type="button"
              onClick={() => {
                stopped.current = true
                setFinished(true)
                setTimeout(() => setShow(false), 700)
              }}
              className="mt-10 rounded-full border border-white/25 px-5 py-1.5 text-[13px] text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              Stop and use defaults
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
