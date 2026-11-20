import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Segmented } from '@/os/ui/controls'
import { cn } from '@/shared/lib/cn'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { ConverterPane } from './ConverterPane'
import { formatNumber } from './engine'
import {
  addHistory,
  clearHistory,
  loadCalcPrefs,
  loadHistory,
  loadMemory,
  saveCalcPrefs,
  saveMemory,
  type CalcMode,
  type CalcPrefs,
  type HistoryEntry,
} from './history'
import { Ico, P } from './parts'
import { ProgrammerPane } from './ProgrammerPane'
import { StandardPane } from './StandardPane'

const MODES: { value: CalcMode; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'scientific', label: 'Scientific' },
  { value: 'programmer', label: 'Programmer' },
  { value: 'converter', label: 'Converter' },
]

/**
 * CALCULATOR. Standard, Scientific, Programmer and a unit Converter, each with its own history.
 *   Ctrl+1..4 switch modes    Ctrl+H history    Ctrl+C copy    Ctrl+V paste    Esc clear
 */
export function CalculatorApp(_props: { onClose: () => void }) {
  const [prefs, setPrefsState] = useState<CalcPrefs>(loadCalcPrefs)
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    loadHistory(prefs.mode),
  )
  const [memory, setMemoryState] = useState<number[]>(loadMemory)
  const [panel, setPanel] = useState<null | 'history' | 'memory'>(null)
  const [reuse, setReuse] = useState<{ value: string; n: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mode = prefs.mode

  const say = useCallback((t: string) => {
    setToast(t)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const setPrefs = useCallback((p: CalcPrefs) => {
    setPrefsState(p)
    saveCalcPrefs(p)
  }, [])
  const setMode = useCallback(
    (m: CalcMode) => {
      setPrefs({ ...prefs, mode: m })
      setHistory(loadHistory(m))
      setReuse(null)
      if (m !== 'standard' && m !== 'scientific')
        setPanel((p) => (p === 'memory' ? 'history' : p))
    },
    [prefs, setPrefs],
  )
  const setMemory = (m: number[]) => {
    setMemoryState(m)
    saveMemory(m)
  }

  const modeRef = useRef(mode)
  modeRef.current = mode
  const onRecord = useCallback(
    (expr: string, result: string, value: string) => {
      setHistory(addHistory(modeRef.current, { expr, result, value }))
    },
    [],
  )

  const pick = (value: string) => {
    setReuse((r) => ({ value, n: (r?.n ?? 0) + 1 }))
    setPanel(null)
  }

  // Window-level shortcuts. Panes handle digits and operators themselves.
  const latest = useRef({ setMode })
  latest.current = { setMode }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= 4) {
        e.preventDefault()
        latest.current.setMode(MODES[n - 1].value)
      } else if (e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setPanel((p) => (p ? null : 'history'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setPanel(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [panel])

  const openMenu = useShellMenu()
  // One right-click menu for the whole calculator. Copy and paste go through the same window events the
  // keyboard shortcuts use, so every mode handles them its own way.
  const showMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    openMenu(e, [
      {
        label: 'Copy result',
        shortcut: 'Ctrl+C',
        onSelect: () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })),
      },
      {
        label: 'Paste number',
        shortcut: 'Ctrl+V',
        onSelect: () => {
          void navigator.clipboard
            .readText()
            .then((t) => {
              if (!t) return
              const dt = new DataTransfer()
              dt.setData('text', t)
              window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }))
            })
            .catch(() => say('Couldn’t read the clipboard'))
        },
      },
      { label: undefined },
      { label: 'History', shortcut: 'Ctrl+H', onSelect: () => setPanel((p) => (p ? null : 'history')) },
      { label: 'Clear history', disabled: history.length === 0, onSelect: () => setHistory(clearHistory(mode)) },
    ])
  }

  const paneProps = { onRecord, reuse, say }
  const memoryModes = mode === 'standard' || mode === 'scientific'

  return (
    <div className="relative flex h-full flex-col overflow-hidden text-(--u-ink)" onContextMenu={showMenu}>
      {/* The keypad keeps a calculator's proportions in a big window instead of stretching to fill it. */}
      <div
        className={cn(
          'mx-auto flex h-full max-h-[760px] w-full flex-col',
          mode === 'standard' || mode === 'converter'
            ? 'max-w-[440px]'
            : 'max-w-[640px]',
        )}
      >
        <header className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
          <Segmented<CalcMode>
            value={mode}
            onChange={setMode}
            options={MODES}
            className="min-w-0 flex-1 [&>*]:flex-1"
          />
          <Button
            icon
            size="sm"
            aria-label="History (Ctrl+H)"
            title="History (Ctrl+H)"
            aria-expanded={panel !== null}
            data-on={panel !== null}
            onClick={() => setPanel((p) => (p ? null : 'history'))}
          >
            <Ico d={P.history} size={15} />
          </Button>
        </header>

        {mode === 'standard' || mode === 'scientific' ? (
          <StandardPane
            key={mode}
            scientific={mode === 'scientific'}
            angle={prefs.angle}
            onAngle={(a) => setPrefs({ ...prefs, angle: a })}
            memory={memory}
            onMemory={setMemory}
            {...paneProps}
          />
        ) : mode === 'programmer' ? (
          <ProgrammerPane
            {...prefs.prog}
            onSettings={(p) => setPrefs({ ...prefs, prog: p })}
            {...paneProps}
          />
        ) : (
          <ConverterPane
            {...prefs.converter}
            onSettings={(c) => setPrefs({ ...prefs, converter: c })}
            {...paneProps}
          />
        )}
      </div>

      {/* History and memory slide in over the keypad. */}
      <div
        className={cn(
          'absolute inset-0 z-30 bg-black/25 transition-opacity duration-200',
          panel ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onPointerDown={() => setPanel(null)}
        aria-hidden
      />
      <aside
        className={cn(
          'absolute top-0 right-0 bottom-0 z-40 flex w-[min(300px,85%)] flex-col bg-(--u-m-solid) shadow-[inset_1px_0_0_var(--u-edge)] transition-transform duration-200 ease-out',
          panel ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        )}
        aria-label="History"
        aria-hidden={!panel}
        inert={!panel}
      >
        <header className="flex items-center gap-2 border-b border-(--u-edge) px-3 py-2.5">
          {memoryModes ? (
            <Segmented<'history' | 'memory'>
              value={panel ?? 'history'}
              onChange={setPanel}
              options={[
                { value: 'history', label: 'History' },
                { value: 'memory', label: 'Memory' },
              ]}
            />
          ) : (
            <span className="text-[13px] font-semibold">History</span>
          )}
          <span className="flex-1" />
          <Button
            icon
            size="sm"
            aria-label="Close"
            onClick={() => setPanel(null)}
          >
            <Ico d={P.close} size={13} />
          </Button>
        </header>
        <div className="u-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {panel === 'memory' ? (
            memory.length === 0 ? (
              <p className="px-4 pt-14 text-center text-[12.5px] leading-relaxed text-(--u-ink-3)">
                Nothing in memory. MS stores the number on screen.
              </p>
            ) : (
              memory.map((m, i) => (
                <div
                  key={i}
                  className="group mb-px flex items-center rounded-[9px] hover:bg-(--u-wash-hover)"
                >
                  <button
                    type="button"
                    onClick={() => pick(String(m))}
                    className="min-w-0 flex-1 truncate px-3 py-2.5 text-right text-[18px] font-semibold tabular-nums outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]"
                  >
                    {formatNumber(m)}
                  </button>
                  <Button
                    icon
                    size="sm"
                    aria-label="Remove from memory"
                    className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => setMemory(memory.filter((_, j) => j !== i))}
                  >
                    <Ico d={P.close} size={12} />
                  </Button>
                </div>
              ))
            )
          ) : history.length === 0 ? (
            <p className="px-4 pt-14 text-center text-[12.5px] leading-relaxed text-(--u-ink-3)">
              No history yet. Finished calculations appear here; click one to
              use its result.
            </p>
          ) : (
            history.map((h) => (
              <button
                key={h.at + h.expr}
                type="button"
                onClick={() => pick(h.value)}
                className="mb-px flex w-full flex-col items-end gap-0.5 rounded-[9px] px-3 py-2 text-right outline-none hover:bg-(--u-wash-hover) focus-visible:shadow-[inset_0_0_0_1.5px_var(--u-accent)]"
              >
                <span className="w-full truncate text-[11.5px] text-(--u-ink-3) tabular-nums">
                  {h.expr}
                </span>
                <span className="w-full truncate text-[17px] font-semibold tabular-nums">
                  {h.result}
                </span>
              </button>
            ))
          )}
        </div>
        {panel === 'history' && history.length > 0 && (
          <footer className="flex justify-end border-t border-(--u-edge) px-3 py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setHistory(clearHistory(mode))}
            >
              <Ico d={P.trash} size={13} /> Clear history
            </Button>
          </footer>
        )}
      </aside>

      {toast && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-(--u-m-solid-hi) px-4 py-2 text-[12.5px] shadow-[inset_0_0_0_1px_var(--u-edge)]"
        >
          {toast}
        </div>
      )}
    </div>
  )
}
