import { useEffect } from 'react'
import { Deck } from './components/Deck'
import { Mixer } from './components/Mixer'
import { EffectsRack } from './components/EffectsRack'
import { TrackLibrary } from './components/TrackLibrary'
import { useDjBoard } from './hooks/useDjBoard'
import { useTrackLibrary } from './hooks/useTrackLibrary'
import { DiscIcon } from '@/shared/icons'
import type { AudioTrack } from '@/integrations/audio-library'

/**
 * DJ Board — dual-deck mixer over a real Web Audio graph (playback, gain,
 * crossfader, 3-band EQ, dedicated bass all genuine DSP). Effects rack is a
 * control-state mock (see components/EffectsRack.tsx). Track source is a
 * local folder only — no network/download logic anywhere in this feature.
 */
export function DjBoardView() {
  const board = useDjBoard()
  const library = useTrackLibrary()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.code === 'KeyQ') {
        e.preventDefault()
        board.togglePlay('A')
      } else if (e.code === 'KeyP') {
        e.preventDefault()
        board.togglePlay('B')
      } else if (e.code === 'KeyW') {
        e.preventDefault()
        board.addCuePoint('A')
      } else if (e.code === 'KeyO') {
        e.preventDefault()
        board.addCuePoint('B')
      } else if (e.code === 'ArrowLeft') {
        board.setCrossfade(Math.max(-1, board.crossfade - 0.1))
      } else if (e.code === 'ArrowRight') {
        board.setCrossfade(Math.min(1, board.crossfade + 0.1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [board])

  function handleLoadToDeck(deck: 'A' | 'B', track: AudioTrack) {
    board.loadTrack(deck, track)
  }

  return (
    <div className="flex h-full w-full max-w-[1400px] flex-col gap-3 overflow-y-auto py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DiscIcon width={16} height={16} className="text-accent-creativity" />
          <h1 className="font-display text-text-primary text-[16px] font-semibold">DJ Board</h1>
        </div>
        <p className="text-text-tertiary text-[10.5px]">
          Shortcuts: Q/P play deck A/B · W/O cue A/B · ←/→ crossfader
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr_200px_1fr] gap-3">
        <TrackLibrary
          folderPath={library.folderPath}
          tracks={library.tracks}
          loading={library.loading}
          onPickFolder={library.pickFolder}
          onDragTrackStart={() => {}}
          onLoadToDeck={handleLoadToDeck}
        />

        <Deck
          id="A"
          state={board.deckA}
          onDropTrack={(track) => handleLoadToDeck('A', track)}
          onTogglePlay={() => board.togglePlay('A')}
          onSeek={(s) => board.seek('A', s)}
          onVolume={(v) => board.setVolume('A', v)}
          onEqBand={(band, v) => board.setEqBand('A', band, v)}
          onBass={(v) => board.setBass('A', v)}
          onTempoPercent={(v) => board.setTempoPercent('A', v)}
          onTapBpm={(bpm) => board.tapBpm('A', bpm)}
          onAddCue={() => board.addCuePoint('A')}
          onJumpCue={(cue) => board.jumpToCue('A', cue)}
          onRemoveCue={(id) => board.removeCuePoint('A', id)}
        />

        <div className="flex flex-col gap-3">
          <Mixer
            crossfade={board.crossfade}
            onCrossfade={board.setCrossfade}
            masterVolume={board.masterVolume}
            onMasterVolume={board.setMasterVolume}
          />
        </div>

        <Deck
          id="B"
          state={board.deckB}
          onDropTrack={(track) => handleLoadToDeck('B', track)}
          onTogglePlay={() => board.togglePlay('B')}
          onSeek={(s) => board.seek('B', s)}
          onVolume={(v) => board.setVolume('B', v)}
          onEqBand={(band, v) => board.setEqBand('B', band, v)}
          onBass={(v) => board.setBass('B', v)}
          onTempoPercent={(v) => board.setTempoPercent('B', v)}
          onTapBpm={(bpm) => board.tapBpm('B', bpm)}
          onAddCue={() => board.addCuePoint('B')}
          onJumpCue={(cue) => board.jumpToCue('B', cue)}
          onRemoveCue={(id) => board.removeCuePoint('B', id)}
        />
      </div>

      <EffectsRack
        effects={board.effects}
        onToggle={board.toggleEffect}
        onAmount={board.setEffectAmount}
      />
    </div>
  )
}
