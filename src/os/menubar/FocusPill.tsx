import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { usePref } from '@/os/kernel/prefs'
import { springs } from '@/os/motion/systemMotion'
import { launchApp } from '@/integrations/installed-apps/client'
import { cn } from '@/shared/lib/cn'

const VIDEO_ID = 'vxAe5Qpqc54'
const TITLE = 'The First Man to Beat Mike Tyson'
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`

const COLLAPSED = { width: 34, height: 6 }
const EXPANDED = { width: 292, height: 24 }
const COLLAPSE_DELAY_MS = 260

/**
 * The motivation video, always there and never in the way. It plays from a
 * hidden 1px embed, served by Udaan's own loopback page (YouTube refuses the
 * app's internal origin, see focus_video.rs); the pill in the middle of the menu bar is its only face.
 * Idle, it's a thin sliver (with a tiny equalizer while playing); hover and
 * it opens into the title and a play/pause button.
 */
export function FocusPill() {
  const [paused, setPaused] = usePref('focus.paused')
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Whether the player has said anything at all. A blocked embed stays silent; a working one chatters.
  const heard = useRef(false)
  // The embed is created once; whether it starts playing is decided then.
  const startPaused = useRef(paused)

  // The address of the local page that hosts the player; the server may still be starting.
  const [origin, setOrigin] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    let tries = 0
    const look = () => {
      void invoke<number | null>('focus_video_port').then((port) => {
        if (off) return
        if (port) setOrigin(`http://127.0.0.1:${port}`)
        else if (++tries < 30) setTimeout(look, 300)
        else setFailed(true)
      }, () => !off && setFailed(true))
    }
    look()
    return () => {
      off = true
    }
  }, [])

  useEffect(() => {
    if (!origin) return
    const t = setTimeout(() => {
      if (!heard.current) setFailed(true)
    }, 12000)
    return () => clearTimeout(t)
  }, [origin])

  const command = useCallback(
    (func: 'playVideo' | 'pauseVideo') => {
      if (origin) frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), origin)
    },
    [origin],
  )

  // The player reports its state and errors by message once we say we're listening.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!origin || e.origin !== origin || typeof e.data !== 'string') return
      let data: { event?: string; info?: unknown }
      try {
        data = JSON.parse(e.data)
      } catch {
        return
      }
      heard.current = true
      // YouTube states: 1 playing, 3 buffering (still on its way to playing), 2 paused, 0 ended, -1/5 not started.
      const state = data.event === 'onStateChange' ? data.info : data.event === 'infoDelivery' && typeof data.info === 'object' && data.info && 'playerState' in data.info ? (data.info as { playerState: number }).playerState : undefined
      if (typeof state === 'number') {
        setPlaying(state === 1 || state === 3)
        setFailed(false)
      } else if (data.event === 'onError') setFailed(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin])

  const toggle = () => {
    if (failed) {
      // Embeds can be refused; the video itself still opens.
      void launchApp(WATCH_URL)
      return
    }
    const next = !paused
    void setPaused(next)
    command(next ? 'pauseVideo' : 'playVideo')
    // Show the result at once; the player's own report corrects it a moment later if needed.
    setPlaying(!next)
  }

  const show = () => {
    clearTimeout(closeTimer.current)
    setOpen(true)
    // Autoplay can be blocked until the user has touched the page once.
    if (!paused && !playing && !failed) command('playVideo')
  }
  const hide = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), COLLAPSE_DELAY_MS)
  }
  useEffect(() => () => clearTimeout(closeTimer.current), [])

  const live = playing && !paused

  return (
    <>
      {origin && (
        <iframe
          ref={frame}
          title="Focus video"
          src={`${origin}/?paused=${startPaused.current ? 1 : 0}`}
          allow="autoplay; encrypted-media"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-[0.01]"
        />
      )}
      <motion.div
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        animate={open ? EXPANDED : COLLAPSED}
        transition={springs.flyout}
        className={cn(
          'absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full',
          open ? 'bg-[var(--os-menu-item-hover)]' : live ? 'bg-[var(--os-menu-text)]/20' : 'bg-[var(--os-menu-text)]/10',
        )}
      >
        {!open && live && (
          <span className="flex h-[4px] items-end gap-[2px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="w-[2px] animate-[eq_0.9s_ease-in-out_infinite] rounded-full bg-[var(--os-menu-text)]/70" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </span>
        )}
        {open && (
          <motion.button
            type="button"
            onClick={toggle}
            aria-label={live ? 'Pause motivation video' : 'Play motivation video'}
            title={failed ? 'Open on YouTube' : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12, delay: 0.05 }}
            className="flex h-full w-full items-center gap-2 px-2.5 text-[12px]"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" className="shrink-0">
              <path d={live ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l11-6.5z'} />
            </svg>
            <span className="truncate font-medium">{failed ? 'Open on YouTube' : TITLE}</span>
          </motion.button>
        )}
      </motion.div>
    </>
  )
}
