import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { mediaCommand, type NowPlaying } from '@/os/dock/panels/MediaPanel'
import { playSound } from '@/os/sound/sounds'
import { setImmersive } from '@/os/kernel/useImmersive'
import { cn } from '@/shared/lib/cn'
import { Ctx, type TvCtx } from './ctx'
import { Detail } from './Detail'
import { loadLibrary, tvLib, useLibrary } from './library'
import { AppsPage, Browse, Home, ListPage, SearchPage } from './Pages'
import { CATALOG, searchUrl, serviceById, type Service } from './services'
import { keyOf, searchName, type Title, type View } from './types'
import { focusRing, Icon, Logo } from './ui'
import './tv.css'

const BAR_H = 44

/**
 * UDAAN TV. A full-screen home for your streaming apps (they play inside it) and for deciding what to
 * watch: this week's films and series, a page for every title with its trailer and where to watch it, a
 * list of what you're watching and what's next, and reminders that land in Calendar.
 *
 * The top bar always stays above whatever is playing. Everything below it is the stage: a TV page, or the
 * running app placed exactly over it. Animation is on interaction only; nothing loops.
 */
export function TvApp({ onClose }: { onClose: () => void }) {
  const { lib, ready } = useLibrary()
  const [running, setRunning] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [stack, setStack] = useState<View[]>([{ n: 'home' }])
  const [query, setQuery] = useState('')
  const [np, setNp] = useState<NowPlaying | null>(null)
  const [volume, setVolume] = useState<number | null>(null)
  const [muted, setMuted] = useState(false)
  const [sleepAt, setSleepAt] = useState<number | null>(null)
  const [menu, setMenu] = useState<'sleep' | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const activeRef = useRef<string | null>(null)
  const missed = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const view = stack[stack.length - 1]
  const section = stack[0].n

  const say = useCallback((t: string, ms = 3200) => {
    setToast(t)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }, [])
  const nav = (action: 'back' | 'forward' | 'reload') => {
    if (active) void invoke('tv_host_nav', { id: active, action })
  }

  useEffect(() => void loadLibrary(), [])
  useEffect(() => {
    activeRef.current = active
  }, [active])

  /* ── hosting: full screen, the running apps, volume ─────────────── */

  // Windowed by default, so the menu bar and dock stay reachable; full screen
  // is opt-in and hides the OS bars only while it is on. Services are closed
  // with the TV.
  useEffect(() => {
    const w = getCurrentWindow()
    let closing = false
    // The TV owns the whole screen and can't be resized, moved or un-fullscreened:
    // resizing a window with a browser embedded in it is what used to stall the shell.
    void w.setResizable(false).catch(() => {})
    const enter = () => void w.setFullscreen(true).then(() => setImmersive(true), () => {})
    enter()
    const unResize = w.onResized(
      () =>
        void w.isFullscreen().then((f) => {
          if (!f && !closing) enter()
          else setImmersive(f)
        }, () => {}),
    )
    void invoke<{ level: number; muted?: boolean }>('shell_volume').then((v) => { setVolume(v.level); setMuted(!!v.muted) }, () => {})
    const t = setInterval(
      () =>
        void invoke<string[]>('tv_host_running').then((list) => {
          setRunning(list)
          // A service closed from inside (its own window, a crash): don't leave a blank stage.
          const a = activeRef.current
          if (a && !list.includes(a)) {
            if (++missed.current >= 2) {
              missed.current = 0
              setActive(null)
            }
          } else missed.current = 0
        }, () => {}),
      3000,
    )
    const bye = () => {
      setImmersive(false)
      void invoke('tv_host_close', { id: null })
    }
    window.addEventListener('beforeunload', bye)
    return () => {
      closing = true
      clearInterval(t)
      window.removeEventListener('beforeunload', bye)
      void unResize.then((f) => f())
      setImmersive(false)
      bye()
    }
  }, [])

  useEffect(() => {
    const poll = () => void invoke<NowPlaying | null>('shell_now_playing').then(setNp, () => {})
    poll()
    const t = setInterval(poll, 2500)
    return () => clearInterval(t)
  }, [])

  // Keep the hosted service exactly over the stage area.
  const layout = useCallback(() => {
    const scale = window.devicePixelRatio || 1
    if (!active || !stageRef.current) {
      void invoke('tv_host_show', { id: null, x: 0, y: 0, w: 0, h: 0, scale })
      return
    }
    const r = stageRef.current.getBoundingClientRect()
    void invoke('tv_host_show', { id: active, x: Math.round(r.left * scale), y: Math.round(r.top * scale), w: Math.round(r.width * scale), h: Math.round(r.height * scale), scale })
  }, [active])
  useLayoutEffect(() => {
    layout()
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(layout)
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [layout])

  const openApp = useCallback(
    async (s: Service, url = s.url) => {
      playSound('open')
      setLoading(s.id)
      try {
        await invoke('tv_host_open', { id: s.id, url, tvUi: !!s.tvUi })
        setRunning((r) => [...new Set([...r, s.id])])
        setActive(s.id)
        tvLib.noteRecent(s.id)
      } catch (e) {
        say(String(e), 8000)
      } finally {
        setLoading(null)
      }
    },
    [say],
  )

  const close = (id: string) => {
    void invoke('tv_host_close', { id })
    setRunning((r) => r.filter((x) => x !== id))
    if (active === id) setActive(null)
  }

  // Sleep timer: pauses playback and closes the apps.
  useEffect(() => {
    if (!sleepAt) return
    const t = setInterval(() => {
      if (Date.now() < sleepAt) return
      setSleepAt(null)
      if (np?.playing) void mediaCommand('play-pause')
      void invoke('tv_host_close', { id: null })
      setRunning([])
      setActive(null)
      say('Sleep timer: goodnight')
    }, 5000)
    return () => clearInterval(t)
  }, [sleepAt, np, say])

  const setVol = (v: number) => {
    setVolume(v)
    setMuted(false)
    void invoke('shell_set_volume', { level: v, muted: false }).catch(() => {})
  }
  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    void invoke('shell_set_volume', { level: null, muted: next }).catch(() => {})
  }

  /* ── pages ─────────────────────────────────────────────────────── */

  const go = useCallback((v: View) => {
    setActive(null)
    setStack((s) => (['home', 'movies', 'series', 'list', 'apps'].includes(v.n) ? [v] : [...s, v]))
    if (v.n !== 'search') setQuery('')
  }, [])
  const back = useCallback(() => {
    setStack((s) => {
      if (s.length < 2) return s
      if (s[s.length - 1].n === 'search') setQuery('')
      return s.slice(0, -1)
    })
  }, [])
  const openTitle = useCallback((t: Title) => setStack((s) => [...s, { n: 'title', t }]), [])

  // Typing in the search box shows results once you pause; clearing it goes back.
  useEffect(() => {
    const q = query.trim()
    const id = setTimeout(() => {
      setStack((s) => {
        const top = s[s.length - 1]
        if (q.length < 2) return top.n === 'search' ? (s.length > 1 ? s.slice(0, -1) : [{ n: 'home' }]) : s
        if (top.n === 'search') return top.q === q ? s : [...s.slice(0, -1), { n: 'search', q }]
        return [...s, { n: 'search', q }]
      })
    }, 380)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (activeRef.current) return
      const typing = (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA'
      if (e.key === '/' && !typing) (e.preventDefault(), searchRef.current?.focus())
      else if (e.key === 'Escape') {
        if (typing) (e.target as HTMLElement).blur()
        else back()
      } else if ((e.altKey && e.key === 'ArrowLeft') || (e.key === 'Backspace' && !typing)) (e.preventDefault(), back())
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [back])

  /* ── what the pages are given ──────────────────────────────────── */

  const searchable = useMemo(() => {
    const list = CATALOG.filter((s) => s.search && (s.id === 'appletv' || lib.installed.includes(s.id)))
    return [...list].sort((a, b) => Number(b.id === lib.provider) - Number(a.id === lib.provider))
  }, [lib.installed, lib.provider])
  const chosen = searchable[0] ?? CATALOG[0]

  const watch = useCallback(
    (s: Service, t: Title) => {
      // Starting something moves it to "watching" (a finished title stays finished: you may be re-watching).
      const was = lib.items[keyOf(t)]?.status
      tvLib.put(t, { service: s.id, ...(was === 'watched' ? {} : { status: 'watching' as const }) })
      tvLib.setProvider(s.id)
      void openApp(s, searchUrl(s, searchName(t)))
    },
    [lib.items, openApp],
  )

  const ctx: TvCtx = { openTitle, watch, openApp: (s, url) => void openApp(s, url), go, say, running, loadingId: loading, searchable, chosen }

  const NAV: [View['n'], string, Parameters<typeof Icon>[0]['name']][] = [
    ['home', 'Home', 'home'],
    ['movies', 'Films', 'film'],
    ['series', 'Series', 'tv'],
    ['list', 'My list', 'bookmark'],
    ['apps', 'Apps', 'grid'],
  ]
  const listCount = Object.values(lib.items).filter((i) => i.status !== 'watched').length

  let page = null
  if (ready) {
    switch (view.n) {
      case 'home':
        page = <Home />
        break
      case 'movies':
        page = <Browse kind="movie" />
        break
      case 'series':
        page = <Browse kind="show" />
        break
      case 'list':
        page = <ListPage />
        break
      case 'apps':
        page = <AppsPage />
        break
      case 'search':
        page = <SearchPage q={view.q} />
        break
      case 'title':
        page = <Detail seed={view.t} onBack={back} />
        break
    }
  }
  const viewKey = view.n === 'title' ? `t:${view.t.kind}:${view.t.id}` : view.n === 'search' ? 'search' : view.n

  return (
    <Ctx.Provider value={ctx}>
      <div className="relative flex h-full w-full select-none flex-col overflow-hidden bg-[#0c0d10] text-white">
        {/* ---------- TV bar: stays above whatever is playing ---------- */}
        <div className="relative z-20 flex shrink-0 items-center gap-1 border-b border-white/[0.07] bg-[#101114] px-3" style={{ height: BAR_H }}>
          <button type="button" aria-label="Home" title="Home" onClick={() => go({ n: 'home' })} className={cn('flex h-8 w-8 items-center justify-center rounded-full transition-colors', focusRing, !active ? 'bg-white text-black' : 'text-white/70 hover:bg-white/[0.1] hover:text-white')}>
            <Icon name="home" size={16} />
          </button>
          {active && (
            <div className="ml-1 flex items-center">
              <BarButton label="Back" onClick={() => nav('back')} icon="back" />
              <BarButton label="Forward" onClick={() => nav('forward')} icon="fwd" />
              <BarButton label="Reload" onClick={() => nav('reload')} icon="reload" />
            </div>
          )}
          {running.length > 0 && <span className="mx-1.5 h-5 w-px bg-white/10" />}
          {running.map((id) => {
            const s = serviceById(id)
            if (!s) return null
            const on = active === id
            return (
              <div key={id} className={cn('group relative flex h-8 items-center rounded-full transition-colors', on ? 'bg-white/[0.14] pl-1 pr-1' : 'px-1 hover:bg-white/[0.08]')}>
                <button type="button" title={s.name} onClick={() => setActive(id)} className="flex items-center gap-2 text-[13px] font-semibold">
                  <Logo s={s} size={24} />
                  {on && <span className="pr-1">{s.name}</span>}
                </button>
                {on ? (
                  <button type="button" aria-label={`Close ${s.name}`} title={`Close ${s.name}`} onClick={() => close(id)} className="flex h-6 w-6 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.16] hover:text-white">
                    <Icon name="close" size={12} />
                  </button>
                ) : (
                  <button type="button" aria-label={`Close ${s.name}`} onClick={() => close(id)} className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-[#3a3a3e] text-[10px] leading-none text-white group-hover:flex">
                    ×
                  </button>
                )}
              </div>
            )
          })}
          <span className="min-w-0 flex-1 truncate px-3 text-center text-[12.5px] font-medium text-white/80" title={toast ?? undefined}>
            {toast}
          </span>
          <MediaCentre np={np} volume={volume} muted={muted} onVolume={setVol} onMute={toggleMute} />
          {menu === 'sleep' && (
            <div className="flex items-center gap-0.5 rounded-full bg-white/[0.07] p-0.5">
              {[0, 15, 30, 45, 60, 90].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setSleepAt(m ? Date.now() + m * 60_000 : null)
                    setMenu(null)
                    say(m ? `Sleep timer set for ${m} minutes` : 'Sleep timer off')
                  }}
                  className="h-7 rounded-full px-2.5 text-[12px] font-medium text-white/80 hover:bg-white/[0.14]"
                >
                  {m ? `${m}m` : 'Off'}
                </button>
              ))}
            </div>
          )}
          <button type="button" title="Sleep timer" onClick={() => setMenu(menu ? null : 'sleep')} className={cn('flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium', sleepAt ? 'bg-[var(--u-accent)]/25 text-white' : 'text-white/60 hover:bg-white/[0.1] hover:text-white')}>
            <Icon name="moon" size={14} />
            {sleepAt ? `${Math.max(1, Math.ceil((sleepAt - Date.now()) / 60_000))}m` : ''}
          </button>
          <button type="button" title="Close TV" onClick={onClose} className="ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.1] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#ff453a]">
            <Icon name="close" size={12} />
            Close TV
          </button>
        </div>

        {/* ---------- stage: a TV page, or the playing app placed exactly here ---------- */}
        <div ref={stageRef} className="relative min-h-0 flex-1">
          {active ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-[15px] text-white/40">
              {loading === active && (
                <>
                  <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
                  Starting…
                </>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex h-14 shrink-0 items-center gap-3 px-14">
                <nav className="flex items-center gap-1" aria-label="TV sections">
                  {NAV.map(([n, label, icon]) => (
                    <button key={n} type="button" aria-current={section === n ? 'page' : undefined} onClick={() => go({ n } as View)} className={cn('flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium transition-colors duration-100', focusRing, section === n ? 'bg-white/[0.14] text-white' : 'text-white/60 hover:bg-white/[0.08] hover:text-white')}>
                      <Icon name={icon} size={15} />
                      {label}
                      {n === 'list' && listCount > 0 && <span className="rounded-full bg-white/[0.14] px-1.5 text-[11px] tabular-nums">{listCount}</span>}
                    </button>
                  ))}
                </nav>
                <span className="flex-1" />
                <label className="flex h-9 w-[300px] items-center gap-2.5 rounded-full bg-white/[0.08] px-4 focus-within:bg-white/[0.13] focus-within:ring-1 focus-within:ring-[var(--u-accent)]">
                  <Icon name="search" size={15} className="text-white/50" />
                  <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search films and series  ( / )" spellCheck={false} className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-white/35" />
                  {query && (
                    <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-white/50 hover:text-white">
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </label>
              </div>
              <div key={viewKey} className="tv-fade u-scroll min-h-0 flex-1 overflow-y-auto">
                {page}
              </div>
            </div>
          )}
        </div>
      </div>
    </Ctx.Provider>
  )
}

/* ── top bar pieces ──────────────────────────────────────────────── */

function BarButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: 'back' | 'fwd' | 'reload' }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-full text-white/65 transition-colors hover:bg-white/[0.1] hover:text-white active:scale-95">
      <Icon name={icon} size={15} />
    </button>
  )
}

function MediaButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/[0.12] hover:text-white active:scale-90 disabled:opacity-30">
      {children}
    </button>
  )
}

/** What is playing, transport controls and volume, always at hand. */
function MediaCentre({ np, volume, muted, onVolume, onMute }: { np: NowPlaying | null; volume: number | null; muted: boolean; onVolume: (v: number) => void; onMute: () => void }) {
  const playing = !!np?.playing
  return (
    <div className="mr-1 flex items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pl-2.5 pr-1 ring-1 ring-white/[0.07]">
      <span aria-hidden className={cn('flex h-4 w-4 items-end justify-between', playing ? 'text-[var(--u-accent)]' : 'text-white/30')}>
        {[0.55, 1, 0.7].map((h, i) => (
          <span key={i} className="w-[3px] rounded-full bg-current" style={{ height: `${h * 100}%` }} />
        ))}
      </span>
      <div className="mx-1 hidden min-w-0 max-w-[170px] leading-tight md:block">
        <p className="truncate text-[11.5px] font-semibold text-white/90">{np?.title || 'Nothing playing'}</p>
        {np?.artist && <p className="truncate text-[10px] text-white/45">{np.artist}</p>}
      </div>
      <MediaButton label="Previous" disabled={!np?.canPrevious} onClick={() => void mediaCommand('previous')}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M6 5h2v14H6zM20 5v14L9.5 12z" />
        </svg>
      </MediaButton>
      <MediaButton label={playing ? 'Pause' : 'Play'} onClick={() => void mediaCommand('play-pause')}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l10.5-6.5z" />}
        </svg>
      </MediaButton>
      <MediaButton label="Next" disabled={!np?.canNext} onClick={() => void mediaCommand('next')}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M16 5h2v14h-2zM4 5v14l10.5-7z" />
        </svg>
      </MediaButton>
      <span className="mx-0.5 h-4 w-px bg-white/10" />
      <MediaButton label={muted ? 'Unmute' : 'Mute'} onClick={onMute}>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path stroke="none" d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4Z" />
          {muted ? <path fill="none" d="M15.5 9.5l5 5M20.5 9.5l-5 5" /> : <path fill="none" d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11" />}
        </svg>
      </MediaButton>
      {volume !== null && <input type="range" min={0} max={1} step={0.02} value={muted ? 0 : volume} onChange={(e) => onVolume(Number(e.target.value))} aria-label="Volume" className="u-range mr-1.5 w-20" />}
    </div>
  )
}
