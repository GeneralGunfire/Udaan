import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/shared/lib/cn'
import { activeLine, parseLyrics } from '../lib/lrc'

interface Found {
  text: string
  source: 'saved' | 'file'
  name: string
}

/**
 * Lyrics for the song that is playing. With a timed (.lrc) file the current line is highlighted and kept in view,
 * and a line can be clicked to jump there. Lyrics are read from a file beside the song, or pasted in here and kept
 * in Udaan's own data; your music folder is never written to.
 */
export function LyricsPanel({ path, currentTime, duration, onSeek }: { path: string | null; currentTime: number; duration: number; onSeek: (percent: number) => void }) {
  const [found, setFound] = useState<Found | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const lastActive = useRef(-2)

  useEffect(() => {
    setFound(undefined)
    setEditing(false)
    setError(null)
    lastActive.current = -2
    if (!path) return setFound(null)
    let live = true
    void invoke<Found | null>('music_lyrics_get', { path }).then(
      (f) => live && setFound(f),
      () => live && setFound(null),
    )
    return () => {
      live = false
    }
  }, [path])

  const parsed = useMemo(() => (found ? parseLyrics(found.text) : null), [found])
  const active = parsed?.synced ? activeLine(parsed.lines, currentTime) : -1

  // Follow the song, but only when the line actually changes: one small scroll, not a running animation.
  useEffect(() => {
    if (!parsed?.synced || active === lastActive.current) return
    lastActive.current = active
    box.current?.querySelector<HTMLElement>(`[data-line="${active}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active, parsed])

  const save = async (text: string) => {
    if (!path) return
    try {
      await invoke('music_lyrics_save', { path, text })
      setError(null)
      setEditing(false)
      const f = await invoke<Found | null>('music_lyrics_get', { path })
      setFound(f)
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Couldn’t save the lyrics.')
    }
  }

  if (!path) return <p className="text-text-tertiary m-auto text-sm">Play a song to see its lyrics.</p>

  if (editing)
    return (
      <div className="mx-auto flex h-full w-full max-w-xl flex-col gap-3 py-2">
        <p className="text-text-secondary text-xs leading-relaxed">Paste the lyrics. Lines that start with a time like [01:23.45] will follow the song. They are saved in Udaan, not in your music folder.</p>
        <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="u-field min-h-0 flex-1 resize-none py-2.5 font-mono text-[13px] leading-relaxed" placeholder="Paste lyrics here" spellCheck={false} />
        {error && <p className="text-danger text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          {found?.source === 'saved' && (
            <button type="button" onClick={() => void save('')} className="text-text-secondary hover:text-danger mr-auto rounded-lg px-3 py-1.5 text-xs">
              Remove my lyrics
            </button>
          )}
          <button type="button" onClick={() => setEditing(false)} className="text-text-secondary hover:bg-(--os-hover) rounded-lg px-3 py-1.5 text-xs">
            Cancel
          </button>
          <button type="button" disabled={!draft.trim()} onClick={() => void save(draft)} className="bg-accent text-accent-contrast rounded-lg px-4 py-1.5 text-xs font-medium disabled:opacity-40">
            Save
          </button>
        </div>
      </div>
    )

  if (found === undefined) return <p className="text-text-tertiary m-auto text-sm">Looking for lyrics…</p>

  if (!found || !parsed)
    return (
      <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-text-secondary text-sm font-medium">No lyrics for this song yet</p>
        <p className="text-text-tertiary text-xs leading-relaxed">Put a .lrc or .txt file with the same name next to the song, or paste the lyrics in.</p>
        <button type="button" onClick={() => (setDraft(''), setEditing(true))} className="bg-accent text-accent-contrast rounded-lg px-4 py-1.5 text-xs font-medium">
          Add lyrics
        </button>
      </div>
    )

  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col">
      <div ref={box} className="u-scroll min-h-0 flex-1 overflow-y-auto px-2 py-[30%] text-center">
        {parsed.lines.map((l, i) => {
          const sung = parsed.synced && i === active
          const clickable = parsed.synced && l.t !== null && duration > 0
          return (
            <p
              key={i}
              data-line={i}
              onClick={clickable ? () => onSeek((l.t! / duration) * 100) : undefined}
              className={cn('my-2 text-[19px] leading-snug transition-colors duration-200', !l.text && 'h-4', sung ? 'text-text-primary font-semibold' : 'text-text-tertiary', clickable && 'hover:text-text-secondary cursor-pointer')}
            >
              {l.text || ' '}
            </p>
          )
        })}
      </div>
      <div className="text-text-tertiary flex shrink-0 items-center justify-between gap-3 px-2 pb-1 pt-2 text-[11px]">
        <span>
          {parsed.synced ? 'Follows the song. Click a line to jump.' : 'Plain lyrics'} · {found.source === 'saved' ? 'yours' : found.name}
        </span>
        <button type="button" onClick={() => (setDraft(found.text), setEditing(true))} className="hover:text-text-primary rounded px-2 py-0.5">
          Edit
        </button>
      </div>
    </div>
  )
}
