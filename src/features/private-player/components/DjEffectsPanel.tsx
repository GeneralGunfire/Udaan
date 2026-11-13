import { useEffect, useMemo, useState } from 'react'
import { WindowCloseIcon, SyncIcon, PlusIcon, TrashIcon, FolderIcon, SkipBackIcon, SkipForwardIcon } from '@/shared/icons'
import { usePlayer } from '../lib/PlayerContext'
import { useDjPresets } from '../hooks/useDjPresets'
import { useDeckB } from '../hooks/useDeckB'
import { DeckChannelStrip } from './DeckChannelStrip'
import { Crossfader } from './Crossfader'
import { DeckBTrackPicker } from './DeckBTrackPicker'
import { MasterSection } from './MasterSection'
import { useMasterBus } from '../hooks/useMasterBus'
import { useTrackAnalysis, keysAreCompatible, tempoMatchPercent } from '../hooks/useTrackAnalysis'
import { matchLoudness } from '../lib/gainStaging'
import { StemPanel } from './StemPanel'
import { createDeckChain, type ParamSpec, type ParamValues } from '../lib/dsp'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/shared/components/ui/dropdown-menu'

interface DjEffectsPanelProps {
  onClose: () => void
}

/**
 * Two-deck DJ mixer — Deck A is the app-wide shared player (the same
 * "now playing" every other Udaan surface reflects), Deck B is a fully
 * independent second engine (see useDeckB.ts) with its own audio element
 * and effects chain, so mixing two tracks here never disturbs what Deck
 * A's track means to the rest of the app. A crossfader blends their real
 * output levels; each deck keeps its own full channel strip (EQ, filter
 * sweep, color/time effects) side by side rather than one shared rack,
 * since a real two-deck mixer never shares effects between decks.
 *
 * Both decks sum into a shared master bus (lib/audioGraph.ts), whose EQ /
 * limiter / output trim sit next to the crossfader as MasterSection — the
 * post-sum stage, exactly where a real mixer puts it.
 *
 * Deck A retains the extras unique to being the "main" deck — hot cues,
 * transport (prev/next/brake/pitch), and preset save/load, none of which
 * make sense for Deck B's simpler "load one track to mix in" role. Deck B
 * gets its own track picker instead.
 */
export function DjEffectsPanel({ onClose }: DjEffectsPanelProps) {
  const player = usePlayer()
  // DeckChannelStrip is shared between both decks via the DeckLike
  // interface, which names the loaded track `track` — PlayerEngine (Deck
  // A) calls the same concept `current` everywhere else in the app, so
  // this is a thin adapter rather than renaming that field project-wide.
  const deckA = { ...player, track: player.current }
  const deckB = useDeckB()
  const presets = useDjPresets()
  const master = useMasterBus()
  const analysisA = useTrackAnalysis(player.current)
  const analysisB = useTrackAnalysis(deckB.track)
  const [savingName, setSavingName] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [crossfade, setCrossfade] = useState(0) // -1..1, 0 = center (both full)

  // The rack renders itself from the chain's parameter schema, so the
  // panel needs that schema but not an audio graph. Building one throwaway
  // chain on an OfflineAudioContext reads the schema without allocating
  // anything on the live context — and memoised so it happens once, not
  // on every crossfader move.
  const specs: ParamSpec[] = useMemo(() => {
    const probe = new OfflineAudioContext(2, 1, 44100) as unknown as AudioContext
    const chain = createDeckChain(probe)
    const params = chain.params
    chain.dispose()
    return params
  }, [])

  // Crossfader math: center plays both decks at their own full volume —
  // sliding toward one side pulls the OTHER deck down to silence at the
  // extreme, matching a physical mixer crossfader. Restored automatically
  // whenever the panel closes so Deck A's real volume is never left
  // altered by having opened the DJ board.
  useEffect(() => {
    const aMultiplier = Math.min(1, 1 - Math.max(0, crossfade))
    const bMultiplier = Math.min(1, 1 + Math.min(0, crossfade))
    player.setOutputMultiplier(aMultiplier)
    deckB.setGain(bMultiplier)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossfade])

  useEffect(() => {
    return () => {
      player.setOutputMultiplier(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSavePreset() {
    const name = savingName?.trim()
    if (!name) return
    await presets.savePreset(name, player.djEffects)
    setSavingName(null)
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col" style={{ backgroundColor: 'var(--surface-base)' }}>
      <div className="border-hairline flex items-center justify-between border-b px-6 py-3.5">
        <div>
          <h2 className="text-text-primary text-sm font-semibold">DJ Board</h2>
          <p className="text-text-tertiary text-xs">Two-deck mixer</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Preset save/load, grouped into one bordered pill so it reads
              as a single system rather than two loose buttons floating in
              the header — same "shared ring" idiom TopBar's Zone 3 uses. A
              menu of actions, not a value picker — loading a preset does
              something and the control then returns to its resting label,
              which a <select> cannot express (it would sit showing the
              last-loaded preset as if it were current state). */}
          <div className="border-hairline bg-surface-raised flex h-8 items-center rounded-full border">
            {savingName === null ? (
              <button
                type="button"
                onClick={() => setSavingName('')}
                title="Save Deck A's current settings as a preset"
                className="text-text-secondary hover:text-text-primary flex h-full items-center gap-1.5 rounded-l-full px-3 text-xs font-medium transition-colors hover:bg-white/6"
              >
                <PlusIcon width={12} height={12} />
                Save preset
              </button>
            ) : (
              <div className="flex items-center gap-1 pr-1 pl-2.5">
                <input
                  autoFocus
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSavePreset()
                    if (e.key === 'Escape') setSavingName(null)
                  }}
                  placeholder="Preset name…"
                  className="text-text-primary placeholder:text-text-tertiary w-28 bg-transparent text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={!savingName.trim()}
                  className="bg-accent text-accent-contrast hover:brightness-110 rounded-full px-2.5 py-1 text-2xs font-semibold transition-[filter] disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            )}

            {!presets.loading && presets.presets.length > 0 && (
              <>
                <span aria-hidden className="bg-border-hairline h-4 w-px" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="text-text-secondary hover:text-text-primary flex h-full items-center gap-1.5 rounded-r-full px-3 text-xs font-medium transition-colors hover:bg-white/6"
                    >
                      Load preset
                      <span className="text-text-tertiary tabular-nums">({presets.presets.length})</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {presets.presets.map((p) => (
                      <div key={p.id} className="group flex items-center">
                        <DropdownMenuItem
                          className="min-w-0 flex-1"
                          onSelect={() => player.loadDjEffects(p.settings as ParamValues)}
                        >
                          <span className="truncate">{p.name}</span>
                        </DropdownMenuItem>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void presets.removePreset(p.id)
                          }}
                          title={`Delete "${p.name}"`}
                          className="text-text-tertiary hover:text-danger mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <TrashIcon width={11} height={11} />
                        </button>
                      </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              player.resetDjEffects()
              deckB.resetDjEffects()
              master.reset()
            }}
            title="Reset all effects on both decks"
            className="text-text-secondary hover:text-text-primary rounded-full p-1.5 transition-colors"
          >
            <SyncIcon width={14} height={14} />
          </button>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary rounded-md p-1.5 transition-colors">
            <WindowCloseIcon width={16} height={16} />
          </button>
        </div>
      </div>

      {/* Three columns: Deck A | mixer | Deck B. The mixer sits BETWEEN
          the decks rather than in a strip along the bottom, because that
          is where its controls actually belong — the crossfader blends
          left into right, so putting it anywhere but between them makes
          the reader map the control onto the layout twice. */}
      <div className="no-scrollbar flex min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4">
        <DeckChannelStrip
          deck={deckA}
          specs={specs}
          side="A"
          bpm={analysisA.analysis?.bpm ?? null}
          musicalKey={analysisA.analysis?.camelotKey ?? null}
          spinning={player.isPlaying && !player.brakeActive}
          extra={
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-center gap-2">
                <TransportButton onClick={player.prev} disabled={!player.current} label="Previous track">
                  <SkipBackIcon width={14} height={14} />
                </TransportButton>
                <button
                  type="button"
                  onMouseDown={player.triggerBrake}
                  onMouseUp={player.releaseBrake}
                  onMouseLeave={() => player.brakeActive && player.releaseBrake()}
                  disabled={!player.current}
                  title="Hold to brake, release to spin back up"
                  className={`rounded-md px-2.5 py-1.5 text-3xs font-bold tracking-wide transition-colors disabled:opacity-30 ${
                    player.brakeActive ? 'bg-danger text-white' : 'bg-white/8 text-text-tertiary hover:bg-white/12'
                  }`}
                >
                  BRAKE
                </button>
                <TransportButton onClick={player.next} disabled={!player.current} label="Next track">
                  <SkipForwardIcon width={14} height={14} />
                </TransportButton>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-text-tertiary shrink-0 text-3xs tracking-wide uppercase">Pitch</span>
                <input
                  type="range"
                  min={-15}
                  max={15}
                  step={1}
                  value={Math.round((player.playbackRate - 1) * 100)}
                  onChange={(e) => player.setPlaybackRate(1 + Number(e.target.value) / 100)}
                  className="accent-(--color-accent) h-1 flex-1"
                  aria-label="Pitch adjustment"
                />
                <span className="text-text-tertiary w-8 shrink-0 text-right text-2xs-alt tabular-nums">
                  {player.playbackRate === 1
                    ? '0%'
                    : `${player.playbackRate > 1 ? '+' : ''}${Math.round((player.playbackRate - 1) * 100)}%`}
                </span>
              </div>

              <HotCueRow />
              <StemPanel track={player.current} side="A" />
            </div>
          }
        />

        {/* Centre mixer column. */}
        <div className="flex w-44 shrink-0 flex-col items-center gap-4 pt-2">
          <Crossfader value={crossfade} onChange={setCrossfade} />
          <div className="bg-border-hairline h-px w-full" />
          <MixAssist
            bpmA={analysisA.analysis?.bpm ?? null}
            bpmB={analysisB.analysis?.bpm ?? null}
            keyA={analysisA.analysis?.camelotKey ?? null}
            keyB={analysisB.analysis?.camelotKey ?? null}
            analysing={analysisA.loading || analysisB.loading}
            onSync={(percent) => player.setPlaybackRate(1 + percent / 100)}
            loudnessOffset={matchLoudness(analysisA.analysis, analysisB.analysis)}
            onMatchLoudness={(db) => deckB.setDjEffects({ gain: db })}
          />
          <div className="bg-border-hairline h-px w-full" />
          <MasterSection settings={master.settings} onChange={master.setSettings} />
        </div>

        <div className="relative flex min-w-0 flex-1">
          <DeckChannelStrip
            deck={deckB}
            specs={specs}
            side="B"
            bpm={analysisB.analysis?.bpm ?? null}
            musicalKey={analysisB.analysis?.camelotKey ?? null}
            spinning={deckB.isPlaying}
            extra={
              <div className="flex flex-col gap-2">
              <div className="relative flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className="border-hairline text-text-secondary hover:text-text-primary flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-2xs font-medium transition-colors"
                >
                  <FolderIcon width={12} height={12} />
                  {deckB.track ? 'Change track' : 'Load track'}
                </button>
                {deckB.track && (
                  <button
                    type="button"
                    onClick={deckB.unload}
                    className="text-text-tertiary hover:text-danger text-2xs-alt transition-colors"
                  >
                    Eject
                  </button>
                )}
                {pickerOpen && (
                  <DeckBTrackPicker
                    onPick={(t) => {
                      deckB.loadTrack(t)
                      setPickerOpen(false)
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>
              <StemPanel track={deckB.track} side="B" />
              </div>
            }
          />
        </div>
      </div>

      <p className="text-text-tertiary border-hairline border-t px-6 py-2 text-center text-2xs">
        Drag a knob up/down · hold shift for fine control · double-click to reset · arrow keys work when focused.
      </p>
    </div>
  )
}

/** Four hot-cue pads for Deck A only — session-only, cleared automatically
 * on track change. Deck B has no equivalent since it's a single loaded
 * track meant for mixing in, not a full transport with a queue. */
function HotCueRow() {
  const player = usePlayer()

  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2, 3].map((slot) => {
        const isSet = player.hotCues[slot] !== null
        return (
          <div key={slot} className="group relative">
            <button
              type="button"
              onClick={() => (isSet ? player.jumpToHotCue(slot) : player.setHotCue(slot))}
              disabled={!player.current}
              title={isSet ? `Jump to cue ${slot + 1}` : `Set cue ${slot + 1} at current position`}
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-2xs font-semibold transition-colors disabled:opacity-30 ${
                isSet ? 'bg-accent text-white' : 'bg-white/8 text-text-tertiary hover:bg-white/12'
              }`}
            >
              {slot + 1}
            </button>
            {isSet && (
              <button
                type="button"
                onClick={() => player.clearHotCue(slot)}
                title="Clear cue"
                className="bg-danger absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <TrashIcon width={8} height={8} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Small icon transport button — extracted because the same shape was
 * repeated for prev/next with only the icon and label differing, and an
 * icon-only control needs an accessible name that inline markup kept
 * omitting. */
function TransportButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="text-text-secondary hover:text-text-primary hover:bg-white/8 rounded-md p-1.5 transition-colors disabled:opacity-30"
    >
      {children}
    </button>
  )
}

/**
 * Mix assist: reads the two decks' analysed tempo and key and says
 * whether they will actually work together.
 *
 * This is the payoff for running analysis at all. A BPM printed next to
 * each deck is trivia; the useful questions are "how far apart are they"
 * and "will these keys clash", and answering those is the difference
 * between analysis being a feature and being a number.
 *
 * Sync adjusts DECK A's pitch to meet Deck B rather than the reverse,
 * because Deck A is the app-wide now-playing deck with a real pitch
 * fader wired to it; Deck B has no pitch control of its own.
 */
function MixAssist({
  bpmA,
  bpmB,
  keyA,
  keyB,
  analysing,
  onSync,
  loudnessOffset,
  onMatchLoudness,
}: {
  bpmA: number | null
  bpmB: number | null
  keyA: string | null
  keyB: string | null
  analysing: boolean
  onSync: (percent: number) => void
  /** dB Deck B needs to sit at Deck A's perceived loudness, or null when
   * either track is unanalysed. */
  loudnessOffset: number | null
  onMatchLoudness: (db: number) => void
}) {
  const syncPercent = tempoMatchPercent(bpmA, bpmB)
  const harmonic = keysAreCompatible(keyA, keyB)
  const bothKeysKnown = Boolean(keyA && keyB)
  const bothBpmKnown = bpmA !== null && bpmB !== null

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <span className="text-text-tertiary text-3xs font-semibold tracking-widest uppercase">Mix</span>

      {analysing ? (
        <span className="text-text-tertiary text-2xs-alt">Analysing…</span>
      ) : (
        <>
          <div className="flex w-full items-center justify-between text-2xs-alt">
            <span className="text-text-tertiary">Tempo</span>
            <span className="text-text-secondary tabular-nums">
              {bothBpmKnown ? `${Math.abs(Math.round(bpmB! - bpmA!))} BPM apart` : '—'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => syncPercent !== null && onSync(syncPercent)}
            disabled={syncPercent === null}
            title={
              syncPercent === null
                ? 'Sync needs both tempos analysed and within the pitch fader’s ±15% range'
                : `Shift Deck A by ${syncPercent > 0 ? '+' : ''}${syncPercent.toFixed(1)}% to match Deck B`
            }
            className="border-hairline text-text-secondary hover:text-text-primary w-full rounded-full border px-3 py-1.5 text-2xs-alt font-semibold tracking-wide uppercase transition-colors disabled:opacity-30"
          >
            Sync A → B
          </button>

          <button
            type="button"
            onClick={() => loudnessOffset !== null && onMatchLoudness(loudnessOffset)}
            disabled={loudnessOffset === null}
            title={
              loudnessOffset === null
                ? 'Loudness matching needs both tracks analysed'
                : `Set Deck B trim to ${loudnessOffset > 0 ? '+' : ''}${loudnessOffset}dB so both decks sound equally loud`
            }
            className="border-hairline text-text-secondary hover:text-text-primary w-full rounded-full border px-3 py-1.5 text-2xs-alt font-semibold tracking-wide uppercase transition-colors disabled:opacity-30"
          >
            Match level
          </button>

          <div className="flex w-full items-center justify-between text-2xs-alt">
            <span className="text-text-tertiary">Key</span>
            {bothKeysKnown ? (
              <span
                className="flex items-center gap-1 tabular-nums"
                style={{ color: harmonic ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: harmonic ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}
                />
                {harmonic ? 'Harmonic' : 'Clashing'}
              </span>
            ) : (
              <span className="text-text-tertiary">—</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
