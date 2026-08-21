import { usePlaylistLibrary } from './hooks/usePlaylist'
import { useAudioPlayer, type RepeatMode } from './hooks/useAudioPlayer'
import { PlaylistPanel } from './components/PlaylistPanel'
import { PlayerControls } from './components/PlayerControls'
import { DiscIcon } from '@/shared/icons'

const REPEAT_CYCLE: RepeatMode[] = ['off', 'all', 'one']

/**
 * Music Player — sequential local playlist playback, distinct from the DJ
 * Board's dual-deck mixer. Real local-folder scan (reuses the same
 * integrations/audio-library as the DJ Board); no hardcoded track list,
 * no catalog imported from any external source. Plays whatever audio
 * files are actually present in the folder the user picks.
 */
export function MusicPlayerView() {
  const library = usePlaylistLibrary()
  const player = useAudioPlayer(library.tracks)

  function cycleRepeat() {
    const idx = REPEAT_CYCLE.indexOf(player.repeat)
    player.setRepeat(REPEAT_CYCLE[(idx + 1) % REPEAT_CYCLE.length])
  }

  return (
    <div className="flex h-full w-full max-w-4xl flex-col gap-3 overflow-y-auto py-2">
      <div className="flex items-center gap-2">
        <DiscIcon width={16} height={16} className="text-accent-creativity" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">Music Player</h1>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-3">
        <PlaylistPanel
          folderPath={library.folderPath}
          tracks={library.tracks}
          loading={library.loading}
          currentIndex={player.currentIndex}
          isPlaying={player.isPlaying}
          onPickFolder={library.pickFolder}
          onPickFiles={library.pickFiles}
          onSelectTrack={player.selectTrack}
        />

        <PlayerControls
          track={player.currentTrack}
          isPlaying={player.isPlaying}
          isLoading={player.isLoading}
          currentTime={player.currentTime}
          duration={player.duration}
          volume={player.volume}
          shuffle={player.shuffle}
          repeat={player.repeat}
          onTogglePlay={player.togglePlay}
          onNext={player.next}
          onPrev={player.prev}
          onSeek={player.seek}
          onVolume={player.setVolume}
          onToggleShuffle={() => player.setShuffle((s) => !s)}
          onCycleRepeat={cycleRepeat}
        />
      </div>

      {player.error && <p className="text-danger text-[11px]">{player.error}</p>}
    </div>
  )
}
