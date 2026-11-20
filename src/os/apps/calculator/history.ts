/** Per-mode calculation history and the memory list, kept in localStorage. Bad stored data reads as empty. */

export type CalcMode = 'standard' | 'scientific' | 'programmer' | 'converter'

export interface HistoryEntry {
  expr: string
  result: string
  /** The numeric result, for reuse. Programmer results keep their decimal text. */
  value: string
  at: number
}

const LIMIT = 100
const key = (mode: CalcMode) => `udaan.calc.history.${mode}`

function readJson<T>(
  k: string,
  fallback: T,
  check: (v: unknown) => boolean,
): T {
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return fallback
    const v = JSON.parse(raw) as unknown
    return check(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage full or unavailable: the history just isn't kept */
  }
}

const isEntry = (e: unknown) =>
  !!e &&
  typeof (e as HistoryEntry).expr === 'string' &&
  typeof (e as HistoryEntry).result === 'string' &&
  typeof (e as HistoryEntry).value === 'string'

export function loadHistory(mode: CalcMode): HistoryEntry[] {
  const list = readJson<unknown[]>(key(mode), [], Array.isArray)
  return list.filter(isEntry).slice(0, LIMIT) as HistoryEntry[]
}

export function addHistory(
  mode: CalcMode,
  e: Omit<HistoryEntry, 'at'>,
): HistoryEntry[] {
  const next = [{ ...e, at: Date.now() }, ...loadHistory(mode)].slice(0, LIMIT)
  writeJson(key(mode), next)
  return next
}

/** Drops one entry, matched by its time and expression. */
export function removeHistory(mode: CalcMode, e: HistoryEntry): HistoryEntry[] {
  const next = loadHistory(mode).filter((x) => !(x.at === e.at && x.expr === e.expr))
  writeJson(key(mode), next)
  return next
}

export function clearHistory(mode: CalcMode): HistoryEntry[] {
  writeJson(key(mode), [])
  return []
}

const MEM_KEY = 'udaan.calc.memory'
export function loadMemory(): number[] {
  return readJson<unknown[]>(MEM_KEY, [], Array.isArray)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    .slice(0, 50)
}
export function saveMemory(list: number[]) {
  writeJson(MEM_KEY, list.slice(0, 50))
}

const PREFS_KEY = 'udaan.calc.prefs'
export interface CalcPrefs {
  mode: CalcMode
  angle: 'deg' | 'rad' | 'grad'
  converter: { category: string; from: string; to: string }
  prog: { radix: 2 | 8 | 10 | 16; width: 8 | 16 | 32 | 64; signed: boolean }
}
export const DEFAULT_CALC_PREFS: CalcPrefs = {
  mode: 'standard',
  angle: 'deg',
  converter: { category: 'length', from: 'm', to: 'ft' },
  prog: { radix: 10, width: 64, signed: true },
}
export function loadCalcPrefs(): CalcPrefs {
  const v = readJson<Partial<CalcPrefs>>(
    PREFS_KEY,
    {},
    (x) => !!x && typeof x === 'object',
  )
  const p = { ...DEFAULT_CALC_PREFS, ...v }
  if (!['standard', 'scientific', 'programmer', 'converter'].includes(p.mode))
    p.mode = 'standard'
  if (!['deg', 'rad', 'grad'].includes(p.angle)) p.angle = 'deg'
  const prog = { ...DEFAULT_CALC_PREFS.prog, ...(p.prog ?? {}) }
  if (![2, 8, 10, 16].includes(prog.radix)) prog.radix = 10
  if (![8, 16, 32, 64].includes(prog.width)) prog.width = 64
  const conv = { ...DEFAULT_CALC_PREFS.converter, ...(p.converter ?? {}) }
  return { ...p, prog, converter: conv }
}
export function saveCalcPrefs(p: CalcPrefs) {
  writeJson(PREFS_KEY, p)
}
