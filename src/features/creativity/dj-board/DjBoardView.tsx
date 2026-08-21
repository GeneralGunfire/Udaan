import { useEffect, useState } from 'react'
import { Deck } from './components/Deck'
import { Mixer } from './components/Mixer'
import { EffectsRack } from './components/EffectsRack'
import { TrackLibrary } from './components/TrackLibrary'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { PresetsPanel } from './components/PresetsPanel'
import { useDjBoard } from './hooks/useDjBoard'
import { useTrackLibrary } from './hooks/useTrackLibrary'
import { KeyboardIcon } from '@/shared/icons'
import type { AudioTrack } from '@/integrations/audio-library'
import type { DeckId } from './lib/types'

/**
 * DJ Board — dual-deck mixer over a real Web Audio graph (playback, gain,
 * crossfader, 3-band EQ, dedicated bass, HP/LP filter sweep, sync, peak
 * metering, and the effects rack — reverb/delay/filter/flanger, all real
 * DSP, hold-to-apply — are genuine audio processing, not mocked; see
 * components/EffectsRack.tsx and lib/audioEngine.ts). Collapsed by
 * default. Track source is local files/folders only — no network/
 * download logic anywhere in this feature. Layout hierarchy: waveform ->
 * transport cluster -> mixer cluster per deck, with shared crossfader/
 * master/sync in the center column — see NOTES.md for the full before/
 * after and component-tree writeup.
 */
export function DjBoardView() {
  const board = useDjBoard()
  const library = useTrackLibrary()
  const [focusedDeck, setFocusedDeck] = useState<DeckId>('A')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen((o) => !o)
      } else if (e.code === 'Escape') {
        setShortcutsOpen(false)
      } else if (e.code === 'KeyQ') {
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
      } else if (e.code === 'KeyA') {
        setFocusedDeck('A')
      } else if (e.code === 'KeyD') {
        setFocusedDeck('B')
      } else if (e.code === 'KeyL') {
        e.preventDefault()
        const state = focusedDeck === 'A' ? board.deckA : board.deckB
        board.toggleLoop(focusedDeck, state)
      } else if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        e.preventDefault()
        const slot = Number(e.code.slice(-1)) - 1
        const state = focusedDeck === 'A' ? board.deckA : board.deckB
        if (e.shiftKey) board.clearHotCue(focusedDeck, slot)
        else if (state.hotCues[slot] !== null) board.triggerHotCue(focusedDeck, slot, state)
        else board.setHotCue(focusedDeck, slot)
      } else if (e.code === 'ArrowLeft') {
        board.setCrossfade(Math.max(-1, board.crossfade - 0.1))
      } else if (e.code === 'ArrowRight') {
        board.setCrossfade(Math.min(1, board.crossfade + 0.1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [board, focusedDeck])

  function handleLoadToDeck(deck: DeckId, track: AudioTrack) {
    board.loadTrack(deck, track)
  }

  return (
    <div className="relative flex h-full w-full max-w-[1500px] flex-col gap-3 overflow-hidden py-2">
      <button
        type="button"
        onClick={() => setShortcutsOpen(true)}
        className="text-text-tertiary hover:text-text-secondary absolute top-0 right-0 z-10 flex shrink-0 items-center gap-1.5 text-[10.5px] transition-colors duration-100"
      >
        <KeyboardIcon width={12} height={12} />
        Shortcuts (?)
      </button>

      <div className="grid h-0 flex-1 grid-cols-[240px_1fr_190px_1fr] gap-3">
        <TrackLibrary
          folderPath={library.folderPath}
          tracks={library.tracks}
          loading={library.loading}
          onPickFolder={library.pickFolder}
          onPickFiles={library.pickFiles}
          onDragTrackStart={() => {}}
          onLoadToDeck={handleLoadToDeck}
        />

        <Deck
          id="A"
          state={board.deckA}
          peakLevel={board.peakA}
          onDropTrack={(track) => handleLoadToDeck('A', track)}
          onTogglePlay={() => board.togglePlay('A')}
          onSeek={(s) => board.seek('A', s)}
          onVolume={(v) => board.setVolume('A', v)}
          onEqBand={(band, v) => board.setEqBand('A', band, v)}
          onBass={(v) => board.setBass('A', v)}
          onFilter={(v) => board.setFilter('A', v)}
          onTempoPercent={(v) => board.setTempoPercent('A', v)}
          onTapBpm={(bpm) => board.tapBpm('A', bpm)}
          onSync={() => board.syncTempo('A')}
          onAddCue={() => board.addCuePoint('A')}
          onJumpCue={(cue) => board.jumpToCue('A', cue)}
          onRemoveCue={(id) => board.removeCuePoint('A', id)}
          onSetHotCue={(slot) => board.setHotCue('A', slot)}
          onTriggerHotCue={(slot) => board.triggerHotCue('A', slot, board.deckA)}
          onClearHotCue={(slot) => board.clearHotCue('A', slot)}
          onSetLoopBeats={(beats) => board.setLoopBeats('A', beats)}
          onToggleLoop={() => board.toggleLoop('A', board.deckA)}
        />

        <div className="flex flex-col gap-3">
          <Mixer
            crossfade={board.crossfade}
            onCrossfade={board.setCrossfade}
            crossfaderCurve={board.crossfaderCurve}
            onCrossfaderCurve={board.setCrossfaderCurve}
            masterVolume={board.masterVolume}
            onMasterVolume={board.setMasterVolume}
            peakMaster={board.peakMaster}
          />
          <PresetsPanel
            presets={board.presets}
            onSave={board.savePreset}
            onLoad={board.loadPreset}
            onDelete={board.deletePreset}
          />
        </div>

        <Deck
          id="B"
          state={board.deckB}
          peakLevel={board.peakB}
          onDropTrack={(track) => handleLoadToDeck('B', track)}
          onTogglePlay={() => board.togglePlay('B')}
          onSeek={(s) => board.seek('B', s)}
          onVolume={(v) => board.setVolume('B', v)}
          onEqBand={(band, v) => board.setEqBand('B', band, v)}
          onBass={(v) => board.setBass('B', v)}
          onFilter={(v) => board.setFilter('B', v)}
          onTempoPercent={(v) => board.setTempoPercent('B', v)}
          onTapBpm={(bpm) => board.tapBpm('B', bpm)}
          onSync={() => board.syncTempo('B')}
          onAddCue={() => board.addCuePoint('B')}
          onJumpCue={(cue) => board.jumpToCue('B', cue)}
          onRemoveCue={(id) => board.removeCuePoint('B', id)}
          onSetHotCue={(slot) => board.setHotCue('B', slot)}
          onTriggerHotCue={(slot) => board.triggerHotCue('B', slot, board.deckB)}
          onClearHotCue={(slot) => board.clearHotCue('B', slot)}
          onSetLoopBeats={(beats) => board.setLoopBeats('B', beats)}
          onToggleLoop={() => board.toggleLoop('B', board.deckB)}
        />
      </div>

      <EffectsRack
        effects={board.effects}
        onEngage={board.engageEffect}
        onRelease={board.releaseEffect}
        onAmount={board.setEffectAmount}
      />

      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
