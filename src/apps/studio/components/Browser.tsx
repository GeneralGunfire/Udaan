import { useMemo, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Input } from '@/shared/components/ui/input'
import { useStudioStore } from '../store/studioStore'
import { INSTRUMENTS, FAMILY_LABELS, type InstrumentFamily } from '../instruments/definitions'
import { isInstrumentLoaded } from '../instruments/instrumentLoader'
import { PROGRESSIONS, chordsForProgression, GENRE_TEMPOS } from '../model/theory'

/**
 * The left panel: what you can add to a project.
 *
 * Three tabs rather than the six a full DAW browser carries. Loops and
 * samples do not exist yet as content, and a tab that opens onto an empty
 * list teaches users that the panel is not worth opening. Tabs appear as
 * their content becomes real.
 */
type BrowserTab = 'instruments' | 'chords' | 'tempo'

export function Browser() {
  const [tab, setTab] = useState<BrowserTab>('instruments')

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 gap-0.5 px-2 pt-2">
        {(
          [
            ['instruments', 'Instruments'],
            ['chords', 'Chords'],
            ['tempo', 'Tempo'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150',
              tab === id
                ? 'bg-accent text-accent-contrast shadow-[inset_0_1px_0_rgb(255_255_255/22%),var(--shadow-raised)]'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-white/[0.05]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'instruments' && <InstrumentList />}
      {tab === 'chords' && <ChordHelper />}
      {tab === 'tempo' && <TempoHelper />}
    </div>
  )
}

function InstrumentList() {
  const [query, setQuery] = useState('')
  const addTrack = useStudioStore((s) => s.addTrack)
  const tracks = useStudioStore((s) => s.project.tracks)

  const grouped = useMemo(() => {
    const term = query.trim().toLowerCase()
    const matches = INSTRUMENTS.filter(
      (i) => !term || i.name.toLowerCase().includes(term) || i.description.toLowerCase().includes(term),
    )
    const byFamily = new Map<InstrumentFamily, typeof INSTRUMENTS>()
    for (const inst of matches) {
      const list = byFamily.get(inst.family) ?? []
      list.push(inst)
      byFamily.set(inst.family, list)
    }
    return byFamily
  }, [query])

  return (
    <>
      <div className="shrink-0 px-2 py-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search instruments"
          inputSize="sm"
          aria-label="Search instruments"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {[...grouped.entries()].map(([family, list]) => (
          <div key={family} className="mb-3">
            <p className="text-text-tertiary mb-1 px-1 text-2xs font-semibold tracking-wider uppercase">
              {FAMILY_LABELS[family]}
            </p>
            {list.map((inst) => {
              const inUse = tracks.some((t) => t.instrumentId === inst.id)
              return (
                <button
                  key={inst.id}
                  type="button"
                  onDoubleClick={() => addTrack('instrument', inst.name, inst.id)}
                  onClick={() => addTrack('instrument', inst.name, inst.id)}
                  className="group flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-white/[0.06]"
                >
                  <span className="text-text-primary flex w-full items-center gap-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{inst.name}</span>
                    {/* Loaded state is worth showing: the first use of an
                        instrument downloads samples, and knowing which are
                        already local explains why one loads instantly and
                        another takes a moment. */}
                    {isInstrumentLoaded(inst.id) && (
                      <span
                        aria-label="Samples loaded"
                        className="bg-accent/70 h-1.5 w-1.5 shrink-0 rounded-full"
                      />
                    )}
                    {inUse && <span className="text-text-tertiary text-2xs">in use</span>}
                  </span>
                  <span className="text-text-tertiary text-2xs leading-snug">
                    {inst.description}
                  </span>
                </button>
              )
            })}
          </div>
        ))}

        {grouped.size === 0 && (
          <p className="text-text-tertiary px-1 py-4 text-xs">No instruments match "{query}".</p>
        )}
      </div>
    </>
  )
}

/**
 * Chord progressions, written into the project as real MIDI.
 *
 * This is the harmony equivalent of the step sequencer: it lets someone
 * with no theory produce a progression that works, then see the notes it
 * produced in the piano roll. That second half matters — a generator that
 * hides its output teaches nothing, whereas one that fills in the notes
 * you can then edit is a starting point.
 */
function ChordHelper() {
  const key = useStudioStore((s) => s.project.key)
  const selectedTrackId = useStudioStore((s) => s.selectedTrackId)
  const tracks = useStudioStore((s) => s.project.tracks)
  const addClip = useStudioStore((s) => s.addClip)
  const beatsPerBar = useStudioStore((s) => s.project.timeSignature.numerator)

  const target = tracks.find((t) => t.id === selectedTrackId && t.kind === 'instrument')

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <p className="text-text-tertiary px-1 py-2 text-2xs leading-relaxed">
        {target
          ? `Writes a four-bar progression to ${target.name}.`
          : 'Select an instrument track to write a progression to it.'}
      </p>

      {PROGRESSIONS.map((progression) => (
        <button
          key={progression.id}
          type="button"
          disabled={!target}
          onClick={() => {
            if (!target) return
            const chords = chordsForProgression(progression, key)
            const notes = chords.flatMap((chord, index) =>
              chord.pitches.map((pitch, voice) => ({
                id: `ch-${index}-${voice}-${Date.now().toString(36)}`,
                pitch,
                start: index * beatsPerBar,
                duration: beatsPerBar,
                velocity: 0.7,
              })),
            )
            addClip(target.id, {
              kind: 'midi',
              id: `c-${Date.now().toString(36)}`,
              name: progression.name,
              start: 0,
              length: chords.length * beatsPerBar,
              color: target.color,
              muted: false,
              looped: false,
              notes,
            })
          }}
          className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-white/[0.06] disabled:opacity-40"
        >
          <span className="text-text-primary text-sm tabular-nums">{progression.name}</span>
          <span className="text-text-tertiary text-2xs">{progression.hint}</span>
        </button>
      ))}
    </div>
  )
}

/** Genre tempo suggestions. Beginners routinely write hip-hop at 140 BPM
 * because the default was 120 and nothing told them otherwise. */
function TempoHelper() {
  const bpm = useStudioStore((s) => s.project.bpm)
  const setBpm = useStudioStore((s) => s.setBpm)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <p className="text-text-tertiary px-1 py-2 text-2xs leading-relaxed">
        Typical tempos by genre. These are starting points, not rules.
      </p>
      {GENRE_TEMPOS.map((genre) => {
        const mid = Math.round((genre.min + genre.max) / 2)
        const active = bpm >= genre.min && bpm <= genre.max
        return (
          <button
            key={genre.id}
            type="button"
            onClick={() => setBpm(mid)}
            className={cn(
              'flex w-full items-center justify-between rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-white/[0.06]',
              active && 'bg-white/[0.05]',
            )}
          >
            <span className="text-text-primary text-sm">{genre.name}</span>
            <span className="text-text-tertiary text-2xs tabular-nums">
              {genre.min}–{genre.max}
            </span>
          </button>
        )
      })}
    </div>
  )
}
