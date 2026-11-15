import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { FileExplorerView } from './FileExplorerView'

/**
 * FILES: tabs. Each tab is a complete explorer with its own folder, history, selection and clipboard; tabs
 * stay alive while hidden, so switching is instant and nothing is lost. Ctrl+T new tab, Ctrl+W close,
 * Ctrl+Tab next, middle-click a tab to close it.
 */
interface Tab {
  id: number
  path: string | undefined
  label: string
}

const labelOf = (p?: string) => (p ? p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p : 'Home')

export function FilesApp({ onClose, initialPath }: { onClose: () => void; initialPath?: string }) {
  const next = useRef(2)
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, path: initialPath, label: labelOf(initialPath) }])
  const [active, setActive] = useState(1)

  const add = useCallback((path?: string) => {
    const id = next.current++
    setTabs((t) => [...t, { id, path, label: labelOf(path) }])
    setActive(id)
  }, [])
  const close = useCallback(
    (id: number) => {
      setTabs((t) => {
        if (t.length === 1) {
          onClose()
          return t
        }
        const i = t.findIndex((x) => x.id === id)
        const rest = t.filter((x) => x.id !== id)
        setActive((a) => (a === id ? (rest[Math.max(0, i - 1)] ?? rest[0]).id : a))
        return rest
      })
    },
    [onClose],
  )
  const setLabel = useCallback((id: number, path: string) => setTabs((t) => t.map((x) => (x.id === id && x.label !== labelOf(path) ? { ...x, label: labelOf(path) } : x))), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.key === 't') (e.preventDefault(), add())
      else if (e.key === 'w') (e.preventDefault(), close(active))
      else if (e.key === 'Tab') {
        e.preventDefault()
        setTabs((t) => {
          const i = t.findIndex((x) => x.id === active)
          setActive(t[(i + (e.shiftKey ? t.length - 1 : 1)) % t.length].id)
          return t
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, add, close])

  // Another "open this folder" request lands in a new tab if the folder differs from every open one.
  const last = useRef(initialPath)
  useEffect(() => {
    if (!initialPath || initialPath === last.current) return
    last.current = initialPath
    add(initialPath)
  }, [initialPath, add])

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex h-10 shrink-0 items-end gap-1 border-b border-(--u-edge) bg-(--u-wash-hover) px-2 pt-1.5">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            onClick={() => setActive(t.id)}
            onAuxClick={(e) => e.button === 1 && close(t.id)}
            className={cn('group relative flex h-[30px] max-w-[200px] min-w-[110px] cursor-default items-center gap-2 rounded-t-[9px] px-3 text-[12.5px] transition-colors duration-75', t.id === active ? 'bg-(--u-m-solid) font-medium shadow-[inset_0_1px_0_var(--u-edge),inset_1px_0_0_var(--u-edge),inset_-1px_0_0_var(--u-edge)]' : 'text-(--u-ink-2) hover:bg-(--u-wash-hover)')}
          >
            <span className="min-w-0 flex-1 truncate">{t.label}</span>
            <button type="button" aria-label="Close tab" onClick={(e) => (e.stopPropagation(), close(t.id))} className="flex h-4 w-4 items-center justify-center rounded-full text-(--u-ink-3) opacity-0 hover:bg-(--u-wash-press) group-hover:opacity-100">
              <svg viewBox="0 0 16 16" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          </div>
        ))}
        <Button icon size="sm" aria-label="New tab" title="New tab (Ctrl+T)" onClick={() => add()} className="mb-0.5">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((t) => (
          <div key={t.id} className={cn('absolute inset-0', t.id !== active && 'invisible')}>
            <FileExplorerView onClose={() => close(t.id)} initialPath={t.path} onPathChange={(p) => setLabel(t.id, p)} />
          </div>
        ))}
      </div>
    </div>
  )
}
