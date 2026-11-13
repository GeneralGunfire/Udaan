import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ViewBody, ViewHeader, ViewShell } from '@/shared/components/ui/view'
import { cn } from '@/shared/lib/cn'
import { EffectRack } from '@/features/private-player/components/EffectRack'
import { LevelMeter } from '@/features/private-player/components/LevelMeter'
import { MasterSection } from '@/features/private-player/components/MasterSection'
import { useMasterBus } from '@/features/private-player/hooks/useMasterBus'
import { useDjPresets } from '@/features/private-player/hooks/useDjPresets'
import { createDeckChain, DECK_DEFAULTS, type ParamSpec, type ParamValues } from '@/features/private-player/lib/dsp'
import { Artwork, mediaCommand, sourceName } from '@/os/dock/panels/MediaPanel'
import { useNowPlaying } from '@/os/dock/panels/useNowPlaying'
import { LiveInput, type AudioSource, type Latency, type LiveStats, type SourceLevel } from './lib/liveInput'
import { Scope } from './components/Scope'

const LATENCIES: { id: Latency; label: string; hint: string }[] = [
  { id: 'low', label: 'Low', hint: 'Tightest response; may glitch on a busy PC' },
  { id: 'balanced', label: 'Balanced', hint: 'Recommended' },
  { id: 'stable', label: 'Stable', hint: 'Most robust; a little more delay' },
]

const LEVELS: { id: SourceLevel; label: string; hint: string }[] = [
  { id: 'quiet', label: 'Quiet', hint: 'Original about 21 dB down: hides it best, slightly more background noise' },
  { id: 'soft', label: 'Soft', hint: 'Original about 10 dB down: cleanest sound, the original stays faintly audible' },
  { id: 'full', label: 'Full', hint: 'Original untouched and the cleanest signal: you hear it as well as the processed copy (layering/monitoring)' },
]

const LOOPS: { label: string; beats: number }[] = [
  { label: '¼', beats: 0.25 },
  { label: '½', beats: 0.5 },
  { label: '1', beats: 1 },
  { label: '2', beats: 2 },
]

function useSources(live: boolean) {
  const [sources, setSources] = useState<AudioSource[]>([])
  useEffect(() => {
    let stopped = false
    let t: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const s = await invoke<AudioSource[]>('live_audio_sources')
        if (!stopped) setSources(s)
      } catch {
        if (!stopped) setSources([])
      }
      // Polling doubles as the heartbeat that keeps the tap alive in Rust.
      if (!stopped) t = setTimeout(poll, live ? 1200 : 1800)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(t)
    }
  }, [live])
  return sources
}

function Card({ title, children, className, aside }: { title?: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={cn('border-hairline rounded-2xl border p-4', className)} style={{ backgroundColor: 'var(--surface-raised)' }}>
      {(title || aside) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-text-tertiary text-2xs-alt font-semibold tracking-wide uppercase">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

function Chip({ active, onClick, children, title, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40', active ? 'bg-accent text-white' : 'bg-white/8 text-text-secondary hover:bg-white/12')}
    >
      {children}
    </button>
  )
}

export function LiveDjView() {
  const [deck, setDeck] = useState<LiveInput | null>(null)
  const [live, setLive] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedPid, setPickedPid] = useState<number | null>(null)
  const [level, setLevel] = useState<SourceLevel>('soft')
  const [latency, setLatency] = useState<Latency>('balanced')
  const [fx, setFx] = useState<ParamValues>(DECK_DEFAULTS)
  const [bypass, setBypass] = useState(false)
  const [stats, setStats] = useState<LiveStats | null>(null)
  const [bpm, setBpm] = useState(120)
  const [loopBeats, setLoopBeats] = useState<number | null>(null)
  const [presetName, setPresetName] = useState<string | null>(null)
  const taps = useRef<number[]>([])
  const missing = useRef(0)

  const sources = useSources(live)
  const { media, positionMs: _pos } = useNowPlaying(1500)
  void _pos
  const master = useMasterBus()
  const presets = useDjPresets()

  // The effect rack renders itself from the chain's schema; read it once
  // from a throwaway offline chain so no live nodes are allocated for it.
  const specs: ParamSpec[] = useMemo(() => {
    const probe = new OfflineAudioContext(2, 1, 44100) as unknown as AudioContext
    const chain = createDeckChain(probe)
    const params = chain.params
    chain.dispose()
    return params
  }, [])

  // Stacked EQ boosts and filter resonance can push the sum past full scale,
  // and digital clipping sounds like static. The limiter is opt-in everywhere
  // else (it must be inert by default), but a live board should protect the
  // output from the start; it is still switchable in the Master section.
  const { setSettings: setMaster } = master
  useEffect(() => {
    setMaster({ limiterEnabled: true, ceilingDb: -1 })
  }, [setMaster])

  useEffect(() => {
    const d = LiveInput.create()
    setDeck(d)
    if (d) d.onStats = setStats
    const release = () => void invoke('live_audio_stop').catch(() => {})
    window.addEventListener('beforeunload', release)
    return () => {
      window.removeEventListener('beforeunload', release)
      void d?.dispose()
    }
  }, [])

  // Which source: the one the user picked, else the app the system says is
  // playing, else whatever is loudest.
  const autoSource = useMemo(() => {
    if (media) {
      const want = sourceName(media.source).toLowerCase()
      const hit = sources.find((s) => s.exe.toLowerCase().includes(want) || want.includes(s.name.toLowerCase()))
      if (hit) return hit
    }
    return sources.find((s) => s.active) ?? sources[0] ?? null
  }, [media, sources])
  const source = (pickedPid !== null ? sources.find((s) => s.pid === pickedPid) : null) ?? autoSource
  const mediaIsSource = !!(media && source && (sourceName(media.source).toLowerCase() === source.name.toLowerCase() || source.exe.toLowerCase().includes(sourceName(media.source).toLowerCase())))

  const stop = useCallback(async () => {
    setLoopBeats(null)
    await deck?.stop()
    setLive(false)
    setStats(null)
  }, [deck])

  const start = useCallback(
    async (target: AudioSource) => {
      if (!deck) return
      setStarting(true)
      setError(null)
      try {
        await deck.start(target.pid, { level, latency })
        deck.setBypass(bypass)
        missing.current = 0
        setLive(true)
      } catch (e) {
        setLive(false)
        setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Could not start the live tap.')
      } finally {
        setStarting(false)
      }
    },
    [deck, level, latency, bypass],
  )

  // Housekeeping while live: keep the source turned down, and let go
  // cleanly if the source app stops producing an audio session.
  useEffect(() => {
    if (!live || !deck) return
    if (source && sources.some((s) => s.pid === source.pid)) missing.current = 0
    else if (++missing.current >= 3) {
      void stop()
      setError('The source stopped playing, so the DJ board let go of it.')
    }
  }, [sources, live, deck, source, stop])

  const changeFx = (patch: ParamValues) => {
    setFx((prev) => {
      const next = { ...prev }
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v
      deck?.apply(next)
      return next
    })
  }
  const resetFx = () => {
    setFx(DECK_DEFAULTS)
    deck?.apply(DECK_DEFAULTS)
  }

  const tapTempo = () => {
    const now = performance.now()
    const t = taps.current
    if (t.length && now - t[t.length - 1] > 2000) t.length = 0
    t.push(now)
    if (t.length > 5) t.shift()
    if (t.length >= 2) {
      const avg = (t[t.length - 1] - t[0]) / (t.length - 1)
      setBpm(Math.round(Math.min(220, Math.max(60, 60000 / avg))))
    }
  }

  const toggleLoop = (beats: number) => {
    if (!deck || !live) return
    if (loopBeats === beats) {
      deck.setLoop(null)
      setLoopBeats(null)
    } else {
      deck.setLoop(Math.round(deck.ctx.sampleRate * (60 / bpm) * beats))
      setLoopBeats(beats)
    }
  }

  const delayMs = stats && deck ? Math.round(10 + stats.fillMs + (deck.ctx.baseLatency + (deck.ctx.outputLatency || 0)) * 1000) : null

  async function savePreset() {
    const name = presetName?.trim()
    if (!name) return
    await presets.savePreset(name, fx)
    setPresetName(null)
  }

  return (
    <ViewShell>
      <ViewHeader
        title="Live DJ"
        subtitle="Scratch the sound of anything playing: YouTube Music, Spotify, a browser tab, any app."
        actions={
          live && (
            <span className="text-text-secondary flex items-center gap-2 text-xs">
              <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden />
              Live{delayMs !== null && <span className="text-text-tertiary tabular-nums">· ~{delayMs} ms delay</span>}
              {stats && stats.underruns > 0 && <span className="text-text-tertiary tabular-nums">· {stats.underruns} dropouts</span>}
            </span>
          )
        }
      />
      <ViewBody className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* The deck: what is being mixed, and the one switch that starts it. */}
        <Card>
          <div className="flex items-center gap-4">
            {mediaIsSource && media ? (
              <Artwork m={media} size={72} radius={14} />
            ) : (
              <span className="bg-white/8 text-text-tertiary flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[14px] text-2xl font-semibold">{source ? source.name.slice(0, 1) : '–'}</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-text-primary truncate text-lg font-medium">{mediaIsSource && media ? media.title : source ? `${source.name} audio` : 'No app is playing sound'}</p>
              <p className="text-text-tertiary truncate text-sm">{mediaIsSource && media ? media.artist || media.album : source ? 'Playing now' : 'Start something in a browser or music app and it appears here.'}</p>
              {source && <p className="text-text-tertiary mt-0.5 text-2xs-alt">Source: {source.name}</p>}
            </div>
            {mediaIsSource && (
              <div className="flex items-center gap-1" aria-label="Control the source app">
                <button type="button" aria-label="Previous track" disabled={!media?.canPrevious} onClick={() => void mediaCommand('previous')} className="text-text-secondary flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14L9 12z" /></svg>
                </button>
                <button type="button" aria-label={media?.playing ? 'Pause' : 'Play'} onClick={() => void mediaCommand('play-pause')} className="text-text-secondary flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d={media?.playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5.5v13l11-6.5z'} /></svg>
                </button>
                <button type="button" aria-label="Next track" disabled={!media?.canNext} onClick={() => void mediaCommand('next')} className="text-text-secondary flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 5h2v14h-2zM4 5v14l11-7z" /></svg>
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={!deck || starting || (!live && !source)}
              onClick={() => (live ? void stop() : source && void start(source))}
              className={cn('h-11 shrink-0 rounded-full px-6 text-sm font-semibold transition-opacity disabled:opacity-40', live ? 'bg-white/12 text-text-primary hover:bg-white/16' : 'bg-accent text-white hover:opacity-90')}
            >
              {starting ? 'Starting…' : live ? 'Release' : 'Take over'}
            </button>
          </div>

          <div className="mt-4 h-28">
            <Scope analyser={deck?.analyser ?? null} live={live} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-1.5" role="group" aria-label="Source app">
              <span className="text-text-tertiary mr-1 text-xs">Source</span>
              {sources.length === 0 && <span className="text-text-tertiary text-xs">none playing</span>}
              {sources.map((s) => (
                <Chip
                  key={s.pid}
                  active={source?.pid === s.pid}
                  title={s.active ? 'Playing' : 'Idle'}
                  onClick={() => {
                    setPickedPid(s.pid)
                    if (live) void start(s)
                  }}
                >
                  <span className={cn('mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle', s.active ? 'bg-emerald-400' : 'bg-white/30')} />
                  {s.name}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="Latency">
              <span className="text-text-tertiary mr-1 text-xs">Latency</span>
              {LATENCIES.map((l) => (
                <Chip
                  key={l.id}
                  active={latency === l.id}
                  title={l.hint}
                  onClick={() => {
                    setLatency(l.id)
                    deck?.setTarget(l.id)
                  }}
                >
                  {l.label}
                </Chip>
              ))}
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="Original sound">
              <span className="text-text-tertiary mr-1 text-xs">Original sound</span>
              {LEVELS.map((l) => (
                <Chip
                  key={l.id}
                  active={level === l.id}
                  title={l.hint}
                  onClick={() => {
                    setLevel(l.id)
                    deck?.setLevel(l.id)
                  }}
                >
                  {l.label}
                </Chip>
              ))}
            </div>
          </div>
        </Card>

        <div className="flex min-h-0 flex-col gap-4 lg:flex-row">
          <Card
            title="Effects"
            className="min-w-0 flex-1"
            aside={
              <div className="flex items-center gap-1.5">
                <Chip active={bypass} onClick={() => { setBypass(!bypass); deck?.setBypass(!bypass) }} title="Hear the sound with every effect bypassed">
                  Bypass
                </Chip>
                <Chip active={false} onClick={resetFx}>
                  Reset
                </Chip>
              </div>
            }
          >
            <div className={cn('transition-opacity', bypass && 'pointer-events-none opacity-40')}>
              <EffectRack specs={specs} values={fx} onChange={changeFx} />
            </div>
            <div className="border-hairline mt-4 flex flex-wrap items-center gap-1.5 border-t pt-3">
              <span className="text-text-tertiary mr-1 text-xs">Presets</span>
              {presets.presets.map((p) => (
                <Chip key={p.id} active={false} onClick={() => changeFx(p.settings as ParamValues)}>
                  {p.name}
                </Chip>
              ))}
              {presetName === null ? (
                <Chip active={false} onClick={() => setPresetName('')}>
                  + Save current
                </Chip>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); void savePreset() }} className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onBlur={() => !presetName.trim() && setPresetName(null)}
                    placeholder="Preset name"
                    className="bg-white/8 text-text-primary w-36 rounded-full px-3 py-1 text-xs outline-none"
                  />
                  <Chip active onClick={() => void savePreset()}>Save</Chip>
                </form>
              )}
            </div>
          </Card>

          <div className="flex shrink-0 flex-col gap-4 lg:w-[290px]">
            <Card title="Loop">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={60}
                    max={220}
                    value={bpm}
                    aria-label="Tempo in BPM"
                    onChange={(e) => setBpm(Math.min(220, Math.max(60, Number(e.target.value) || 120)))}
                    className="bg-white/8 text-text-primary w-16 rounded-lg px-2 py-1 text-sm tabular-nums outline-none"
                  />
                  <span className="text-text-tertiary text-xs">BPM</span>
                </div>
                <Chip active={false} onClick={tapTempo} title="Tap along with the beat">
                  Tap
                </Chip>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {LOOPS.map((l) => (
                  <button
                    key={l.beats}
                    type="button"
                    disabled={!live}
                    aria-pressed={loopBeats === l.beats}
                    onClick={() => toggleLoop(l.beats)}
                    className={cn('h-11 rounded-xl text-base font-semibold transition-colors disabled:opacity-30', loopBeats === l.beats ? 'bg-accent text-white' : 'bg-white/8 text-text-secondary hover:bg-white/12')}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <p className="text-text-tertiary mt-2 text-2xs-alt">Repeats the last few beats you heard. Tap again to return to live.</p>
            </Card>

            <Card>
              <div className="flex items-start gap-4">
                <MasterSection settings={master.settings} onChange={master.setSettings} />
                <div className="h-28 shrink-0">
                  <LevelMeter analyser={master.analyser} isPlaying={live} />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </ViewBody>
    </ViewShell>
  )
}
