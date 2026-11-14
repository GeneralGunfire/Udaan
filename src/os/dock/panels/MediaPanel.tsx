import { AnimatePresence, motion } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { openApp } from '@/os/kernel/shell'
import { formatClock, useNowPlaying } from './useNowPlaying'
import { Slider } from '@/os/ui/controls'
import { springs } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'

export interface NowPlaying {
  title: string
  artist: string
  album: string
  source: string
  playing: boolean
  canNext: boolean
  canPrevious: boolean
  /** Album art as a data URL, when the playing app provides it. */
  thumbnail?: string | null
  positionMs?: number | null
  durationMs?: number | null
  canSeek?: boolean
}

/** "Spotify.exe" / "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" → readable app name. */
export function sourceName(source: string): string {
  const base = source.split('!').pop()!.split(/[\\/]/).pop()!.replace(/\.exe$/i, '')
  const name = base.split('.').pop() ?? base
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export function mediaCommand(command: 'play-pause' | 'next' | 'previous') {
  return invoke('shell_media_command', { command }).catch(() => {})
}

export function seekMedia(positionMs: number) {
  return invoke('shell_media_seek', { positionMs: Math.round(positionMs) }).catch(() => {})
}

/** Opens the Live DJ board on whatever is playing. */
export function openLiveDj() {
  void openApp('live-dj')
  void emit('taskbar-popup:hide')
}

const PATHS = {
  prev: 'M6 5h2v14H6zM20 5v14L9 12z',
  next: 'M16 5h2v14h-2zM4 5v14l11-7z',
  play: 'M8 5.5v13l11-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
}

function Control({ label, path, onClick, disabled, big }: { label: string; path: string; onClick: () => void; disabled?: boolean; big?: boolean }) {
  const reduced = prefersReducedMotion()
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileHover={reduced || disabled ? undefined : { scale: big ? 1.07 : 1.1 }}
      whileTap={reduced || disabled ? undefined : { scale: 0.9 }}
      transition={springs.snap}
      className={
        big
          ? 'flex h-12 w-12 items-center justify-center rounded-full bg-(--os-text) text-(--surface-base) shadow-(--os-shadow-md)'
          : 'flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-(--os-hover) disabled:opacity-30'
      }
    >
      {/* The glyph crossfades between play and pause rather than swapping. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg
          key={path}
          viewBox="0 0 24 24"
          width={big ? 22 : 18}
          height={big ? 22 : 18}
          fill="currentColor"
          initial={reduced ? false : { opacity: 0, scale: 0.6, rotate: -20 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={reduced ? undefined : { opacity: 0, scale: 0.6, rotate: 20 }}
          transition={{ duration: 0.12 }}
        >
          <path d={path} />
        </motion.svg>
      </AnimatePresence>
    </motion.button>
  )
}

/** Artwork from the playing app, or a tinted initial when it sends none. */
export function Artwork({ m, size, radius = 12 }: { m: NowPlaying; size: number; radius?: number }) {
  if (m.thumbnail) return <img src={m.thumbnail} alt="" width={size} height={size} className="shrink-0 object-cover shadow-lg" style={{ width: size, height: size, borderRadius: radius }} />
  return (
    <span
      className="flex shrink-0 items-center justify-center font-semibold shadow-lg"
      style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.4, background: 'var(--color-accent)', color: 'var(--color-accent-contrast)' }}
    >
      {(m.title || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Four bars that dance while playing and rest flat when paused. */
function Bars({ playing }: { playing: boolean }) {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[2.5px] origin-bottom rounded-full bg-accent"
          style={{ height: 12 }}
          animate={playing ? { scaleY: [0.25, 1, 0.45, 0.85, 0.25] } : { scaleY: 0.25 }}
          transition={playing ? { duration: 1 + i * 0.13, repeat: Infinity, ease: 'easeInOut', delay: i * 0.09 } : { duration: 0.25 }}
        />
      ))}
    </span>
  )
}

/** Now Playing for whatever app is playing media, anywhere on the system. */
export function MediaPanel() {
  const { media: m, loaded, positionMs, pin } = useNowPlaying(1000)
  const reduced = prefersReducedMotion()

  if (loaded && !m) {
    return (
      <div className="flex flex-col items-center gap-1 p-6 text-center">
        <p className="text-[13px] font-medium">Nothing is playing</p>
        <p className="text-[12px] text-(--os-text-dim)">Play something in a browser or music app and it shows up here.</p>
      </div>
    )
  }
  if (!m) return <div className="h-40" />

  const hasTimeline = m.durationMs != null && positionMs != null

  return (
    <div className="relative isolate flex flex-col gap-4 overflow-hidden p-4">
      {/* The album art, enlarged and blurred behind everything, so the panel
          takes on the colour of what is playing. Static, so it costs nothing
          after the first paint. */}
      {m.thumbnail && (
        <motion.img
          key={m.thumbnail}
          src={m.thumbnail}
          alt=""
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.38 }}
          transition={{ duration: 0.6 }}
          className="pointer-events-none absolute -inset-10 -z-10 h-[140%] w-[140%] max-w-none object-cover"
          style={{ filter: 'blur(36px) saturate(1.5)' }}
        />
      )}

      <div className="flex w-full items-center gap-3.5">
        {/* Artwork swells while playing and settles back when paused. */}
        <motion.div animate={{ scale: m.playing ? 1 : 0.92, opacity: m.playing ? 1 : 0.85 }} transition={reduced ? { duration: 0 } : springs.settle}>
          <Artwork m={m} size={72} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={m.title + m.artist} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -5 }} transition={{ duration: 0.16 }}>
              <p className="truncate text-[15px] font-semibold" title={m.title}>
                {m.title}
              </p>
              <p className="truncate text-[13px] text-(--os-text-dim)">{m.artist || m.album || 'Unknown artist'}</p>
            </motion.div>
          </AnimatePresence>
          <p className="mt-0.5 flex items-center gap-2 truncate text-[11.5px] text-(--os-text-dim) opacity-80">
            <Bars playing={m.playing} />
            {sourceName(m.source)}
          </p>
        </div>
      </div>

      {hasTimeline && (
        <div className="flex items-center gap-2.5">
          <span className="w-9 text-right text-[11.5px] tabular-nums text-(--os-text-dim)">{formatClock(positionMs!)}</span>
          <Slider
            className="flex-1"
            min={0}
            max={m.durationMs!}
            step={1000}
            value={positionMs!}
            disabled={!m.canSeek}
            aria-label="Seek"
            onChange={(v) => pin(v)}
            onCommit={(v) => void seekMedia(v)}
          />
          <span className="w-9 text-[11.5px] tabular-nums text-(--os-text-dim)">{formatClock(m.durationMs!)}</span>
        </div>
      )}

      <div className="flex items-center justify-center gap-4">
        <Control label="Previous" path={PATHS.prev} disabled={!m.canPrevious} onClick={() => void mediaCommand('previous')} />
        <Control label={m.playing ? 'Pause' : 'Play'} big path={m.playing ? PATHS.pause : PATHS.play} onClick={() => void mediaCommand('play-pause')} />
        <Control label="Next" path={PATHS.next} disabled={!m.canNext} onClick={() => void mediaCommand('next')} />
      </div>

      <motion.button
        type="button"
        onClick={openLiveDj}
        whileTap={reduced ? undefined : { scale: 0.98 }}
        className="flex items-center justify-center gap-2 rounded-[10px] bg-(--os-hover) py-2 text-[13px] font-medium transition-colors hover:bg-(--os-active)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="2.2" />
          <path d="M12 3.5v3M20.5 12h-3" />
        </svg>
        Mix this live in the DJ board
      </motion.button>
    </div>
  )
}
