import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { mediaCommand, type NowPlaying } from '@/os/dock/panels/MediaPanel'
import { playSound } from '@/os/sound/sounds'
import { launchApp } from '@/integrations/installed-apps/client'
import { setImmersive } from '@/os/kernel/useImmersive'

/** A streaming service that can be installed onto the TV. */
interface Service {
  id: string
  name: string
  url: string
  domain: string
  color: string
  category: 'Video' | 'Music' | 'Live'
  blurb: string
  tvUi?: boolean
  /** Search URL; {q} is replaced. */
  search?: string
  /** Microsoft Store product id of the official Windows app, when one exists. */
  store?: string
}

const CATALOG: Service[] = [
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', domain: 'youtube.com', color: '#ff0000', category: 'Video', blurb: 'Videos, creators and live', search: 'https://www.youtube.com/results?search_query={q}' },
  { id: 'disney', store: '9NXQXXLFST89', name: 'Disney+', url: 'https://www.disneyplus.com', domain: 'disneyplus.com', color: '#0e47a1', category: 'Video', blurb: 'Disney, Pixar, Marvel, Star Wars', search: 'https://www.disneyplus.com/search?q={q}' },
  { id: 'appletv', store: '9NM4T8B9JQZ1', name: 'Apple TV', url: 'https://tv.apple.com', domain: 'tv.apple.com', color: '#1c1c1e', category: 'Video', blurb: 'Apple TV+ originals and films', search: 'https://tv.apple.com/search?term={q}' },
  { id: 'iplayer', name: 'BBC iPlayer', url: 'https://www.bbc.co.uk/iplayer', domain: 'bbc.co.uk', color: '#e0187a', category: 'Video', blurb: 'BBC shows, live channels and catch-up', search: 'https://www.bbc.co.uk/iplayer/search?q={q}' },
  { id: 'ytmusic', name: 'YouTube Music', url: 'https://music.youtube.com', domain: 'music.youtube.com', color: '#e10000', category: 'Music', blurb: 'Songs, albums and mixes', search: 'https://music.youtube.com/search?q={q}' },
  { id: 'netflix', store: '9WZDNCRFJ3TJ', name: 'Netflix', url: 'https://www.netflix.com', domain: 'netflix.com', color: '#b20710', category: 'Video', blurb: 'Series, films and anime', search: 'https://www.netflix.com/search?q={q}' },
  { id: 'showmax', name: 'Showmax', url: 'https://www.showmax.com', domain: 'showmax.com', color: '#e8114b', category: 'Video', blurb: 'African originals and HBO' },
  { id: 'dstv', name: 'DStv', url: 'https://now.dstv.com', domain: 'dstv.com', color: '#0a6bcc', category: 'Live', blurb: 'Live TV channels and catch-up' },
  { id: 'sabcplus', name: 'SABC+', url: 'https://www.sabc-plus.com', domain: 'sabc-plus.com', color: '#0072bc', category: 'Live', blurb: 'SABC channels, live and on demand' },
  { id: 'prime', store: '9P6RC76MSMMJ', name: 'Prime Video', url: 'https://www.primevideo.com', domain: 'primevideo.com', color: '#00a8e1', category: 'Video', blurb: 'Amazon originals and films' },
  { id: 'spotify', store: '9NCBCSZSJRSB', name: 'Spotify', url: 'https://open.spotify.com', domain: 'spotify.com', color: '#1db954', category: 'Music', blurb: 'Music and podcasts', search: 'https://open.spotify.com/search/{q}' },
  { id: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv', domain: 'twitch.tv', color: '#9146ff', category: 'Live', blurb: 'Live streams and gaming' },
  { id: 'crunchyroll', name: 'Crunchyroll', url: 'https://www.crunchyroll.com', domain: 'crunchyroll.com', color: '#f47521', category: 'Video', blurb: 'Anime, simulcast from Japan' },
  { id: 'plex', name: 'Plex', url: 'https://app.plex.tv', domain: 'plex.tv', color: '#e5a00d', category: 'Video', blurb: 'Your media, plus free movies' },
  { id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com', domain: 'deezer.com', color: '#a238ff', category: 'Music', blurb: 'Music streaming' },
  { id: 'soundcloud', name: 'SoundCloud', url: 'https://soundcloud.com', domain: 'soundcloud.com', color: '#ff5500', category: 'Music', blurb: 'Independent artists and mixes' },
  { id: 'ted', name: 'TED', url: 'https://www.ted.com/talks', domain: 'ted.com', color: '#e62b1e', category: 'Video', blurb: 'Ideas worth spreading' },
]

const INSTALLED_KEY = 'tv.installed.v2'
const DEFAULT_INSTALLED = ['youtube', 'disney', 'appletv', 'ytmusic', 'iplayer']
const BAR_H = 44

interface Poster {
  title: string
  image: string
  /** Large artwork for the featured poster and its backdrop. */
  imageHi?: string
  genre: string
  summary: string
  year?: string
}

const logo = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`

function loadInstalled(): string[] {
  let list = DEFAULT_INSTALLED
  try {
    list = JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? 'null') ?? DEFAULT_INSTALLED
    // BBC iPlayer joined the catalogue later: add it once for everyone who already has a list.
    if (!localStorage.getItem('tv.iplayer.added')) {
      localStorage.setItem('tv.iplayer.added', '1')
      if (!list.includes('iplayer')) {
        list = [...list, 'iplayer']
        localStorage.setItem(INSTALLED_KEY, JSON.stringify(list))
      }
    }
  } catch {
    /* storage unavailable: use what we have */
  }
  return list
}

function Logo({ s, size }: { s: Service; size: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[26%] bg-white shadow-md" style={{ width: size, height: size }}>
      <img src={logo(s.domain)} alt="" className="object-contain" style={{ width: size * 0.66, height: size * 0.66 }} draggable={false} />
    </span>
  )
}

/** Udaan TV: a cinematic home for your streaming apps, which play inside it. */
export function TvApp({ onClose }: { onClose: () => void }) {
  const [installed, setInstalled] = useState<string[]>(loadInstalled)
  const [running, setRunning] = useState<string[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [page, setPage] = useState<'home' | 'store'>('home')
  const [posters, setPosters] = useState<Poster[]>([])
  const [shows, setShows] = useState<Poster[]>([])
  const [genre, setGenre] = useState('All')
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('appletv')
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('tv.recent') ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const [hero, setHero] = useState(0)
  const [np, setNp] = useState<NowPlaying | null>(null)
  const [volume, setVolume] = useState<number | null>(null)
  const [muted, setMuted] = useState(false)
  const [sleepAt, setSleepAt] = useState<number | null>(null)
  const [menu, setMenu] = useState<'sleep' | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<string | null>(null)
  const missed = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const apps = useMemo(() => installed.map((id) => CATALOG.find((s) => s.id === id)).filter(Boolean) as Service[], [installed])
  const say = (t: string, ms = 3200) => {
    setToast(t)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), ms)
  }
  const nav = (action: 'back' | 'forward' | 'reload') => {
    if (active) void invoke('tv_host_nav', { id: active, action })
  }

  useEffect(() => {
    activeRef.current = active
  }, [active])

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
    void invoke<Poster[]>('tv_top_movies').then(setPosters, () => {})
    void invoke<Poster[]>('tv_top_shows').then(setShows, () => {})
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

  // Hero carousel.
  useEffect(() => {
    if (active || !posters.length) return
    const t = setInterval(() => setHero((h) => (h + 1) % Math.min(posters.length, 8)), 8000)
    return () => clearInterval(t)
  }, [active, posters.length])

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

  const open = async (s: Service, url = s.url) => {
    playSound('open')
    setLoading(s.id)
    try {
      await invoke('tv_host_open', { id: s.id, url, tvUi: !!s.tvUi })
      setRunning((r) => [...new Set([...r, s.id])])
      setActive(s.id)
      setRecent((r) => {
        const next = [s.id, ...r.filter((x) => x !== s.id)].slice(0, 6)
        try {
          localStorage.setItem('tv.recent', JSON.stringify(next))
        } catch {
          /* not remembered */
        }
        return next
      })
    } catch (e) {
      say(String(e), 8000)
    } finally {
      setLoading(null)
    }
  }

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
      say('Sleep timer — goodnight')
    }, 5000)
    return () => clearInterval(t)
  }, [sleepAt, np])

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

  const install = (id: string) => {
    const next = installed.includes(id) ? installed.filter((x) => x !== id) : [...installed, id]
    setInstalled(next)
    try {
      localStorage.setItem(INSTALLED_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable */
    }
  }

  const featured = posters[hero]
  const searchable = useMemo(() => CATALOG.filter((s) => s.search && (s.id === 'appletv' || installed.includes(s.id))), [installed])
  const chosen = searchable.find((s) => s.id === provider) ?? searchable[0] ?? CATALOG.find((s) => s.id === 'appletv')!
  const searchOn = (svc: Service, q: string) => void open(svc, (svc.search ?? svc.url).replace('{q}', encodeURIComponent(q)))
  const watch = (p: Poster) => searchOn(chosen, p.title)
  const genres = useMemo(() => ['All', ...Array.from(new Set(posters.map((p) => p.genre).filter(Boolean))).slice(0, 7)], [posters])
  const films = useMemo(() => (genre === 'All' ? posters : posters.filter((p) => p.genre === genre)), [posters, genre])
  const recentApps = useMemo(() => recent.map((id) => CATALOG.find((s) => s.id === id)).filter((s): s is Service => !!s && installed.includes(s.id)).slice(0, 4), [recent, installed])

  return (
    <div className="relative flex h-full w-full select-none flex-col overflow-hidden bg-[#050507] text-white">
      {/* ---------- TV bar: stays above whatever is playing ---------- */}
      <motion.div initial={{ y: -BAR_H, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} className="relative z-20 flex shrink-0 items-center gap-1 border-b border-white/[0.06] bg-gradient-to-b from-[#131318] to-[#09090b] px-3" style={{ height: BAR_H }}>
        <button
          type="button"
          aria-label="Home"
          title="Home"
          onClick={() => {
            setActive(null)
            setPage('home')
          }}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${!active ? 'bg-white text-black' : 'text-white/70 hover:bg-white/[0.1] hover:text-white'}`}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 3 2.5 11h2.8v9.5h5v-6h3.4v6h5V11h2.8z" />
          </svg>
        </button>
        {active && (
          <div className="ml-1 flex items-center">
            <BarButton label="Back" onClick={() => nav('back')} path="M15 5l-7 7 7 7" />
            <BarButton label="Forward" onClick={() => nav('forward')} path="M9 5l7 7-7 7" />
            <BarButton label="Reload" onClick={() => nav('reload')} path="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" />
          </div>
        )}
        {running.length > 0 && <span className="mx-1.5 h-5 w-px bg-white/10" />}
        {running.map((id) => {
          const s = CATALOG.find((x) => x.id === id)
          if (!s) return null
          const on = active === id
          return (
            <motion.div key={id} layout initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ type: 'spring', stiffness: 520, damping: 32 }} className={`group relative flex h-8 items-center rounded-full transition-colors ${on ? 'bg-white/[0.14] pl-1 pr-1' : 'px-1 hover:bg-white/[0.08]'}`}>
              <button type="button" title={s.name} onClick={() => setActive(id)} className="flex items-center gap-2 text-[13px] font-semibold">
                <Logo s={s} size={24} />
                {on && <span className="pr-1">{s.name}</span>}
              </button>
              {on ? (
                <button type="button" aria-label={`Close ${s.name}`} title={`Close ${s.name}`} onClick={() => close(id)} className="flex h-6 w-6 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.16] hover:text-white">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              ) : (
                <button type="button" aria-label={`Close ${s.name}`} onClick={() => close(id)} className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-[#3a3a3e] text-[10px] leading-none text-white group-hover:flex">
                  ×
                </button>
              )}
            </motion.div>
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
        <button type="button" title="Sleep timer" onClick={() => setMenu(menu ? null : 'sleep')} className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium ${sleepAt ? 'bg-[#bf5af2]/25 text-[#dcb4ff]' : 'text-white/60 hover:bg-white/[0.1] hover:text-white'}`}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
          </svg>
          {sleepAt ? `${Math.max(1, Math.ceil((sleepAt - Date.now()) / 60_000))}m` : ''}
        </button>
        <motion.button
          type="button"
          title="Close TV"
          onClick={onClose}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
          className="ml-1 flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#ff453a] px-3.5 text-[12.5px] font-semibold text-white shadow-[0_6px_18px_rgb(255_69_58/0.35)] hover:bg-[#ff5a50]"
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
          Close TV
        </motion.button>
      </motion.div>

      {/* ---------- stage: the playing app is placed exactly here ---------- */}
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
          <AnimatePresence mode="wait" initial={false}>
            {page === 'store' ? (
              <motion.div key="store" className="h-full" initial={{ opacity: 0, y: 28, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -18, scale: 0.99 }} transition={{ duration: 0.32, ease: EASE }}>
                <Store installed={installed} onToggle={install} onBack={() => setPage('home')} />
              </motion.div>
            ) : (
              <motion.div key="home" className="relative h-full" initial={{ opacity: 0, y: 28, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -18, scale: 0.99 }} transition={{ duration: 0.32, ease: EASE }}>
                <Ambient />
                <div className="relative h-full overflow-y-auto">
                  {/* Hero */}
                  <section className="relative h-[62vh] min-h-[420px] overflow-hidden">
                    <AnimatePresence>
                      {featured && (
                        <motion.div key={featured.image} className="absolute inset-0" initial={{ opacity: 0, scale: 1.12 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 1.4, ease: EASE }}>
                          <img src={featured.imageHi ?? featured.image} alt="" className="h-full w-full scale-110 object-cover blur-2xl brightness-[0.45]" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#050507] via-[#050507]/40 to-transparent" />
                    <div className="absolute inset-0 bg-gradient-to-r from-[#050507]/90 via-[#050507]/30 to-transparent" />
                    {featured ? (
                      <div className="relative flex h-full items-end gap-12 px-16 pb-14">
                        <AnimatePresence mode="wait">
                          <motion.div key={featured.title} initial="hidden" animate="show" exit={{ opacity: 0, y: -10, transition: { duration: 0.25 } }} variants={{ show: { transition: { staggerChildren: 0.08 } } }} className="max-w-[640px] flex-1">
                            <motion.p variants={RISE} className="text-[13px] font-bold uppercase tracking-[0.25em] text-white/60">
                              Top film this week · {featured.genre}{featured.year ? ` · ${featured.year}` : ''}
                            </motion.p>
                            <h1 className="mt-3 flex flex-wrap text-[58px] font-bold leading-[1.02] tracking-tight">
                              {featured.title.split(' ').map((w, i) => (
                                <span key={i} className="mr-[0.26em] inline-block overflow-hidden py-[0.06em]">
                                  <motion.span className="inline-block" variants={{ hidden: { y: '115%' }, show: { y: 0, transition: { duration: 0.65, ease: EASE } } }}>
                                    {w}
                                  </motion.span>
                                </span>
                              ))}
                            </h1>
                            <motion.p variants={RISE} className="mt-4 line-clamp-3 text-[16px] leading-relaxed text-white/75">
                              {featured.summary}
                            </motion.p>
                            <motion.div variants={RISE} className="mt-7 flex gap-3">
                              <motion.button type="button" whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.95 }} onClick={() => watch(featured)} className="flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[15px] font-bold text-black shadow-[0_10px_30px_rgb(255_255_255/0.18)]">
                                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                  <path d="M8 5.5v13l10.5-6.5Z" />
                                </svg>
                                Find on {chosen.name}
                              </motion.button>
                              <motion.button type="button" whileHover={{ scale: 1.05, backgroundColor: 'rgb(255 255 255 / 0.24)' }} whileTap={{ scale: 0.95 }} onClick={() => setHero((h) => (h + 1) % Math.min(posters.length, 8))} className="h-12 rounded-full bg-white/[0.14] px-6 text-[15px] font-semibold backdrop-blur">
                                Next
                              </motion.button>
                            </motion.div>
                          </motion.div>
                        </AnimatePresence>
                        <TiltPoster key={`p-${featured.image}`} src={featured.imageHi ?? featured.image} />
                      </div>
                    ) : (
                      <div className="relative flex h-full items-end px-16 pb-14">
                        <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }} className="text-[58px] font-bold tracking-tight">
                          Udaan <span className="font-light text-white/60">TV</span>
                        </motion.h1>
                      </div>
                    )}
                    <div className="absolute bottom-5 right-16 flex gap-1.5">
                      {posters.slice(0, 8).map((_, i) => (
                        <button key={i} type="button" aria-label={`Feature ${i + 1}`} onClick={() => setHero(i)} className={`h-1.5 rounded-full transition-all duration-300 ${i === hero ? 'w-6 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60'}`} />
                      ))}
                    </div>
                  </section>

                  {/* Apps */}
                  <section className="relative px-16 pt-4">
                    <div className="flex items-baseline justify-between">
                      <motion.h2 initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15, duration: 0.5, ease: EASE }} className="text-[20px] font-semibold">
                        Your apps
                      </motion.h2>
                      <button type="button" onClick={() => setPage('store')} className="text-[14px] font-medium text-white/60 transition-colors hover:text-white">
                        App Store ›
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-5">
                      {apps.map((s, i) => (
                        <motion.button
                          key={s.id}
                          type="button"
                          initial={{ opacity: 0, y: 26, scale: 0.94 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={{ delay: 0.2 + i * 0.06, duration: 0.55, ease: EASE }}
                          whileHover={{ y: -8, scale: 1.05 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => void open(s)}
                          className="group relative flex h-[132px] w-[236px] flex-col justify-between overflow-hidden rounded-[18px] p-4 text-left shadow-[0_14px_40px_rgb(0_0_0/0.5)]"
                          style={{ background: `linear-gradient(145deg, ${s.color}, #0b0b0e 140%)` }}
                        >
                          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[18px] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ boxShadow: `inset 0 0 0 1px rgb(255 255 255 / 0.28), 0 0 60px ${s.color}66` }} />
                          <span aria-hidden className="pointer-events-none absolute -inset-y-4 -left-24 w-20 -skew-x-[20deg] bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[430px]" />
                          <img src={logo(s.domain)} alt="" className="relative h-11 w-11 rounded-[10px] bg-white/95 p-1.5 object-contain" draggable={false} />
                          <span className="relative">
                            <span className="block text-[17px] font-bold">{s.name}</span>
                            {running.includes(s.id) ? (
                              <span className="flex items-center gap-1.5 truncate text-[12px] text-white/75">
                                <span className="relative flex h-2 w-2 shrink-0">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#30d158] opacity-70" />
                                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#30d158]" />
                                </span>
                                Open — resumes where you left off
                              </span>
                            ) : (
                              <span className="block truncate text-[12px] text-white/70">{s.blurb}</span>
                            )}
                          </span>
                          {loading === s.id && (
                            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 flex items-center justify-center gap-2 bg-black/55 text-[14px] font-semibold">
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              Opening…
                            </motion.span>
                          )}
                        </motion.button>
                      ))}
                      <motion.button
                        type="button"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2 + apps.length * 0.06, duration: 0.5, ease: EASE }}
                        whileHover={{ y: -6, scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => setPage('store')}
                        className="flex h-[132px] w-[140px] flex-col items-center justify-center gap-1 rounded-[18px] border-2 border-dashed border-white/15 text-white/55 transition-colors hover:border-white/40 hover:text-white"
                      >
                        <span className="text-[30px] leading-none">+</span>
                        <span className="text-[13px]">Add apps</span>
                      </motion.button>
                    </div>
                  </section>

                  {/* Search across your apps */}
                  <section className="relative px-16 pt-8">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (query.trim()) searchOn(chosen, query.trim())
                      }}
                      className="flex flex-wrap items-center gap-3"
                    >
                      <label className="flex h-12 min-w-[320px] flex-1 items-center gap-3 rounded-full bg-white/[0.09] px-5 backdrop-blur focus-within:bg-white/[0.15]">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-white/55">
                          <circle cx="11" cy="11" r="7" />
                          <path d="m20 20-3.5-3.5" />
                        </svg>
                        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${chosen.name} for a show, film or song`} className="h-full flex-1 bg-transparent text-[15px] outline-none placeholder:text-white/40" />
                      </label>
                      <div className="flex items-center gap-1.5" role="group" aria-label="Search in">
                        <span className="mr-1 text-[12px] text-white/45">Search in</span>
                        {searchable.map((svc) => (
                          <button key={svc.id} type="button" title={svc.name} aria-pressed={chosen.id === svc.id} onClick={() => setProvider(svc.id)} className={`flex h-9 items-center gap-2 rounded-full pl-1.5 pr-3 text-[12.5px] font-medium transition-colors ${chosen.id === svc.id ? 'bg-white text-black' : 'bg-white/[0.09] text-white/75 hover:bg-white/[0.16]'}`}>
                            <Logo s={svc} size={22} />
                            {svc.name}
                          </button>
                        ))}
                      </div>
                    </form>
                    {recentApps.length > 0 && (
                      <div className="mt-4 flex items-center gap-2 text-[12.5px] text-white/50">
                        <span>Recently</span>
                        {recentApps.map((svc) => (
                          <button key={svc.id} type="button" onClick={() => void open(svc)} className="flex h-8 items-center gap-2 rounded-full bg-white/[0.07] pl-1 pr-3 text-white/80 hover:bg-white/[0.14]">
                            <Logo s={svc} size={22} />
                            {svc.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Posters */}
                  {posters.length > 0 && (
                    <section className="relative px-16 pb-6 pt-8">
                      <div className="flex flex-wrap items-center gap-3">
                        <motion.h2 initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.5, ease: EASE }} className="mr-2 text-[20px] font-semibold">
                          Top films this week
                        </motion.h2>
                        {genres.map((g) => (
                          <button key={g} type="button" aria-pressed={genre === g} onClick={() => setGenre(g)} className={`h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors ${genre === g ? 'bg-white text-black' : 'bg-white/[0.09] text-white/70 hover:bg-white/[0.16]'}`}>
                            {g}
                          </button>
                        ))}
                      </div>
                      <PosterRail items={films} onPick={watch} />
                    </section>
                  )}
                  {shows.length > 0 && (
                    <section className="relative px-16 pb-16 pt-6">
                      <h2 className="text-[20px] font-semibold">Top series right now</h2>
                      <PosterRail items={shows} onPick={watch} />
                    </section>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

const EASE = [0.16, 1, 0.3, 1] as const
const RISE = { hidden: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }

/** Slow, drifting colour behind the home screen; transforms only, so it costs almost nothing. */
function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div className="absolute -left-48 -top-48 h-[640px] w-[640px] rounded-full" style={{ background: 'radial-gradient(circle, rgb(80 110 255 / 0.22), transparent 65%)' }} animate={{ x: [0, 90, 0], y: [0, 70, 0] }} transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute -right-56 top-32 h-[700px] w-[700px] rounded-full" style={{ background: 'radial-gradient(circle, rgb(190 90 242 / 0.18), transparent 65%)' }} animate={{ x: [0, -100, 0], y: [0, -60, 0] }} transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute -bottom-64 left-1/3 h-[620px] w-[620px] rounded-full" style={{ background: 'radial-gradient(circle, rgb(40 200 190 / 0.12), transparent 65%)' }} animate={{ x: [0, 70, 0], y: [0, -50, 0] }} transition={{ duration: 27, repeat: Infinity, ease: 'easeInOut' }} />
    </div>
  )
}

/** The featured poster, tilting toward the pointer. */
function TiltPoster({ src }: { src: string }) {
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const sx = useSpring(rx, { stiffness: 220, damping: 22 })
  const sy = useSpring(ry, { stiffness: 220, damping: 22 })
  return (
    <motion.div
      initial={{ opacity: 0, x: 40, rotateY: -22 }}
      animate={{ opacity: 1, x: 0, rotateY: 0 }}
      transition={{ duration: 0.9, ease: EASE }}
      className="hidden lg:block"
      style={{ perspective: 1000 }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        ry.set(((e.clientX - r.left) / r.width - 0.5) * 18)
        rx.set(-((e.clientY - r.top) / r.height - 0.5) * 18)
      }}
      onMouseLeave={() => {
        rx.set(0)
        ry.set(0)
      }}
    >
      <motion.img src={src} alt="" draggable={false} style={{ rotateX: sx, rotateY: sy }} className="h-[340px] rounded-[16px] shadow-[0_30px_80px_rgb(0_0_0/0.7)]" />
    </motion.div>
  )
}

function Equalizer({ on }: { on: boolean }) {
  return (
    <span className="flex h-4 w-4 items-end justify-between" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-full w-[3px] origin-bottom rounded-full bg-[var(--color-accent)]"
          initial={false}
          animate={on ? { scaleY: [0.3, 1, 0.45, 0.85, 0.3] } : { scaleY: 0.3 }}
          transition={on ? { duration: 0.9 + i * 0.17, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.25 }}
        />
      ))}
    </span>
  )
}

function MediaButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <motion.button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.86 }} className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 hover:bg-white/[0.12] hover:text-white disabled:opacity-30">
      {children}
    </motion.button>
  )
}

/** A small media centre: what is playing, transport controls and volume, always at hand. */
function MediaCentre({ np, volume, muted, onVolume, onMute }: { np: NowPlaying | null; volume: number | null; muted: boolean; onVolume: (v: number) => void; onMute: () => void }) {
  const playing = !!np?.playing
  return (
    <div className="mr-1 flex items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pl-2.5 pr-1 ring-1 ring-white/[0.07]">
      <Equalizer on={playing} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={np?.title ?? 'idle'} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.18 }} className="mx-1 hidden min-w-0 max-w-[170px] leading-tight md:block">
          <p className="truncate text-[11.5px] font-semibold text-white/90">{np?.title || 'Nothing playing'}</p>
          {np?.artist && <p className="truncate text-[10px] text-white/45">{np.artist}</p>}
        </motion.div>
      </AnimatePresence>
      <MediaButton label="Previous" disabled={!np?.canPrevious} onClick={() => void mediaCommand('previous')}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
          <path d="M6 5h2v14H6zM20 5v14L9.5 12z" />
        </svg>
      </MediaButton>
      <MediaButton label={playing ? 'Pause' : 'Play'} onClick={() => void mediaCommand('play-pause')}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.svg key={playing ? 'pause' : 'play'} viewBox="0 0 24 24" width="15" height="15" fill="currentColor" initial={{ scale: 0.5, rotate: -45, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.5, rotate: 45, opacity: 0 }} transition={{ duration: 0.14 }}>
            {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l10.5-6.5z" />}
          </motion.svg>
        </AnimatePresence>
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

function BarButton({ label, onClick, path }: { label: string; onClick: () => void; path: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-full text-white/65 transition-colors hover:bg-white/[0.1] hover:text-white active:scale-95">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </button>
  )
}

function Store({ installed, onToggle, onBack }: { installed: string[]; onToggle: (id: string) => void; onBack: () => void }) {
  const groups = ['Video', 'Live', 'Music'] as const
  return (
    <div className="h-full overflow-y-auto px-16 py-10">
      <button type="button" onClick={onBack} className="text-[14px] text-white/55 hover:text-white">
        ‹ Home
      </button>
      <h1 className="mt-2 text-[40px] font-bold tracking-tight">App Store</h1>
      <p className="text-[15px] text-white/55">Add streaming apps to your TV. They open and play right inside it.</p>
      {groups.map((g) => (
        <section key={g} className="mt-8">
          <h2 className="text-[18px] font-semibold">{g === 'Live' ? 'Live TV & streams' : g}</h2>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3">
            {CATALOG.filter((s) => s.category === g).map((s) => {
              const has = installed.includes(s.id)
              return (
                <div key={s.id} className="flex items-center gap-4 rounded-[16px] bg-white/[0.05] p-4">
                  <Logo s={s} size={56} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-semibold">{s.name}</p>
                    <p className="truncate text-[12.5px] text-white/50">{s.blurb}</p>
                  </div>
                  {s.store && (
                    <button type="button" title="Install the official Windows app from the Microsoft Store" onClick={() => void launchApp(`ms-windows-store://pdp/?ProductId=${s.store}`)} className="h-9 rounded-full px-3 text-[12.5px] font-medium text-white/60 hover:bg-white/[0.08] hover:text-white">
                      Official app
                    </button>
                  )}
                  <button type="button" onClick={() => onToggle(s.id)} className={`h-9 rounded-full px-4 text-[13px] font-bold ${has ? 'bg-white/[0.1] text-white/70' : 'bg-white text-black'}`}>
                    {has ? 'Remove' : 'Get'}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}


/** A row of posters: sharp artwork, year and genre, and the plot on hover. */
function PosterRail({ items, onPick }: { items: Poster[]; onPick: (p: Poster) => void }) {
  return (
    <div className="-mx-2 mt-4 flex gap-4 overflow-x-auto px-2 pb-6 pt-2 [scrollbar-width:none]">
      {items.map((p, i) => (
        <motion.button
          key={p.title}
          type="button"
          initial={{ opacity: 0, y: 34 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 + Math.min(i, 10) * 0.04, duration: 0.5, ease: EASE }}
          whileHover={{ y: -10, scale: 1.05 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onPick(p)}
          title={p.summary}
          className="group w-[176px] shrink-0 text-left"
        >
          <span className="relative block overflow-hidden rounded-[12px] shadow-[0_12px_30px_rgb(0_0_0/0.5)] transition-shadow duration-300 group-hover:shadow-[0_24px_50px_rgb(0_0_0/0.75)]">
            <img src={p.image} alt="" loading="lazy" className="aspect-[2/3] w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 flex translate-y-2 flex-col justify-end bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 pt-10 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
              <span className="line-clamp-4 text-[11.5px] leading-snug text-white/85">{p.summary}</span>
            </span>
          </span>
          <p className="mt-2 truncate text-[13px] font-medium">{p.title}</p>
          <p className="truncate text-[11.5px] text-white/45">{[p.year, p.genre].filter(Boolean).join(' · ')}</p>
        </motion.button>
      ))}
    </div>
  )
}
