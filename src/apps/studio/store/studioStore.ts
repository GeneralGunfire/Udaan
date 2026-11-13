import { create } from 'zustand'
import * as engine from '@/integrations/studio/client'
import { ensureInstrument, slotForPitch } from '../instruments/instrumentLoader'
import type {
  AudioConfig,
  EngineStatus,
  LatencyEstimate,
} from '@/integrations/studio/types'
import {
  createMidiClip,
  createProject,
  createTrack,
  newId,
  nextSlot,
  projectLength,
  type Beats,
  type Clip,
  type KeySignature,
  type MidiClip,
  type Note,
  type Project,
  type Track,
  type TrackKind,
} from '../model/project'

/**
 * Studio's application state.
 *
 * ## What lives here versus in the engine
 * This store owns the *document* (the project: tracks, clips, notes, in
 * musical time) and the *view* (which panel is open, what is selected).
 * The engine owns *sound*. They are kept in sync one way: every edit that
 * changes what should be heard calls into the engine client afterwards.
 * The engine never writes back into the document — it only reports
 * position and levels, which are transient and live in `runtime` rather
 * than in the project.
 *
 * ## Why undo snapshots whole projects
 * A DAW edit can touch many places at once (a comp edit rewrites
 * segments and clips; "arrange into song" duplicates across every track).
 * Tracking per-field deltas for those would be a large amount of
 * bookkeeping for something users invoke a few times a minute. Snapshots
 * are simple and correct; they are capped so memory cannot grow without
 * bound.
 */

const UNDO_LIMIT = 60

/** Autosave delay. Long enough to coalesce a drag, short enough that a
 *  crash costs seconds of work rather than minutes. */
const AUTOSAVE_DEBOUNCE_MS = 1200

const STORAGE_KEY = 'udaan.studio.project'

export type PanelId = 'browser' | 'inspector' | 'mixer' | 'editor'
export type WorkspaceView = 'arrangement' | 'session'
export type EditorTab = 'pianoRoll' | 'stepSequencer' | 'automation'
export type ToolId = 'pointer' | 'draw' | 'erase' | 'split' | 'fade' | 'comp'

/** Transient values reported by the audio thread. Never persisted. */
interface RuntimeState {
  playing: boolean
  recording: boolean
  /** Playhead in frames, straight from the engine. */
  positionFrames: number
  masterLevel: { left: number; right: number }
  cpuLoad: number
  xruns: number
}

interface StudioState {
  project: Project
  runtime: RuntimeState

  // --- Engine ---
  engineStatus: EngineStatus | null
  latency: LatencyEstimate | null
  /** Sample rate the engine is actually running at; drives beat<->frame math. */
  sampleRate: number
  /** User-facing problem to surface as a toast, or null. */
  error: string | null

  // --- View ---
  view: WorkspaceView
  editorTab: EditorTab
  tool: ToolId
  panels: Record<PanelId, boolean>
  selectedTrackId: string | null
  selectedClipId: string | null
  /** Beats per grid line; 0.25 = sixteenth notes. */
  snap: number
  /** Horizontal zoom, in pixels per beat. */
  pixelsPerBeat: number

  // --- History ---
  past: Project[]
  future: Project[]

  // --- Onboarding ---
  hasCompletedSetup: boolean

  // Actions are documented at their implementations below.
  initialize: () => Promise<void>
  shutdown: () => Promise<void>
  setError: (message: string | null) => void

  setProject: (project: Project) => void
  renameProject: (name: string) => void
  setBpm: (bpm: number) => void
  setKey: (key: KeySignature) => void
  setTimeSignature: (numerator: number, denominator: number) => void
  setLoop: (region: { start: Beats; end: Beats } | null) => void
  setMasterGain: (gain: number) => void

  addTrack: (kind: TrackKind, name: string, instrumentId?: string) => string
  removeTrack: (trackId: string) => void
  updateTrack: (trackId: string, patch: Partial<Track>) => void
  reorderTrack: (trackId: string, toIndex: number) => void
  selectTrack: (trackId: string | null) => void

  addClip: (trackId: string, clip: Clip) => void
  updateClip: (trackId: string, clipId: string, patch: Partial<Clip>) => void
  removeClip: (trackId: string, clipId: string) => void
  selectClip: (clipId: string | null) => void

  addNote: (trackId: string, clipId: string, note: Omit<Note, 'id'>) => void
  updateNote: (trackId: string, clipId: string, noteId: string, patch: Partial<Note>) => void
  removeNote: (trackId: string, clipId: string, noteId: string) => void
  setNotes: (trackId: string, clipId: string, notes: Note[]) => void

  play: () => Promise<void>
  stop: () => Promise<void>
  stopAndRewind: () => Promise<void>
  togglePlay: () => Promise<void>
  seekBeats: (beats: Beats) => Promise<void>
  toggleMetronome: () => Promise<void>

  setView: (view: WorkspaceView) => void
  setEditorTab: (tab: EditorTab) => void
  setTool: (tool: ToolId) => void
  togglePanel: (panel: PanelId) => void
  setSnap: (snap: number) => void
  setZoom: (pixelsPerBeat: number) => void

  undo: () => void
  redo: () => void

  applyAudioConfig: (config: AudioConfig) => Promise<void>
  markSetupComplete: () => void
}

/** Debounced persistence — coalesces a dragged fader into one write. */
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(project: Project): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ schemaVersion: 1, project }),
      )
    } catch {
      // A full or unavailable localStorage must not break editing; the
      // project stays in memory and the next save may well succeed.
    }
  }, AUTOSAVE_DEBOUNCE_MS)
}

function loadSaved(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { schemaVersion: number; project: Project }
    // A project from a newer build may reference shapes this code cannot
    // render; starting fresh beats crashing partway through a load.
    if (parsed.schemaVersion > 1) return null
    return parsed.project
  } catch {
    return null
  }
}

export const useStudioStore = create<StudioState>((set, get) => {
  /** Records the current project into undo history before mutating it. */
  function pushHistory(): void {
    const { project, past } = get()
    const next = [...past, project]
    set({
      past: next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next,
      future: [],
    })
  }

  /** Applies a project change: stamps updatedAt, saves, syncs the engine. */
  function commit(project: Project, { history = true } = {}): void {
    if (history) pushHistory()
    const updated = { ...project, updatedAt: Date.now() }
    set({ project: updated })
    scheduleSave(updated)
  }

  /** Pushes one track's mixer state to the engine. */
  function syncTrackMixer(track: Track): void {
    void engine.tracks
      .setMixer(track.slot, {
        gain: track.gain,
        pan: track.pan,
        muted: track.muted,
        soloed: track.soloed,
      })
      .catch(() => {
        // The engine may not be running (Studio open, audio device busy).
        // Mixer changes are re-sent on the next engine start, so a failure
        // here is not worth interrupting the user for.
      })
  }

  /**
   * Resolves a track's clips into absolute-frame notes and hands them to
   * the engine. This is the single place beats become frames.
   */
  function syncTrackNotes(track: Track, project: Project, sampleRate: number): void {
    if (track.kind !== 'instrument') return

    const notes: { start: number; end: number; pitch: number; velocity: number; sample: number }[] =
      []

    for (const clip of track.clips) {
      if (clip.kind !== 'midi' || clip.muted) continue

      // A looped clip repeats until its placed length is filled, which is
      // how a one-bar drum pattern fills an eight-bar section.
      const patternLength = clip.notes.reduce(
        (max, n) => Math.max(max, n.start + n.duration),
        0,
      )
      const unit = clip.looped ? Math.max(patternLength, 1) : clip.length
      const repeats = clip.looped ? Math.ceil(clip.length / unit) : 1

      for (let repeat = 0; repeat < repeats; repeat += 1) {
        for (const note of clip.notes) {
          const startBeats = clip.start + repeat * unit + note.start
          // Never sound past the clip's placed end, even mid-repeat.
          if (startBeats >= clip.start + clip.length) continue
          const endBeats = Math.min(startBeats + note.duration, clip.start + clip.length)

          notes.push({
            start: engine.beatsToFrames(startBeats, project.bpm, sampleRate),
            end: engine.beatsToFrames(endBeats, project.bpm, sampleRate),
            pitch: note.pitch,
            velocity: note.velocity,
            // Which recorded sample plays this note. A multisampled
            // instrument has several, and picking the nearest root keeps
            // every note within a few semitones of a real recording
            // rather than stretching one file across the whole range.
            // Falls back to 0 while the instrument is still loading, so
            // a note scheduled mid-load is silent rather than wrong.
            sample: track.instrumentId
              ? (slotForPitch(track.instrumentId, note.pitch) ?? 0)
              : 0,
          })
        }
      }
    }

    void engine.tracks.setNotes(track.slot, notes).catch(() => {})
  }

  /** Re-sends the whole project to the engine, e.g. after a restart. */
  function syncAll(project: Project, sampleRate: number): void {
    for (const track of project.tracks) {
      void engine.tracks
        .upsert(track.slot, track.kind, {
          gain: track.gain,
          pan: track.pan,
          muted: track.muted,
          soloed: track.soloed,
        })
        .then(() => syncTrackNotes(track, project, sampleRate))
        .catch(() => {})
    }
    void engine.tracks.setMasterGain(project.masterGain).catch(() => {})
    void engine.transport
      .setTempo(engine.framesPerBeat(project.bpm, sampleRate))
      .catch(() => {})
  }

  return {
    project: loadSaved() ?? createProject(),
    runtime: {
      playing: false,
      recording: false,
      positionFrames: 0,
      masterLevel: { left: 0, right: 0 },
      cpuLoad: 0,
      xruns: 0,
    },

    engineStatus: null,
    latency: null,
    sampleRate: 48_000,
    error: null,

    view: 'arrangement',
    editorTab: 'pianoRoll',
    tool: 'pointer',
    panels: { browser: true, inspector: true, mixer: true, editor: false },
    selectedTrackId: null,
    selectedClipId: null,
    snap: 0.25,
    pixelsPerBeat: 32,

    past: [],
    future: [],
    hasCompletedSetup: (() => {
      try {
        return localStorage.getItem('udaan.studio.setupDone') === '1'
      } catch {
        return false
      }
    })(),

    /** Starts the engine and begins listening for its events. */
    initialize: async () => {
      try {
        const status = await engine.startEngine()
        const sampleRate = status.config?.sampleRate ?? 48_000
        set({
          engineStatus: status,
          latency: status.latency,
          sampleRate,
          error: null,
        })

        await engine.onEngineEvent((event) => {
          switch (event.type) {
            case 'position':
              set((s) => ({ runtime: { ...s.runtime, positionFrames: event.frames } }))
              break
            case 'levels':
              set((s) => ({
                runtime: {
                  ...s.runtime,
                  masterLevel: { left: event.masterLeft, right: event.masterRight },
                },
              }))
              break
            case 'load':
              set((s) => ({ runtime: { ...s.runtime, cpuLoad: event.value } }))
              break
            case 'xrun':
              set((s) => ({
                runtime: { ...s.runtime, xruns: event.count },
                error:
                  'Audio is struggling to keep up. Try a larger buffer size in Audio Settings.',
              }))
              break
            case 'looped':
              break
          }
        })

        syncAll(get().project, sampleRate)
      } catch (err) {
        set({
          error:
            err instanceof Error
              ? err.message
              : 'Could not start audio. Check your device in Audio Settings.',
        })
      }
    },

    shutdown: async () => {
      try {
        await engine.stopEngine()
      } catch {
        // Closing Studio must never fail on a teardown error.
      }
      set({ engineStatus: null, runtime: { ...get().runtime, playing: false } })
    },

    setError: (message) => set({ error: message }),

    setProject: (project) => commit(project),

    renameProject: (name) => commit({ ...get().project, name }),

    setBpm: (bpm) => {
      const clamped = Math.min(300, Math.max(20, bpm))
      const project = { ...get().project, bpm: clamped }
      commit(project)
      void engine.transport
        .setTempo(engine.framesPerBeat(clamped, get().sampleRate))
        .catch(() => {})
      // Note positions are stored in beats, so a tempo change moves every
      // note in real time — the engine's frame-based schedule must be
      // rebuilt or playback would drift out of time with the new tempo.
      for (const track of project.tracks) {
        syncTrackNotes(track, project, get().sampleRate)
      }
    },

    setKey: (key) => commit({ ...get().project, key }),

    setTimeSignature: (numerator, denominator) =>
      commit({ ...get().project, timeSignature: { numerator, denominator } }),

    setLoop: (region) => {
      commit({ ...get().project, loop: region }, { history: false })
      const { bpm } = get().project
      const rate = get().sampleRate
      void engine.transport
        .setLoop(
          region ? engine.beatsToFrames(region.start, bpm, rate) : null,
          region ? engine.beatsToFrames(region.end, bpm, rate) : null,
        )
        .catch(() => {})
    },

    setMasterGain: (gain) => {
      commit({ ...get().project, masterGain: gain }, { history: false })
      void engine.tracks.setMasterGain(gain).catch(() => {})
    },

    addTrack: (kind, name, instrumentId) => {
      const project = get().project
      const slot = nextSlot(project)
      const track = createTrack({
        slot,
        name,
        kind,
        instrumentId,
        colorIndex: project.tracks.length,
      })
      commit({ ...project, tracks: [...project.tracks, track] })
      set({ selectedTrackId: track.id })

      void engine.tracks
        .upsert(slot, kind, { gain: 1, pan: 0, muted: false, soloed: false })
        .catch(() => {})

      // Samples are fetched and decoded in the background. Notes
      // scheduled before this finishes resolve to slot 0 and are silent,
      // so the track is re-synced once loading completes rather than
      // leaving the first pattern the user draws mute until they happen
      // to edit it again.
      if (instrumentId) {
        void ensureInstrument(instrumentId)
          .then(() => {
            const current = get().project
            const live = current.tracks.find((t) => t.id === track.id)
            if (live) syncTrackNotes(live, current, get().sampleRate)
          })
          .catch((err: unknown) => {
            set({
              error:
                err instanceof Error
                  ? `Could not load ${name}: ${err.message}`
                  : `Could not load ${name}.`,
            })
          })
      }
      return track.id
    },

    removeTrack: (trackId) => {
      const project = get().project
      const track = project.tracks.find((t) => t.id === trackId)
      if (!track) return

      commit({ ...project, tracks: project.tracks.filter((t) => t.id !== trackId) })
      if (get().selectedTrackId === trackId) set({ selectedTrackId: null })
      void engine.tracks.remove(track.slot).catch(() => {})
    },

    updateTrack: (trackId, patch) => {
      const project = get().project
      const tracks = project.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t))
      const next = { ...project, tracks }
      // Mixer moves are continuous (a dragged fader); recording each as
      // an undo step would bury real edits under hundreds of entries.
      const isMixerOnly =
        patch.gain !== undefined ||
        patch.pan !== undefined ||
        patch.muted !== undefined ||
        patch.soloed !== undefined
      commit(next, { history: !isMixerOnly })

      const updated = tracks.find((t) => t.id === trackId)
      if (updated) syncTrackMixer(updated)
    },

    reorderTrack: (trackId, toIndex) => {
      const project = get().project
      const from = project.tracks.findIndex((t) => t.id === trackId)
      if (from < 0) return
      const tracks = [...project.tracks]
      const [moved] = tracks.splice(from, 1)
      tracks.splice(Math.max(0, Math.min(tracks.length, toIndex)), 0, moved)
      commit({ ...project, tracks })
    },

    selectTrack: (trackId) => set({ selectedTrackId: trackId }),

    addClip: (trackId, clip) => {
      const project = get().project
      const tracks = project.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t,
      )
      const next = { ...project, tracks }
      commit(next)
      const track = tracks.find((t) => t.id === trackId)
      if (track) syncTrackNotes(track, next, get().sampleRate)
    },

    updateClip: (trackId, clipId, patch) => {
      const project = get().project
      const tracks = project.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: t.clips.map((c) => (c.id === clipId ? ({ ...c, ...patch } as Clip) : c)),
            }
          : t,
      )
      const next = { ...project, tracks }
      commit(next)
      const track = tracks.find((t) => t.id === trackId)
      if (track) syncTrackNotes(track, next, get().sampleRate)
    },

    removeClip: (trackId, clipId) => {
      const project = get().project
      const tracks = project.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
      )
      const next = { ...project, tracks }
      commit(next)
      if (get().selectedClipId === clipId) set({ selectedClipId: null })
      const track = tracks.find((t) => t.id === trackId)
      if (track) syncTrackNotes(track, next, get().sampleRate)
    },

    selectClip: (clipId) => set({ selectedClipId: clipId }),

    addNote: (trackId, clipId, note) => {
      get().setNotes(trackId, clipId, [
        ...(getClip(get().project, trackId, clipId)?.notes ?? []),
        { ...note, id: newId('note') },
      ])
    },

    updateNote: (trackId, clipId, noteId, patch) => {
      const clip = getClip(get().project, trackId, clipId)
      if (!clip) return
      get().setNotes(
        trackId,
        clipId,
        clip.notes.map((n) => (n.id === noteId ? { ...n, ...patch } : n)),
      )
    },

    removeNote: (trackId, clipId, noteId) => {
      const clip = getClip(get().project, trackId, clipId)
      if (!clip) return
      get().setNotes(
        trackId,
        clipId,
        clip.notes.filter((n) => n.id !== noteId),
      )
    },

    setNotes: (trackId, clipId, notes) => {
      const project = get().project
      const tracks = project.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: t.clips.map((c) =>
                c.id === clipId && c.kind === 'midi' ? { ...c, notes } : c,
              ),
            }
          : t,
      )
      const next = { ...project, tracks }
      commit(next)
      const track = tracks.find((t) => t.id === trackId)
      if (track) syncTrackNotes(track, next, get().sampleRate)
    },

    play: async () => {
      try {
        await engine.transport.play()
        set((s) => ({ runtime: { ...s.runtime, playing: true } }))
      } catch (err) {
        set({ error: err instanceof Error ? err.message : 'Could not start playback.' })
      }
    },

    stop: async () => {
      try {
        await engine.transport.stop()
      } finally {
        set((s) => ({ runtime: { ...s.runtime, playing: false } }))
      }
    },

    stopAndRewind: async () => {
      try {
        await engine.transport.stopAndRewind()
      } finally {
        set((s) => ({ runtime: { ...s.runtime, playing: false, positionFrames: 0 } }))
      }
    },

    togglePlay: async () => {
      if (get().runtime.playing) await get().stop()
      else await get().play()
    },

    seekBeats: async (beats) => {
      const frames = engine.beatsToFrames(
        Math.max(0, beats),
        get().project.bpm,
        get().sampleRate,
      )
      set((s) => ({ runtime: { ...s.runtime, positionFrames: frames } }))
      await engine.transport.seek(frames).catch(() => {})
    },

    toggleMetronome: async () => {
      // Metronome is a transport preference, not part of the document, so
      // it is not persisted with the project.
      const next = !metronomeOn
      metronomeOn = next
      await engine.transport.setMetronome(next).catch(() => {})
    },

    setView: (view) => set({ view }),
    setEditorTab: (editorTab) => set({ editorTab }),
    setTool: (tool) => set({ tool }),
    togglePanel: (panel) =>
      set((s) => ({ panels: { ...s.panels, [panel]: !s.panels[panel] } })),
    setSnap: (snap) => set({ snap }),
    setZoom: (pixelsPerBeat) =>
      set({ pixelsPerBeat: Math.min(200, Math.max(4, pixelsPerBeat)) }),

    undo: () => {
      const { past, project, future } = get()
      if (past.length === 0) return
      const previous = past[past.length - 1]
      set({
        past: past.slice(0, -1),
        project: previous,
        future: [project, ...future].slice(0, UNDO_LIMIT),
      })
      scheduleSave(previous)
      syncAll(previous, get().sampleRate)
    },

    redo: () => {
      const { past, project, future } = get()
      if (future.length === 0) return
      const next = future[0]
      set({
        past: [...past, project].slice(-UNDO_LIMIT),
        project: next,
        future: future.slice(1),
      })
      scheduleSave(next)
      syncAll(next, get().sampleRate)
    },

    applyAudioConfig: async (config) => {
      try {
        const status = await engine.applyAudioConfig(config)
        const sampleRate = status.config?.sampleRate ?? 48_000
        set({ engineStatus: status, latency: status.latency, sampleRate, error: null })
        // The stream was rebuilt, so the engine's copy of the project is
        // gone; without this the session would be silent until reload.
        syncAll(get().project, sampleRate)
      } catch (err) {
        set({
          error:
            err instanceof Error ? err.message : 'Could not apply those audio settings.',
        })
      }
    },

    markSetupComplete: () => {
      try {
        localStorage.setItem('udaan.studio.setupDone', '1')
      } catch {
        // Setup still completes for this session if storage is unavailable.
      }
      set({ hasCompletedSetup: true })
    },
  }
})

/** Metronome state, deliberately outside the persisted project. */
let metronomeOn = false

export function isMetronomeOn(): boolean {
  return metronomeOn
}

/** Finds a MIDI clip, or undefined. */
function getClip(project: Project, trackId: string, clipId: string): MidiClip | undefined {
  const track = project.tracks.find((t) => t.id === trackId)
  const clip = track?.clips.find((c) => c.id === clipId)
  return clip?.kind === 'midi' ? clip : undefined
}

// Selectors kept here so components subscribe to the narrowest slice
// possible — a component watching `project` alone re-renders on every
// fader move, which is exactly what a DAW cannot afford.
export const selectSelectedTrack = (s: StudioState): Track | undefined =>
  s.project.tracks.find((t) => t.id === s.selectedTrackId)

export const selectSelectedClip = (s: StudioState): Clip | undefined => {
  for (const track of s.project.tracks) {
    const clip = track.clips.find((c) => c.id === s.selectedClipId)
    if (clip) return clip
  }
  return undefined
}

export const selectPositionBeats = (s: StudioState): number =>
  engine.framesToBeats(s.runtime.positionFrames, s.project.bpm, s.sampleRate)

export const selectProjectLength = (s: StudioState): number => projectLength(s.project)

export { createMidiClip, createProject }
