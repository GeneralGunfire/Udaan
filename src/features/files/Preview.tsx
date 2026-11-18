import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getHandlersForExtension, openFileWith } from '@/integrations/installed-apps/client'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { convertFileSrc, fs } from './api'
import { baseName, bytes, fullDate, isPreviewableText, kindOf, KIND_LABEL, noteRecent, parentOf, setTag, tags, tagsOf, typeLabel, useStore, type Item, type Loc } from './model'
import * as ops from './ops'
import { FileIcon, G, Glyph, TagDot, Thumb } from './ui'

/* ── text for previews (plain files or entries inside a zip) ─────── */

function useText(it: Item | null, max = 200_000) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    setText(null)
    if (!it || it.isDir || !isPreviewableText(it.ext)) return
    let live = true
    const p =
      it.inner !== undefined
        ? fs.zipRead(it.path.split('|')[0], it.inner, max).then((b) => new TextDecoder().decode(b))
        : fs.text(it.path)
    void p.then((t) => live && setText(t), () => live && setText(null))
    return () => {
      live = false
    }
  }, [it, max])
  return text
}

/** An object URL for an image inside a zip, freed when it changes. */
function useZipImage(it: Item | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!it || it.inner === undefined || kindOf(it.ext, it.isDir) !== 'image') return
    let u: string | null = null
    let live = true
    void fs.zipRead(it.path.split('|')[0], it.inner, 40_000_000).then((b) => {
      if (!live) return
      u = URL.createObjectURL(new Blob([b as BlobPart], { type: it.ext === 'svg' ? 'image/svg+xml' : `image/${it.ext === 'jpg' ? 'jpeg' : it.ext}` }))
      setUrl(u)
    }, () => {})
    return () => {
      live = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [it])
  return url
}

/* ── INSPECTOR ───────────────────────────────────────────────────── */

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col gap-1.5 text-[12px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt className="shrink-0 text-(--u-ink-3)">{k}</dt>
          <dd className="min-w-0 break-words text-right text-(--u-ink-2)">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function FolderSize({ path }: { path: string }) {
  const [s, setS] = useState<{ bytes: number; files: number; capped: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setS(null), [path])
  if (s) return <>{`${bytes(s.bytes)}${s.capped ? '+' : ''} · ${s.files.toLocaleString()} files`}</>
  return (
    <button type="button" className="text-(--u-accent) hover:underline" disabled={busy} onClick={() => (setBusy(true), void fs.dirSize(path).then(setS, ops.fail).finally(() => setBusy(false)))}>
      {busy ? 'Counting…' : 'Calculate'}
    </button>
  )
}

function TagEditor({ items }: { items: Item[] }) {
  const st = useStore(tags)
  return (
    <div className="flex flex-wrap gap-1.5">
      {st.defs.map((t) => {
        const on = items.every((i) => tagsOf(st, i.path).includes(t.name))
        return (
          <button
            key={t.name}
            type="button"
            onClick={() => items.forEach((i) => setTag(i.path, t.name, !on))}
            className={cn('flex h-[24px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px]', on ? 'bg-(--u-wash-on) text-(--u-ink)' : 'text-(--u-ink-3) shadow-[inset_0_0_0_1px_var(--u-edge)] hover:text-(--u-ink-2)')}
          >
            <TagDot color={t.color} size={7} />
            {t.name}
          </button>
        )
      })}
    </div>
  )
}

export function Inspector({ selected, all, loc, onGo }: { selected: Item[]; all: Item[]; loc: Loc; onGo: (l: Loc) => void }) {
  const one = selected.length === 1 ? selected[0] : null
  const text = useText(one, 6000)
  const zipImg = useZipImage(one)
  const [handlers, setHandlers] = useState<{ name: string; exePath: string; isDefault: boolean }[]>([])
  useEffect(() => {
    setHandlers([])
    if (one && !one.isDir && one.inner === undefined && one.ext) void getHandlersForExtension(one.ext).then(setHandlers, () => {})
  }, [one])

  const group = selected.length ? selected : all
  const summary = useMemo(() => {
    const files = group.filter((i) => !i.isDir)
    const counts = new Map<string, number>()
    for (const f of files) counts.set(KIND_LABEL[kindOf(f.ext, false)], (counts.get(KIND_LABEL[kindOf(f.ext, false)]) ?? 0) + 1)
    return { folders: group.length - files.length, files: files.length, size: files.reduce((a, f) => a + f.size, 0), kinds: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5) }
  }, [group])

  if (!one) {
    const title = selected.length ? `${selected.length} items selected` : loc.kind === 'dir' ? baseName(loc.path) : 'Nothing selected'
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 pt-3 text-center">
          <div className="relative h-[84px] w-[84px]">
            {selected.length > 1 ? (
              selected.slice(0, 3).map((s, i) => (
                <span key={s.path} className="absolute inset-0 flex items-center justify-center" style={{ transform: `translate(${(i - 1) * 9}px, ${(i - 1) * -5}px) rotate(${(i - 1) * 6}deg)` }}>
                  <FileIcon ext={s.ext} isDir={s.isDir} size={66} />
                </span>
              ))
            ) : (
              <span className="flex h-full items-center justify-center">
                <FileIcon ext="" isDir size={72} />
              </span>
            )}
          </div>
          <p className="max-w-full truncate text-[14px] font-semibold">{title}</p>
        </div>
        <Facts
          rows={[
            ['Folders', summary.folders.toLocaleString()],
            ['Files', summary.files.toLocaleString()],
            ['Size of files', bytes(summary.size)],
            ...summary.kinds.map(([k, n]) => [k, n.toLocaleString()] as [string, ReactNode]),
          ]}
        />
        {selected.length > 1 && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-(--u-ink-3)">Tags</p>
            <TagEditor items={selected.filter((s) => s.inner === undefined)} />
          </div>
        )}
        {loc.kind === 'dir' && !selected.length && (
          <div className="flex flex-col gap-1.5">
            <Button size="sm" variant="tinted" onClick={() => void fs.terminal(loc.path).catch(ops.fail)}>
              <Glyph d={G.terminal} size={14} /> Open terminal here
            </Button>
            <Button size="sm" variant="tinted" onClick={() => onGo({ kind: 'dupes', root: loc.path })}>
              <Glyph d={G.copies} size={14} /> Find duplicates here
            </Button>
          </div>
        )}
      </div>
    )
  }

  const kind = kindOf(one.ext, one.isDir)
  const inZip = one.inner !== undefined
  return (
    <div className="flex flex-col gap-5">
      <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[12px] bg-(--u-wash-hover)">
        {zipImg ? (
          <img src={zipImg} alt="" className="max-h-full max-w-full object-contain" />
        ) : text !== null ? (
          <pre className="h-full w-full overflow-hidden whitespace-pre-wrap break-all p-3 font-mono text-[10.5px] leading-[1.45] text-(--u-ink-2)">{text.slice(0, 1600)}</pre>
        ) : (
          <Thumb path={one.path} ext={one.ext} isDir={one.isDir} size={200} inner={inZip} />
        )}
      </div>
      <div>
        <p className="break-words text-[14px] font-semibold leading-snug">{one.name}</p>
        <p className="mt-0.5 text-[12px] text-(--u-ink-3)">{typeLabel(one)}</p>
      </div>
      <Facts
        rows={[
          ['Size', one.isDir ? inZip ? '—' : <FolderSize key="s" path={one.path} /> : bytes(one.size)],
          ...(one.modifiedMs ? ([['Modified', fullDate(one.modifiedMs)]] as [string, ReactNode][]) : []),
          ...(one.createdMs > 0 && !inZip ? ([['Created', fullDate(one.createdMs)]] as [string, ReactNode][]) : []),
          ['Where', <button key="w" type="button" className="text-right hover:text-(--u-accent) hover:underline" title={inZip ? one.path.split('|')[0] : parentOf(one.path) ?? ''} onClick={() => !inZip && onGo({ kind: 'dir', path: parentOf(one.path)! })}>{inZip ? `In ${baseName(one.path.split('|')[0])}` : baseName(parentOf(one.path) ?? one.path)}</button>],
          ...(kind !== 'folder' ? ([['Kind', KIND_LABEL[kind]]] as [string, ReactNode][]) : []),
        ]}
      />
      {!inZip && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-(--u-ink-3)">Tags</p>
          <TagEditor items={[one]} />
        </div>
      )}
      {!inZip && (
        <div className="flex flex-col gap-1.5">
          {!one.isDir && (
            <Button size="sm" variant="accent" onClick={() => (noteRecent(one.path), void fs.open(one.path).catch(ops.fail))}>
              Open
            </Button>
          )}
          {handlers
            .filter((h) => !h.isDefault)
            .slice(0, 3)
            .map((h) => (
              <Button key={h.exePath} size="sm" variant="tinted" onClick={() => void openFileWith(h.exePath, one.path).then(() => noteRecent(one.path), ops.fail)}>
                Open with {h.name}
              </Button>
            ))}
          <Button size="sm" variant="tinted" onClick={() => void ops.copyText(one.path, 'Path copied')}>
            Copy path
          </Button>
          <Button size="sm" variant="tinted" onClick={() => void fs.reveal(one.path).catch(ops.fail)}>
            Show in Windows Explorer
          </Button>
        </div>
      )}
    </div>
  )
}

/* ── QUICK LOOK ──────────────────────────────────────────────────── */

export function QuickLook({ items, index, onIndex, onClose }: { items: Item[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const it = items[index] ?? null
  const text = useText(it)
  const zipImg = useZipImage(it)
  const [zipCount, setZipCount] = useState<number | null>(null)
  const [dirCount, setDirCount] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.focus()
  }, [])
  useEffect(() => {
    setZipCount(null)
    setDirCount(null)
    if (!it || it.inner !== undefined) return
    if (it.ext === 'zip') void fs.zipList(it.path).then((l) => setZipCount(l.filter((e) => !e.isDir).length), () => {})
    if (it.isDir) void fs.list(it.path).then((l) => setDirCount(l.length), () => {})
  }, [it])
  if (!it) return null

  const kind = kindOf(it.ext, it.isDir)
  const inZip = it.inner !== undefined
  const src = inZip ? null : convertFileSrc(it.path)
  let body: ReactNode
  if (zipImg || (kind === 'image' && !inZip)) body = <img src={zipImg ?? src!} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
  else if (kind === 'video' && src) body = <video key={src} src={src} controls autoPlay className="max-h-full max-w-full rounded-[8px] bg-black" />
  else if (kind === 'audio' && src)
    body = (
      <div className="flex flex-col items-center gap-6">
        <FileIcon ext={it.ext} isDir={false} size={120} />
        <audio key={src} src={src} controls autoPlay className="w-[420px] max-w-full" />
      </div>
    )
  else if (kind === 'pdf' && src) body = <iframe key={src} src={src} title={it.name} className="h-full w-full rounded-[8px] bg-white" />
  else if (text !== null)
    body = (
      <pre className="u-scroll h-full w-full overflow-auto rounded-[10px] bg-(--u-wash-hover) p-5 font-mono text-[12.5px] leading-[1.55] text-(--u-ink)">
        {text.split('\n').slice(0, 5000).map((l, i) => (
          <div key={i} className="flex">
            <span className="mr-4 w-10 shrink-0 select-none text-right text-(--u-ink-3)">{i + 1}</span>
            <span className="whitespace-pre-wrap break-all">{l || ' '}</span>
          </div>
        ))}
      </pre>
    )
  else
    body = (
      <div className="flex flex-col items-center gap-4 text-center">
        <FileIcon ext={it.ext} isDir={it.isDir} size={128} />
        <p className="text-[13px] text-(--u-ink-3)">{it.isDir ? (dirCount === null ? 'Folder' : `${dirCount.toLocaleString()} items`) : zipCount !== null ? `Archive with ${zipCount.toLocaleString()} files` : `${typeLabel(it)} · ${bytes(it.size)}`}</p>
      </div>
    )

  return (
    <div
      ref={box}
      tabIndex={-1}
      className="absolute inset-0 z-50 flex flex-col bg-black/70 outline-none"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || e.key === ' ') (e.preventDefault(), onClose())
        else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && index < items.length - 1) (e.preventDefault(), onIndex(index + 1))
        else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && index > 0) (e.preventDefault(), onIndex(index - 1))
        else if (e.key === 'Enter' && !inZip) (e.preventDefault(), noteRecent(it.path), void fs.open(it.path).catch(ops.fail), onClose())
      }}
    >
      <div className="m-auto flex h-[calc(100%-48px)] w-[calc(100%-64px)] max-w-[1400px] flex-col overflow-hidden rounded-[14px] bg-(--u-m-solid) shadow-[inset_0_0_0_1px_var(--u-edge)]">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-(--u-edge) px-4">
          <FileIcon ext={it.ext} isDir={it.isDir} size={20} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{it.name}</p>
          </div>
          <span className="text-[12px] tabular-nums text-(--u-ink-3)">
            {index + 1} of {items.length}
          </span>
          <Button size="sm" icon aria-label="Previous" disabled={index === 0} onClick={() => onIndex(index - 1)}>
            <Glyph d={G.back} />
          </Button>
          <Button size="sm" icon aria-label="Next" disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)}>
            <Glyph d={G.fwd} />
          </Button>
          {!inZip && !it.isDir && (
            <Button size="sm" variant="accent" onClick={() => (noteRecent(it.path), void fs.open(it.path).catch(ops.fail), onClose())}>
              Open
            </Button>
          )}
          <Button size="sm" icon aria-label="Close" onClick={onClose}>
            <Glyph d={G.close} />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center p-5">{body}</div>
        <footer className="flex h-9 shrink-0 items-center gap-4 border-t border-(--u-edge) px-4 text-[11.5px] text-(--u-ink-3)">
          <span>{typeLabel(it)}</span>
          {!it.isDir && <span>{bytes(it.size)}</span>}
          {it.modifiedMs > 0 && <span>Modified {fullDate(it.modifiedMs)}</span>}
          <span className="ml-auto">← → to move · Space to close · Enter to open</span>
        </footer>
      </div>
    </div>
  )
}
