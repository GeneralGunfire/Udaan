import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { AnalogClock } from '@/os/ui/AnalogClock'
import { invoke } from '@tauri-apps/api/core'
import { keepAwake } from '@/integrations/power-state'
import { Wallpaper } from '@/os/desktop/Wallpaper'
import { playSound } from '@/os/sound/sounds'
import { mediaCommand, sourceName, type NowPlaying } from '@/os/dock/panels/MediaPanel'

/** SHA-256 of the Udaan Lock PIN. It only ever stands between the desktop and a passer-by. */
const PIN_HASH = 'REMOVED-HASH'
const PIN_LENGTH = 4

async function sha256(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const ease = [0.16, 1, 0.3, 1] as const

function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

function useNowPlaying() {
  const [np, setNp] = useState<NowPlaying | null>(null)
  useEffect(() => {
    const poll = () => void invoke<NowPlaying | null>('shell_now_playing').then(setNp, () => {})
    poll()
    const t = setInterval(poll, 2500)
    return () => clearInterval(t)
  }, [])
  return np
}

/** The shared face of the screensaver and the lock screen: date over a large, light clock. */
function ClockFace({ now, compact }: { now: Date; compact: boolean }) {
  const hm = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  // Plain elements: animating font size / layout re-lays the page every frame.
  return (
    <div className="flex flex-col items-center text-white" style={{ textShadow: '0 2px 30px rgb(0 0 0 / 0.45)' }}>
      <p className="text-[22px] font-medium tracking-wide text-white/85">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <p className="font-semibold leading-[0.95] tracking-[-0.04em] tabular-nums" style={{ fontSize: compact ? '96px' : 'min(16vw, 190px)' }}>
        {hm}
      </p>
    </div>
  )
}

function MediaPill({ np }: { np: NowPlaying }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex w-[360px] items-center gap-3 rounded-[16px] border border-white/15 bg-black/30 p-3 text-white backdrop-blur-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-white/10">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M9 17.5a2.5 2.5 0 1 1-2.5-2.5c.4 0 .8.1 1.1.3V5.2L19 3v11.5a2.5 2.5 0 1 1-2.5-2.5c.4 0 .8.1 1.1.3V6.4l-8.6 1.7Z" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{np.title || 'Unknown'}</span>
        <span className="block truncate text-[12px] text-white/60">{np.artist || sourceName(np.source)}</span>
      </span>
      <button type="button" aria-label={np.playing ? 'Pause' : 'Play'} onClick={() => void mediaCommand('play-pause')} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d={np.playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l10.5-6.5Z'} />
        </svg>
      </button>
      <button type="button" aria-label="Next" disabled={!np.canNext} onClick={() => void mediaCommand('next')} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-30">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M5.5 6v12l8.5-6ZM15.5 6h2.5v12h-2.5z" />
        </svg>
      </button>
    </motion.div>
  )
}

/**
 * One wallpaper and a dark veil — no blurred copy and no moving layers:
 * full-screen blurs and zooms are what made locking slow on this PC.
 */
function Backdrop({ blur }: { blur: boolean }) {
  return (
    <>
      <Wallpaper />
      <div aria-hidden className="absolute inset-0 transition-colors duration-150" style={{ background: blur ? 'rgb(0 0 0 / 0.62)' : 'rgb(0 0 0 / 0.22)' }} />
    </>
  )
}

/**
 * The screensaver: a slow, continuous Ken-Burns drift across the wallpaper
 * (not a one-time zoom that settles and stops — the photograph keeps
 * breathing for as long as the screensaver is up, the way a real ambient
 * display does) with an always-on-display-style clock anchored low rather
 * than a card parked at centre screen. Any key or click ends it, and then
 * either returns to the desktop or, when the lock follows the screensaver,
 * hands over to the lock screen.
 */
export function Screensaver({ onDismiss }: { onDismiss: () => void }) {
  const now = useNow()
  const np = useNowPlaying()
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const hours = now.getHours()
  const displayHours = ((hours + 11) % 12) + 1
  const hh = String(displayHours).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  const period = hours >= 12 ? 'PM' : 'AM'

  useEffect(() => {
    void keepAwake(true)
    return () => void keepAwake(false)
  }, [])

  useEffect(() => {
    // Deliberate input only: the click that opened it would otherwise close it.
    const opened = Date.now()
    const end = () => Date.now() - opened > 400 && onDismiss()
    window.addEventListener('keydown', end)
    window.addEventListener('mousedown', end)
    return () => {
      window.removeEventListener('keydown', end)
      window.removeEventListener('mousedown', end)
    }
  }, [onDismiss])

  return (
    <motion.div
      className="fixed inset-0 z-[100] overflow-hidden bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
      transition={{ duration: 0.9, ease }}
    >
      {/* Continuous slow drift: scale and pan never settle to a fixed
          point, they loop back and forth so a screensaver left up for
          minutes still reads as alive rather than a still photo. */}
      <motion.div
        className="absolute -inset-[4%]"
        initial={{ scale: 1.1, x: 0, y: 0 }}
        animate={{ scale: [1.1, 1.18, 1.1], x: ['0%', '-1.5%', '0%'], y: ['0%', '1%', '0%'] }}
        transition={{ duration: 42, ease: 'easeInOut', repeat: Infinity }}
      >
        <Wallpaper />
      </motion.div>
      <div aria-hidden className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgb(0 0 0 / 0.5) 0%, rgb(0 0 0 / 0.1) 35%, transparent 55%)' }} />

      {/* AOD-style clock: anchored low-left, large ultra-light numerals
          directly on the photograph rather than a centred card — the
          image stays the subject, the time reads as part of it. */}
      <motion.div
        className="absolute bottom-[13%] left-[7%] flex items-end gap-8"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease, delay: 0.2 }}
      >
        <AnalogClock size="min(30vh, 300px)" />
        <div className="flex flex-col items-start pb-2" style={{ textShadow: '0 2px 24px rgb(0 0 0 / 0.5), 0 1px 4px rgb(0 0 0 / 0.4)' }}>
          <span className="text-[13px] font-medium tracking-wide text-white/70">{dateLabel}</span>
          <span className="text-[min(6vw,64px)] font-extralight leading-none tracking-[-0.02em] text-white" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {hh}
            <span className="text-white/60">:{mm}</span>
          </span>
          <span className="mt-1.5 text-[13px] font-medium tabular-nums text-white/55">
            {ss}s · {period}
          </span>
        </div>
      </motion.div>

      <div className="absolute bottom-[13%] right-[7%] flex flex-col items-end gap-5">
        <AnimatePresence>{np && <MediaPill np={np} />}</AnimatePresence>
      </div>
      <motion.p
        className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[11px] font-medium uppercase tracking-[0.2em] text-white/35"
        style={{ textShadow: '0 1px 3px rgb(0 0 0 / 0.7)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.4 }}
      >
        Press any key to return
      </motion.p>
    </motion.div>
  )
}

/**
 * Udaan Lock: a PIN over the desktop. It's a courtesy lock, not a
 * security boundary (Task Manager still ends it), so it keeps itself in
 * front and focused rather than fighting the OS.
 */
export function LockScreen({ user, onUnlock }: { user: string; onUnlock: () => void }) {
  const now = useNow()
  const np = useNowPlaying()
  const [entering, setEntering] = useState(false)
  const [pin, setPin] = useState('')
  const [wrong, setWrong] = useState(0)
  const [unlocking, setUnlocking] = useState(false)
  const shake = useAnimationControls()
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = useCallback(
    async (value: string) => {
      if ((await sha256(value)) === PIN_HASH) {
        setUnlocking(true)
        playSound('unlock')
        setTimeout(onUnlock, 100)
      } else {
        playSound('error')
        setWrong((w) => w + 1)
        void shake.start({ x: [0, -14, 12, -8, 6, -3, 0], transition: { duration: 0.45 } })
        setPin('')
      }
    },
    [onUnlock, shake],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!entering) {
        setEntering(true)
        if (/^\d$/.test(e.key)) setPin(e.key)
        e.preventDefault()
        return
      }
      if (e.key === 'Escape') {
        setEntering(false)
        setPin('')
      } else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (/^\d$/.test(e.key)) setPin((p) => (p.length < PIN_LENGTH ? p + e.key : p))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entering])

  useEffect(() => {
    if (pin.length === PIN_LENGTH) void submit(pin)
  }, [pin, submit])

  useEffect(() => {
    if (entering) inputRef.current?.focus()
  }, [entering])

  const press = (d: string) => setPin((p) => (p.length < PIN_LENGTH ? p + d : p))

  return (
    <motion.div
      className="fixed inset-0 z-[110] cursor-default select-none overflow-hidden bg-black"
      // A quick fade in; unlocking is immediate.
      initial={{ opacity: 0 }}
      animate={{ opacity: unlocking ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: unlocking ? 0.1 : 0.15 }}
      onMouseDown={() => setEntering(true)}
    >
      <Backdrop blur={entering} />

      <motion.div
        className="absolute inset-x-0 flex justify-center"
        animate={{ top: entering ? '6vh' : '12vh' }}
        transition={{ duration: 0.5, ease }}
      >
        <ClockFace now={now} compact={entering} />
      </motion.div>

      <AnimatePresence mode="wait">
        {entering ? (
          <motion.div
            key="pin"
            className="absolute inset-x-0 top-0 bottom-0 flex flex-col items-center justify-center text-white"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.4, ease }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--color-accent)] text-[32px] font-semibold text-[var(--color-accent-contrast)] shadow-[0_10px_40px_rgb(0_0_0/0.35)]">{user.charAt(0).toUpperCase() || 'U'}</span>
            <p className="mt-3 text-[18px] font-medium">{user || 'Udaan'}</p>
            <p className="mt-0.5 text-[12.5px] text-white/60">{wrong > 0 ? 'Incorrect PIN — try again' : 'Enter your Udaan PIN'}</p>

            <motion.div animate={shake} className="mt-5 flex gap-5">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <motion.span
                  key={i}
                  className="h-4 w-4 rounded-full border-2 border-white/60"
                  animate={{
                    backgroundColor: i < pin.length ? 'rgb(255 255 255 / 1)' : 'rgb(255 255 255 / 0)',
                    borderColor: i < pin.length ? 'rgb(255 255 255 / 1)' : 'rgb(255 255 255 / 0.6)',
                    scale: i === pin.length - 1 ? [0.8, 1.3, 1] : 1,
                  }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                />
              ))}
            </motion.div>
            <input ref={inputRef} aria-label="PIN" className="sr-only" inputMode="numeric" value={pin} readOnly />

            <div className="mt-8 grid grid-cols-3 gap-3.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
                k === '' ? (
                  <span key={i} />
                ) : (
                  <motion.button
                    key={i}
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    onClick={() => (k === '⌫' ? setPin((p) => p.slice(0, -1)) : press(k))}
                    // A lit top edge and a dark bottom: the key reads as a
                    // physical button on glass rather than a flat circle.
                    className="flex h-[66px] w-[66px] items-center justify-center rounded-full border border-white/10 bg-white/[0.12] text-[24px] font-medium shadow-[inset_0_1px_0_rgb(255_255_255/0.22),inset_0_-1px_0_rgb(0_0_0/0.18),0_2px_8px_rgb(0_0_0/0.2)] backdrop-blur-xl transition-[background-color] duration-100 hover:bg-white/[0.22] active:bg-white/30"
                  >
                    {k}
                  </motion.button>
                ),
              )}
            </div>
            <button type="button" onClick={() => { setEntering(false); setPin('') }} className="mt-5 rounded-full px-4 py-1.5 text-[12.5px] text-white/60 hover:bg-white/10 hover:text-white">
              Cancel
            </button>
          </motion.div>
        ) : (
          <motion.div key="hint" className="absolute inset-x-0 bottom-[8vh] flex flex-col items-center gap-5" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.5, ease }}>
            <AnimatePresence>{np && <MediaPill np={np} />}</AnimatePresence>
            <p className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.2em] text-white/50">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              Locked · click or press any key
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
