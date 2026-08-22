import { useEffect, useState } from 'react'
import * as boardEngine from '../lib/boardEngineStore'

/**
 * Thin React binding over the module-level board engine singleton
 * (lib/boardEngineStore.ts). Playback lives in that singleton, not in
 * this hook's own state, so it survives unmounting DjBoardView —
 * navigating to a different feature no longer stops the music. Every
 * DjBoardView (and the app-shell MiniPlayer) mounted at once shares the
 * exact same live engines via subscribeBoardEngine.
 */
export function useDjBoard() {
  const [snapshot, setSnapshot] = useState(() => boardEngine.getBoardSnapshot())

  useEffect(() => {
    return boardEngine.subscribeBoardEngine(() => setSnapshot(boardEngine.getBoardSnapshot()))
  }, [])

  return {
    ...snapshot,
    loadTrack: boardEngine.loadTrack,
    togglePlay: boardEngine.togglePlay,
    seek: boardEngine.seek,
    setVolume: boardEngine.setVolume,
    setEqBand: boardEngine.setEqBand,
    setBass: boardEngine.setBass,
    setFilter: boardEngine.setFilter,
    toggleMuffle: boardEngine.toggleMuffle,
    toggleBassKill: boardEngine.toggleBassKill,
    triggerEchoOut: boardEngine.triggerEchoOut,
    setTempoPercent: boardEngine.setTempoPercent,
    tapBpm: boardEngine.tapBpm,
    syncTempo: boardEngine.syncTempo,
    addCuePoint: boardEngine.addCuePoint,
    jumpToCue: boardEngine.jumpToCue,
    removeCuePoint: boardEngine.removeCuePoint,
    setHotCue: boardEngine.setHotCue,
    triggerHotCue: boardEngine.triggerHotCue,
    clearHotCue: boardEngine.clearHotCue,
    setLoopBeats: boardEngine.setLoopBeats,
    toggleLoop: boardEngine.toggleLoop,
    setCrossfade: boardEngine.setCrossfade,
    setCrossfaderCurve: boardEngine.setCrossfaderCurve,
    setMasterVolume: boardEngine.setMasterVolume,
    savePreset: boardEngine.savePreset,
    loadPreset: boardEngine.loadPreset,
    deletePreset: boardEngine.deletePreset,
    engageEffect: boardEngine.engageEffect,
    releaseEffect: boardEngine.releaseEffect,
    setEffectAmount: boardEngine.setEffectAmount,
  }
}

export const formatTime = boardEngine.formatTime
