import { useMemo, useState } from 'react'
import { APP_DEFS, type AppId } from '@/os/kernel/registry'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { Segmented } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { PopIcon } from './icons'
import { usePopMenu, type MenuEntry } from './Menu'
import { SAMPLE_EVENTS, SAMPLE_RECENTS } from './samples'
import { Surface } from './Surface'

/**
 * START, rebuilt. One glass card in three bands:
 *   top     a search pill (apps, files, settings, the web)
 *   middle  Pinned and Recommended on the left; a "Today" rail on the right (time, what is next, what is playing)
 *   bottom  who you are, the Personal / Work switch, lock, settings and power
 * It takes the same liquid-glass customisation as the dock and top bar (the "Start menu" group in Settings).
 */

const PINNED: AppId[] = ['file-explorer', 'chat', 'calendar', 'notes', 'private-player', 'news-brief', 'omni-find', 'studio', 'tv', 'clipboard', 'photos', 'settings']
const OTHER_APPS = ['Google Chrome', 'Visual Studio Code', 'Microsoft Excel', 'Microsoft Word', 'Calculator', 'Command Prompt', 'Notepad', 'Paint', 'Task Manager', 'pgAdmin 4']

type Entry = { name: string; appId?: AppId }

function allApps(): Entry[] {
  const udaan = (Object.keys(APP_DEFS) as AppId[]).map((id) => ({ name: APP_DEFS[id].name, appId: id }))
  return [...udaan, ...OTHER_APPS.map((name) => ({ name }))].sort((a, b) => a.name.localeCompare(b.name))
}

function Tile({ id, onMenu }: { id: AppId; onMenu: (e: React.MouseEvent, name: string) => void }) {
  return (
    <button type="button" className="group flex w-full flex-col items-center gap-1.5 rounded-[16px] px-1 py-2.5 transition-colors hover:bg-white/[0.09] active:bg-white/[0.14]" onContextMenu={(e) => onMenu(e, APP_DEFS[id].name)}>
      <span className="transition-transform duration-150 group-hover:scale-[1.07] group-active:scale-95"><AppIcon appId={id} size={50} /></span>
      <span className="w-full truncate text-center text-[12px]">{APP_DEFS[id].name}</span>
    </button>
  )
}

function Row({ e, sub, onMenu }: { e: Entry; sub?: string; onMenu: (ev: React.MouseEvent, name: string) => void }) {
  return (
    <button type="button" className="pop-row w-full" onContextMenu={(ev) => onMenu(ev, e.name)}>
      {e.appId ? <AppIcon appId={e.appId} size={30} /> : <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-white/[0.12] text-[13px] font-semibold">{e.name.charAt(0)}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px]">{e.name}</span>
        {sub && <span className="block truncate text-[11.5px] text-(--u-ink-3)">{sub}</span>}
      </span>
    </button>
  )
}

export function StartMenu({ profile: initial = 'personal' }: { profile?: 'personal' | 'work' }) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'home' | 'all'>('home')
  const [profile, setProfile] = useState<'personal' | 'work'>(initial)
  const { open, node } = usePopMenu()
  const apps = useMemo(allApps, [])
  const q = query.trim().toLowerCase()
  const hits = q ? apps.filter((a) => a.name.toLowerCase().includes(q)) : []
  const fileHits = q ? SAMPLE_RECENTS.filter((r) => r.name.toLowerCase().includes(q)) : []
  const now = new Date()
  const next = SAMPLE_EVENTS.filter((e) => !e.done).slice(0, 2)

  const appMenu = (e: React.MouseEvent, name: string) =>
    open(e, [
      { label: `Open ${name}`, icon: 'external' },
      { label: 'New window', icon: 'window' },
      { type: 'sep' },
      { label: 'Pin to dock', icon: 'pin' },
      { label: 'Unpin from Start', icon: 'x' },
      { type: 'sep' },
      { label: 'Run as administrator', icon: 'shield' },
      { label: 'Open file location', icon: 'folder' },
    ] satisfies MenuEntry[])

  const power = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    open({ clientX: r.left, clientY: r.top - 190 }, [
      { label: 'Sleep', icon: 'moon' },
      { label: 'Restart…', icon: 'refresh' },
      { label: 'Shut down…', icon: 'power', danger: true },
      { type: 'sep' },
      { label: 'Sign out', icon: 'user' },
    ])
  }

  // Letters for the All apps list.
  const letters = [...new Set(apps.map((a) => a.name.charAt(0).toUpperCase()))]

  return (
    <Surface glass="start" radius={30} className="pop-in flex flex-col" style={{ width: 820, height: 620 }}>
      {/* search */}
      <div className="px-6 pt-5">
        <label className="flex h-11 items-center gap-3 rounded-full bg-black/25 px-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/.1)] focus-within:shadow-[inset_0_0_0_1.5px_var(--u-accent,#3072f0)]">
          <PopIcon name="search" size={17} className="opacity-60" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps, files, settings and the web" spellCheck={false} className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-(--u-ink-3)" />
          {query ? (
            <button type="button" aria-label="Clear" className="pop-iconbtn h-6 w-6" onClick={() => setQuery('')}><PopIcon name="x" size={13} strokeWidth={2.2} /></button>
          ) : (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-(--u-ink-3)">Ctrl Space</span>
          )}
        </label>
      </div>

      <div className="flex min-h-0 flex-1 gap-5 px-6 pb-3 pt-4">
        {/* left: results / pinned / all apps */}
        <div className="pop-scroll flex min-w-0 flex-1 flex-col overflow-y-auto pr-1">
          {q ? (
            <div className="flex flex-col gap-1">
              {hits.length > 0 && <p className="pop-label px-2.5 pb-1">Apps</p>}
              {hits.slice(0, 6).map((a) => <Row key={a.name} e={a} sub="App" onMenu={appMenu} />)}
              {fileHits.length > 0 && <p className="pop-label px-2.5 pb-1 pt-3">Files</p>}
              {fileHits.map((r) => <Row key={r.name} e={{ name: r.name }} sub={`${r.where} · ${r.when}`} onMenu={appMenu} />)}
              <p className="pop-label px-2.5 pb-1 pt-3">Web</p>
              <button type="button" className="pop-row w-full"><span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-white/[0.12]"><PopIcon name="search" size={16} /></span><span className="text-[13.5px]">Search the web for “{query}”</span></button>
            </div>
          ) : view === 'home' ? (
            <>
              <div className="flex items-center justify-between px-1 pb-1">
                <p className="text-[14px] font-semibold">Pinned</p>
                <button type="button" className="pop-btn" onClick={() => setView('all')}>All apps <PopIcon name="chevron" size={12} /></button>
              </div>
              <div className="grid grid-cols-6 gap-x-1 gap-y-0.5">
                {PINNED.map((id) => <Tile key={id} id={id} onMenu={appMenu} />)}
              </div>
              <p className="px-1 pb-1 pt-4 text-[14px] font-semibold">Recommended</p>
              <div className="grid grid-cols-2 gap-x-2">
                {SAMPLE_RECENTS.map((r) => (
                  <button key={r.name} type="button" className="pop-row" onContextMenu={(e) => appMenu(e, r.name)}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.1]"><PopIcon name={r.icon} size={18} /></span>
                    <span className="min-w-0"><span className="block truncate text-[13px] leading-tight">{r.name}</span><span className="block truncate text-[11.5px] text-(--u-ink-3)">{r.when}</span></span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 px-1 pb-2">
                <button type="button" className="pop-btn" onClick={() => setView('home')}><PopIcon name="chevron" size={12} style={{ transform: 'scaleX(-1)' }} /> Back</button>
                <p className="text-[14px] font-semibold">All apps</p>
                <div className="ml-auto flex gap-0.5">{letters.slice(0, 12).map((l) => <span key={l} className="w-4 text-center text-[10.5px] font-semibold text-(--u-ink-3)">{l}</span>)}</div>
              </div>
              {letters.map((l) => (
                <div key={l}>
                  <p className="px-2.5 pb-0.5 pt-2 text-[12px] font-semibold text-(--u-ink-3)">{l}</p>
                  {apps.filter((a) => a.name.charAt(0).toUpperCase() === l).map((a) => <Row key={a.name} e={a} onMenu={appMenu} />)}
                </div>
              ))}
            </>
          )}
        </div>

        {/* right: Today rail */}
        <aside className="flex w-[232px] shrink-0 flex-col gap-2.5">
          <div className="rounded-[20px] bg-white/[0.08] px-4 py-3.5">
            <p className="pop-label">{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <p className="mt-0.5 text-[46px] font-extralight leading-none tracking-tight tabular-nums">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: false })}</p>
          </div>
          <div className="rounded-[20px] bg-white/[0.08] p-2">
            <p className="pop-label px-2 pb-1 pt-1.5">Up next</p>
            {next.map((e) => (
              <div key={e.time} className="flex items-center gap-2.5 rounded-[12px] px-2 py-1.5">
                <span aria-hidden className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: e.tint }} />
                <div className="min-w-0"><p className="truncate text-[13px] font-medium leading-tight">{e.title}</p><p className="text-[11.5px] tabular-nums text-(--u-ink-3)">{e.time}{e.place ? ` · ${e.place}` : ''}</p></div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 rounded-[20px] bg-white/[0.08] p-3">
            <span className="h-11 w-11 shrink-0 rounded-[12px]" style={{ background: 'linear-gradient(145deg,#ff6a88,#8a3ffc 65%,#2b1b6b)' }} />
            <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold leading-tight">Late Night Drive</p><p className="truncate text-[11.5px] text-(--u-ink-3)">Neon Harbour</p></div>
            <button type="button" aria-label="Pause" className="pop-iconbtn h-8 w-8 bg-white/[0.12]"><PopIcon name="pause" size={15} /></button>
          </div>
        </aside>
      </div>

      {/* footer */}
      <div className="flex items-center gap-3 border-t border-white/[0.08] px-5 py-3">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-semibold', profile === 'work' ? 'bg-[#2f6bff] text-white' : 'bg-white/[0.16]')}>{profile === 'work' ? 'W' : 'U'}</span>
        <div className="leading-tight"><p className="text-[13.5px] font-semibold">Udaan</p><p className="text-[11.5px] text-(--u-ink-3)">{profile === 'work' ? 'Work profile' : 'Personal profile'}</p></div>
        <div className="ml-4 w-[190px]">
          <Segmented value={profile} options={[{ value: 'personal', label: 'Personal' }, { value: 'work', label: 'Work' }]} onChange={(v) => setProfile(v as 'personal' | 'work')} />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Lock" className="pop-iconbtn h-9 w-9"><PopIcon name="lock" size={18} /></button>
          <button type="button" aria-label="Settings" className="pop-iconbtn h-9 w-9"><PopIcon name="sliders" size={18} /></button>
          <button type="button" aria-label="Power" className="pop-iconbtn h-9 w-9" onClick={power}><PopIcon name="power" size={18} /></button>
        </div>
      </div>
      {node}
    </Surface>
  )
}
