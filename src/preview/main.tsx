import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { emit } from '@tauri-apps/api/event'
import '../styles/theme.css'
import { ThemeProvider } from '../app/ThemeProvider'
import { SoundPanel } from '@/os/dock/panels/SoundPanel'
import { EdgeLightPanel } from '@/os/dock/panels/EdgeLightPanel'
import { EdgeLightWindow } from '@/os/edgelight/EdgeLightWindow'
import { PreviewAudio, type EqRequest } from './eq'

/** Dev-only: the real panels in a normal browser, talking to a pretend system (see tauri-stub.js). */
const preview = (window as unknown as { __preview: { state: { apo: boolean } } }).__preview

/** A recording from the Music folder, served by the dev server. */
const DEFAULT_TRACK = '/@fs/C:/Users/Gener/Music/Icecream%20Screen%20Recorder/Musicforad.mp3'

function Page() {
  const [tab, setTab] = useState<'sound' | 'edge'>('sound')
  const [apo, setApo] = useState(preview.state.apo)
  const [lines, setLines] = useState<string[]>([])
  const [playing, setPlaying] = useState(false)
  const [track, setTrack] = useState('Musicforad.mp3 (from your Music folder)')
  const audio = useRef<HTMLAudioElement>(null)
  const engine = useRef<PreviewAudio | null>(null)
  const eq = useRef<EqRequest>({ preset: 'flat' })

  useEffect(() => {
    const onLog = (e: Event) => setLines((l) => [(e as CustomEvent<string>).detail, ...l].slice(0, 10))
    const onEq = (e: Event) => {
      eq.current = (e as CustomEvent<EqRequest>).detail
      engine.current?.apply(eq.current)
    }
    const onVolume = (e: Event) => {
      const v = (e as CustomEvent<{ level: number; muted: boolean }>).detail
      if (audio.current) audio.current.volume = v.muted ? 0 : v.level
    }
    window.addEventListener('preview-log', onLog)
    window.addEventListener('preview-eq', onEq)
    window.addEventListener('preview-volume', onVolume)
    return () => {
      window.removeEventListener('preview-log', onLog)
      window.removeEventListener('preview-eq', onEq)
      window.removeEventListener('preview-volume', onVolume)
    }
  }, [])

  // While music plays, the edge light overlay gets the real spectrum of what you hear.
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => {
      if (engine.current) void emit('edge-light:frame', { bands: engine.current.spectrum() }).catch(() => {})
    }, 33)
    return () => {
      clearInterval(timer)
      void emit('edge-light:frame', { bands: new Array(64).fill(0) }).catch(() => {})
    }
  }, [playing])

  const toggle = async () => {
    const el = audio.current
    if (!el) return
    if (!engine.current) {
      engine.current = new PreviewAudio(el)
      engine.current.apply(eq.current)
    }
    await engine.current.ctx.resume()
    if (el.paused) await el.play().catch(() => {})
    else el.pause()
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_30%_15%,#1c2238,#07080d)] p-8 text-[var(--os-menu-text)]">
      <EdgeLightWindow />
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col gap-5">
        <header>
          <h1 className="text-[20px] font-semibold">Udaan component preview</h1>
          <p className="mt-1 text-[13px] text-[var(--os-menu-text-dim)]">
            These are the real panels in your browser, on pretend system data. Nothing here changes your PC: volume, Equalizer APO and the speaker signal are simulated. The music, equalizer and edge light, however, are real.
          </p>
        </header>

        <section className="flex flex-wrap items-center gap-3 rounded-[14px] bg-white/[0.07] p-3">
          <button type="button" onClick={() => void toggle()} className="h-10 rounded-full bg-white px-5 text-[13px] font-semibold text-black active:scale-95">
            {playing ? 'Pause' : 'Play a song'}
          </button>
          <label className="cursor-pointer rounded-full bg-white/10 px-4 py-2 text-[13px] font-medium hover:bg-white/15">
            Choose a song…
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f || !audio.current) return
                audio.current.src = URL.createObjectURL(f)
                setTrack(f.name)
                if (!audio.current.paused) void audio.current.play()
              }}
            />
          </label>
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--os-menu-text-dim)]">{track}</span>
          <audio ref={audio} src={DEFAULT_TRACK} loop onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-full bg-white/10 p-0.5">
            {(
              [
                ['sound', 'Sound panel'],
                ['edge', 'Edge light'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${tab === id ? 'bg-white text-black' : 'hover:bg-white/10'}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'sound' && (
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={apo}
                onChange={(e) => {
                  preview.state.apo = e.target.checked
                  setApo(e.target.checked)
                }}
              />
              Pretend Equalizer APO is installed
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-6">
          <div className="os-acrylic w-[340px] rounded-[var(--os-radius-overlay)]">{tab === 'sound' ? <SoundPanel /> : <EdgeLightPanel />}</div>
          <aside className="min-w-[240px] flex-1">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--os-menu-text-dim)]">What the panel sent</p>
            <ul className="flex flex-col gap-1 text-[12.5px]">
              {lines.length === 0 && <li className="text-[var(--os-menu-text-dim)]">Nothing yet — try a control.</li>}
              {lines.map((l, i) => (
                <li key={`${i}-${l}`} className="rounded-[8px] bg-white/[0.06] px-2.5 py-1.5">
                  {l}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12.5px] leading-snug text-[var(--os-menu-text-dim)]">
              {tab === 'sound'
                ? 'Press Play, then switch between Flat, Cinematic, Bass and the rest while it plays. The volume slider and mute change the real loudness here too.'
                : 'Press Play: the light around this window follows the music. Change the style, colours and presets to see them live.'}
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <Page />
  </ThemeProvider>,
)
