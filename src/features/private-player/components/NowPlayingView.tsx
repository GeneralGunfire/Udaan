import { useState } from 'react'
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  ShuffleIcon,
  RepeatIcon,
  ChevronDownIcon,
  HeartIcon,
  HeartFilledIcon,
  FilterSweepIcon,
} from '@/shared/icons'
import { Scrubber } from './Scrubber'
import { VolumeControl } from './VolumeControl'
import { SoundBars } from './SoundBars'
import { DjEffectsPanel } from './DjEffectsPanel'
import { usePlayer } from '../lib/PlayerContext'

interface NowPlayingViewProps {
  onCollapse: () => void
}

/**
 * Full-screen now-playing sheet, rebuilt to match the Private Player
 * website's own now-playing view: no cover art (this site's placeholder
 * art was never real album art anyway, so a decorative photo added
 * nothing genuine), the visualizer itself is the hero — a real
 * frequency-bar equalizer with a reflection beneath it, driven by the
 * shared playback analyser — sitting between the title and the transport
 * controls, with a centered scrubber/transport stack below.
 */
export function NowPlayingView({ onCollapse }: NowPlayingViewProps) {
  const player = usePlayer()
  const track = player.current
  const isFavorite = track ? player.favorites.has(track.path) : false
  const [djOpen, setDjOpen] = useState(false)

  return (
    <div className="relative flex h-full w-full flex-col" style={{ backgroundColor: 'var(--surface-base)' }}>
      <div className="relative z-10 flex items-center justify-between px-6 py-4">
        <button
          type="button"
          onClick={onCollapse}
          className="text-text-secondary hover:text-text-primary flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--os-menu-item-hover)]"
        >
          <ChevronDownIcon width={20} height={20} />
        </button>
        <span className="text-text-tertiary text-xs font-medium tracking-wide uppercase">Now Playing</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDjOpen(true)}
            disabled={!track}
            title="DJ effects"
            className="text-text-secondary hover:text-text-primary hover:bg-[var(--os-menu-item-hover)] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-30"
          >
            <FilterSweepIcon width={14} height={14} />
            DJ
          </button>
          <button
            type="button"
            onClick={() => track && player.toggleFavorite(track.path)}
            disabled={!track}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
              isFavorite ? 'text-accent' : 'text-text-tertiary hover:bg-[var(--os-menu-item-hover)] hover:text-text-secondary'
            }`}
          >
            {isFavorite ? <HeartFilledIcon width={18} height={18} /> : <HeartIcon width={18} height={18} />}
          </button>
        </div>
      </div>

      {djOpen && <DjEffectsPanel onClose={() => setDjOpen(false)} />}

      {!djOpen && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-10">
          <SoundBars
            analyser={player.analyser}
            isPlaying={player.isPlaying}
            barCount={32}
            reflection
            className="h-36 md:h-44 w-full max-w-lg"
          />

          {/* Title carries real weight (the largest text on this screen,
              same rule as every other page) — artist and album drop back
              in size/weight instead of sitting at nearly the same visual
              register, which used to make the whole block read as one
              flat paragraph rather than a title with two lines of
              supporting metadata under it. */}
          <div className="w-full max-w-sm text-center">
            <h2 className="text-text-primary truncate text-[19px] font-semibold tracking-tight" title={track?.title}>
              {track?.title ?? 'Nothing playing'}
            </h2>
            <p className="text-text-secondary mt-1 truncate text-[13px]" title={track?.artist}>
              {track?.artist ?? 'Open the library to pick a track'}
            </p>
            {track?.album && (
              <p className="text-text-tertiary mt-0.5 truncate text-xs" title={track.album}>
                {track.album}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="relative z-10 mx-auto flex w-full max-w-md shrink-0 flex-col gap-7 px-10 pb-12">
        <Scrubber currentTime={player.currentTime} duration={player.duration} onSeek={player.seek} />

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={player.toggleShuffle}
            title="Shuffle"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              player.shuffle ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:bg-[var(--os-menu-item-hover)] hover:text-text-secondary'
            }`}
          >
            <ShuffleIcon width={15} height={15} />
          </button>
          <button
            type="button"
            onClick={player.prev}
            disabled={!track}
            className="text-text-primary flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--os-menu-item-hover)] disabled:opacity-30"
          >
            <SkipBackIcon width={19} height={19} />
          </button>
          <button
            type="button"
            onClick={player.togglePlay}
            disabled={!track}
            className="bg-accent text-accent-contrast mx-2 flex h-13 w-13 items-center justify-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)] transition-transform active:scale-95 disabled:opacity-40"
          >
            {player.isPlaying ? <PauseIcon width={22} height={22} /> : <PlayIcon width={22} height={22} />}
          </button>
          <button
            type="button"
            onClick={player.next}
            disabled={!track}
            className="text-text-primary flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--os-menu-item-hover)] disabled:opacity-30"
          >
            <SkipForwardIcon width={19} height={19} />
          </button>
          <button
            type="button"
            onClick={player.toggleRepeat}
            title="Loop this track"
            className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
              player.repeat ? 'bg-accent/15 text-accent' : 'text-text-tertiary hover:bg-[var(--os-menu-item-hover)] hover:text-text-secondary'
            }`}
          >
            <RepeatIcon width={15} height={15} />
          </button>
        </div>

        <div className="flex justify-center">
          <VolumeControl volume={player.volume} onChange={player.setVolume} />
        </div>
      </div>
    </div>
  )
}
