import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { fittedWallpaperSrc } from '@/app/wallpapers'
import { playSound } from '@/os/sound/sounds'
import { Button } from '@/os/ui/controls'
import { verifyWorkPassword, workLockWallpaperId } from '@/os/kernel/profile'

/**
 * The Work lock screen: shown when Work is opened from Start, after 3 idle minutes in Work, and after
 * Udaan restarts while in Work. It is its own lock with its own password, separate from Udaan Lock.
 *
 * The backdrop is fixed: the white studio wallpaper with the DEXA logo and its reflection. It is not
 * changeable here. Nothing sits on the middle of the screen: the clock is above the logo, the password below.
 * `inWork` is true when Work is already the active profile (an idle or restart relock): the link under
 * the password then leaves Work. Otherwise it just backs out.
 */
export function WorkLock({ inWork, onUnlock, onBack }: { inWork: boolean; onUnlock: () => void | Promise<void>; onBack: () => void }) {
  const [wallpaper, setWallpaper] = useState<{ src: string; color: string }>({ src: '', color: '#eef0f3' })
  const [now, setNow] = useState(() => new Date())
  const [text, setText] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  const shake = useAnimationControls()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    void workLockWallpaperId().then(async (id) => {
      if (id.startsWith('color:')) return live && setWallpaper({ src: '', color: id.slice(6) })
      const src = await fittedWallpaperSrc(id)
      if (live) setWallpaper((w) => ({ ...w, src }))
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The backdrop is the light studio picture, so the text sitting straight on it is dark.
  const ink = '#14213d'

  const submit = useCallback(async () => {
    if (busy || !text) return
    setBusy(true)
    if (await verifyWorkPassword(text)) {
      playSound('unlock')
      await onUnlock()
      return
    }
    playSound('error')
    setWrong(true)
    setText('')
    setBusy(false)
    void shake.start({ x: [0, -12, 10, -6, 4, 0], transition: { duration: 0.35 } })
    inputRef.current?.focus()
  }, [busy, text, onUnlock, shake])

  return (
    <motion.div
      role="dialog"
      aria-label="Work lock"
      className="fixed inset-0 z-[110] cursor-default select-none overflow-hidden"
      style={{ background: wallpaper.color, color: ink }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !inWork) onBack()
      }}
    >
      {wallpaper.src && <img src={wallpaper.src} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}

      {/* Time, above the logo */}
      <div className="absolute inset-x-0 top-[8vh] flex flex-col items-center">
        <p className="text-[15px] font-medium tracking-wide opacity-70">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p className="mt-1 text-[84px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</p>
      </div>

      {/* Password and wallpapers, below it */}
      <div className="absolute inset-x-0 bottom-[6vh] flex flex-col items-center">
        <motion.form
          animate={shake}
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
          className="flex h-[46px] w-[320px] items-center rounded-full bg-(--u-mat-surface) pl-4 pr-1.5 text-(--u-ink)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <input
            ref={inputRef}
            type="password"
            aria-label="Work password"
            placeholder="Work password"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (wrong) setWrong(false)
            }}
            className="mx-3 h-full min-w-0 flex-1 bg-transparent text-[15px] text-(--u-ink) outline-none placeholder:opacity-50"
          />
          <Button type="submit" variant="primary" icon pill aria-label="Unlock Work" disabled={!text || busy} className="h-[34px] w-[34px] shrink-0">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Button>
        </motion.form>

        <p className="mt-2.5 h-[18px] text-[12.5px]" style={{ color: wrong ? '#c62828' : undefined, opacity: wrong ? 1 : 0.85 }}>
          {wrong ? 'Incorrect password, try again' : inWork ? 'Work is locked' : 'Enter your Work password'}
        </p>

        <button type="button" onClick={onBack} className="mt-1 rounded-full px-3.5 py-1 text-[12.5px] opacity-80 hover:opacity-100">
          {inWork ? 'Switch to Personal' : 'Cancel'}
        </button>

      </div>
    </motion.div>
  )
}
