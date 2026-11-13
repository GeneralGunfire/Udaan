import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { openApp } from '@/os/kernel/shell'
import { formatClock, useNowPlaying } from './useNowPlaying'

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
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        big
          ? 'flex h-12 w-12 items-center justify-center rounded-full bg-(--os-text) text-[var(--surface-base)] transition-transform hover:scale-105 active:scale-95'
          : 'flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-(--os-hover) active:scale-95 disabled:opacity-30'
      }
    >
      <svg viewBox="0 0 24 24" width={big ? 22 : 18} height={big ? 22 : 18} fill="currentColor">
        <path d={path} />
      </svg>
    </button>
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

/** Now Playing for whatever app is playing media, anywhere on the system. */
export function MediaPanel() {
  const { media: m, loaded, positionMs, pin } = useNowPlaying(1000)

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
  const pct = hasTimeline ? (positionMs! / m.durationMs!) * 100 : 0

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex w-full items-center gap-3.5">
        <Artwork m={m} size={72} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold" title={m.title}>
            {m.title}
          </p>
          <p className="truncate text-[13px] text-(--os-text-dim)">{m.artist || m.album || 'Unknown artist'}</p>
          <p className="truncate text-[11.5px] text-(--os-text-dim) opacity-75">{sourceName(m.source)}</p>
        </div>
      </div>

      {hasTimeline && (
        <div className="flex items-center gap-2.5">
          <span className="w-9 text-right text-[11.5px] tabular-nums text-(--os-text-dim)">{formatClock(positionMs!)}</span>
          <input
            type="range"
            min={0}
            max={m.durationMs!}
            step={1000}
            value={positionMs!}
            disabled={!m.canSeek}
            aria-label="Seek"
            onChange={(e) => pin(Number(e.target.value))}
            onPointerUp={(e) => void seekMedia(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => void seekMedia(Number((e.target as HTMLInputElement).value))}
            className="os-slider flex-1"
            style={{ ['--fill' as string]: `${pct}%` }}
          />
          <span className="w-9 text-[11.5px] tabular-nums text-(--os-text-dim)">{formatClock(m.durationMs!)}</span>
        </div>
      )}

      <div className="flex items-center justify-center gap-4">
        <Control label="Previous" path={PATHS.prev} disabled={!m.canPrevious} onClick={() => void mediaCommand('previous')} />
        <Control label={m.playing ? 'Pause' : 'Play'} big path={m.playing ? PATHS.pause : PATHS.play} onClick={() => void mediaCommand('play-pause')} />
        <Control label="Next" path={PATHS.next} disabled={!m.canNext} onClick={() => void mediaCommand('next')} />
      </div>

      <button
        type="button"
        onClick={openLiveDj}
        className="flex items-center justify-center gap-2 rounded-[10px] bg-(--os-hover) py-2 text-[13px] font-medium transition-colors hover:bg-[var(--surface-hover)]"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="2.2" />
          <path d="M12 3.5v3M20.5 12h-3" />
        </svg>
        Mix this live in the DJ board
      </button>
    </div>
  )
}
