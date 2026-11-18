import { errorText, fs, on, type ConflictMode } from './api'
import { baseName, join, moveTags, parentOf, driveOf, samePath } from './model'

/**
 * Every change Files makes to the disk goes through here, so each one is:
 *   confirmed when it needs to be (conflicts, permanent delete),
 *   undoable (an entry on the shared undo stack),
 *   announced (a toast, with Undo on it),
 *   and reflected in tags and the search index.
 */

/* ── a little UI bus: toasts, dialogs, progress ─────────────────── */

export interface Toast {
  id: number
  text: string
  tone?: 'danger'
  action?: { label: string; run: () => void }
}
export interface Ask {
  title: string
  body?: string
  /** Buttons, last is the default. */
  choices: { label: string; value: string; tone?: 'danger' | 'accent' }[]
  /** Shows a text field; its value is returned as `text`. */
  input?: { value: string; select?: [number, number]; placeholder?: string }
  resolve: (r: { value: string; text?: string } | null) => void
}
export interface Progress {
  label: string
  done: number
  total: number
}

type Sub = () => void
function bus<T>(initial: T) {
  let v = initial
  const subs = new Set<Sub>()
  return {
    get: () => v,
    set: (n: T) => {
      v = n
      subs.forEach((s) => s())
    },
    subscribe: (s: Sub) => (subs.add(s), () => void subs.delete(s)),
  }
}
export const toastBus = bus<Toast[]>([])
export const askBus = bus<Ask | null>(null)
export const progressBus = bus<Progress | null>(null)
export const clipBus = bus<{ paths: string[]; mode: 'copy' | 'cut' } | null>(null)
export const undoBus = bus<{ undo: string | null; redo: string | null }>({ undo: null, redo: null })

let tid = 0
export function toast(text: string, opts: Omit<Toast, 'id' | 'text'> = {}) {
  const t: Toast = { id: ++tid, text, ...opts }
  toastBus.set([...toastBus.get().slice(-2), t])
  setTimeout(() => toastBus.set(toastBus.get().filter((x) => x.id !== t.id)), opts.action ? 6000 : 3200)
}
export const fail = (e: unknown) => toast(errorText(e), { tone: 'danger' })

export function ask(a: Omit<Ask, 'resolve'>): Promise<{ value: string; text?: string } | null> {
  return new Promise((resolve) => askBus.set({ ...a, resolve: (r) => (askBus.set(null), resolve(r)) }))
}

/* ── undo ───────────────────────────────────────────────────────── */

interface Op {
  label: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}
const undos: Op[] = []
const redos: Op[] = []
const syncUndo = () => undoBus.set({ undo: undos.at(-1)?.label ?? null, redo: redos.at(-1)?.label ?? null })
function record(op: Op, message: string) {
  undos.push(op)
  if (undos.length > 50) undos.shift()
  redos.length = 0
  syncUndo()
  toast(message, { action: { label: 'Undo', run: () => void undo() } })
}
export async function undo() {
  const op = undos.pop()
  if (!op) return
  try {
    await op.undo()
    redos.push(op)
    toast(`Undid: ${op.label}`)
  } catch (e) {
    fail(e)
  }
  syncUndo()
}
export async function redo() {
  const op = redos.pop()
  if (!op) return
  try {
    await op.redo()
    undos.push(op)
    toast(`Redid: ${op.label}`)
  } catch (e) {
    fail(e)
  }
  syncUndo()
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const what = (paths: string[]) => (paths.length === 1 ? `“${baseName(paths[0])}”` : plural(paths.length, 'item'))

/* ── transfers ──────────────────────────────────────────────────── */

let transferSeen: string | null = null
on<{ transfer_id: string; done: number; total: number; current_name: string }>('file-explorer://transfer-progress', (p) => {
  if (p.transfer_id !== transferSeen) return
  const cur = progressBus.get()
  progressBus.set({ label: cur?.label ?? 'Working', done: p.done, total: p.total })
})

async function resolveConflicts(paths: string[], dest: string): Promise<ConflictMode | null> {
  const clash = await fs.conflicts(paths, dest).catch(() => [] as string[])
  if (!clash.length) return 'keep_both'
  const r = await ask({
    title: clash.length === 1 ? `“${baseName(clash[0])}” already exists here` : `${clash.length} items already exist here`,
    body: 'Replace them, keep both (the new ones get a number), or skip them?',
    choices: [
      { label: 'Skip', value: 'skip' },
      { label: 'Replace', value: 'overwrite', tone: 'danger' },
      { label: 'Keep both', value: 'keep_both', tone: 'accent' },
    ],
  })
  return (r?.value as ConflictMode) ?? null
}

/**
 * Copy or move into `dest`. Dropping onto the same folder does nothing; moving
 * across drives is really a copy + delete, which the backend handles.
 */
export async function transfer(paths: string[], dest: string, mode: 'copy' | 'move') {
  paths = paths.filter((p) => !samePath(parentOf(p) ?? '', dest) || mode === 'copy')
  // Never into itself.
  paths = paths.filter((p) => !(samePath(p, dest) || dest.toLowerCase().startsWith(p.toLowerCase() + '\\')))
  if (!paths.length) return
  const conflict = await resolveConflicts(paths, dest)
  if (!conflict) return
  const id = crypto.randomUUID()
  transferSeen = id
  progressBus.set({ label: `${mode === 'copy' ? 'Copying' : 'Moving'} ${what(paths)}`, done: 0, total: 0 })
  try {
    const sources = [...paths]
    const fromDirs = sources.map((p) => parentOf(p) ?? '')
    const result = mode === 'copy' ? await fs.copy(sources, dest, conflict, id) : await fs.move(sources, dest, conflict, id)
    const made = result.map((r) => r.path)
    if (mode === 'move') {
      moveTags(sources.map((s, i) => [s, made[i] ?? join(dest, baseName(s))]))
      void fs.indexTouch(sources, made)
      record(
        {
          label: `Move ${what(sources)}`,
          undo: async () => {
            // Put each item back where it came from.
            for (let i = 0; i < made.length; i++) await fs.move([made[i]], fromDirs[i], 'keep_both', crypto.randomUUID())
            moveTags(made.map((m, i) => [m, sources[i]]))
          },
          redo: async () => void (await fs.move(sources, dest, 'keep_both', crypto.randomUUID())),
        },
        `Moved ${what(sources)} to ${baseName(dest)}`,
      )
    } else {
      void fs.indexTouch([], made)
      let since = 0
      record(
        {
          label: `Copy ${what(sources)}`,
          undo: async () => void (since = await fs.recycle(made)),
          redo: async () => void (since ? await fs.binRestorePaths(made, since) : await fs.copy(sources, dest, 'keep_both', crypto.randomUUID())),
        },
        `Copied ${what(sources)} to ${baseName(dest)}`,
      )
    }
  } catch (e) {
    fail(e)
  } finally {
    transferSeen = null
    progressBus.set(null)
  }
}

/** Drag-drop default, like Explorer: move on the same drive, copy across drives. Ctrl forces copy, Shift forces move. */
export function dropMode(paths: string[], dest: string, e: { ctrlKey: boolean; shiftKey: boolean }): 'copy' | 'move' {
  if (e.ctrlKey) return 'copy'
  if (e.shiftKey) return 'move'
  return paths.every((p) => driveOf(p) === driveOf(dest)) ? 'move' : 'copy'
}

/* ── delete ─────────────────────────────────────────────────────── */

export async function recycle(paths: string[]) {
  if (!paths.length) return
  try {
    const since = await fs.recycle(paths)
    void fs.indexTouch(paths, [])
    record(
      {
        label: `Delete ${what(paths)}`,
        undo: () => fs.binRestorePaths(paths, since),
        redo: async () => void (await fs.recycle(paths)),
      },
      `Moved ${what(paths)} to the Recycle Bin`,
    )
  } catch (e) {
    fail(e)
  }
}

export async function deleteForever(paths: string[]) {
  if (!paths.length) return
  const r = await ask({
    title: `Delete ${what(paths)} permanently?`,
    body: 'This skips the Recycle Bin and cannot be undone.',
    choices: [
      { label: 'Cancel', value: 'no' },
      { label: 'Delete', value: 'yes', tone: 'danger' },
    ],
  })
  if (r?.value !== 'yes') return
  try {
    await fs.deleteForever(paths)
    void fs.indexTouch(paths, [])
    toast(`Deleted ${what(paths)}`)
  } catch (e) {
    fail(e)
  }
}

/* ── create / rename ────────────────────────────────────────────── */

export async function rename(path: string, newName: string): Promise<string | null> {
  const old = baseName(path)
  newName = newName.trim()
  if (!newName || newName === old) return null
  try {
    const r = await fs.rename(path, newName)
    moveTags([[path, r.path]])
    void fs.indexTouch([path], [r.path])
    record(
      {
        label: `Rename to “${newName}”`,
        undo: async () => (await fs.rename(r.path, old), moveTags([[r.path, path]])),
        redo: async () => (await fs.rename(path, newName), moveTags([[path, r.path]])),
      },
      `Renamed to “${newName}”`,
    )
    return r.path
  } catch (e) {
    fail(e)
    return null
  }
}

export async function batchRename(pairs: [string, string][]) {
  if (!pairs.length) return
  try {
    await fs.batchRename(pairs)
    moveTags(pairs)
    void fs.indexTouch(pairs.map((p) => p[0]), pairs.map((p) => p[1]))
    const back = pairs.map(([a, b]) => [b, a] as [string, string])
    record(
      {
        label: `Rename ${plural(pairs.length, 'item')}`,
        undo: async () => (await fs.batchRename(back), moveTags(back)),
        redo: async () => (await fs.batchRename(pairs), moveTags(pairs)),
      },
      `Renamed ${plural(pairs.length, 'item')}`,
    )
  } catch (e) {
    fail(e)
  }
}

export async function newFolder(dir: string): Promise<string | null> {
  for (let n = 1; n < 200; n++) {
    const name = n === 1 ? 'New folder' : `New folder (${n})`
    try {
      const r = await fs.mkdir(dir, name)
      void fs.indexTouch([], [r.path])
      let since = 0
      record({ label: 'New folder', undo: async () => void (since = await fs.recycle([r.path])), redo: () => fs.binRestorePaths([r.path], since) }, `Created “${name}”`)
      return r.path
    } catch (e) {
      if (!/exists/i.test(errorText(e))) return fail(e), null
    }
  }
  return null
}

export async function newFile(dir: string, kind: 'text' | 'word' | 'excel' | 'power_point'): Promise<string | null> {
  try {
    const r = await fs.newFile(dir, kind)
    let since = 0
    record({ label: `New file`, undo: async () => void (since = await fs.recycle([r.path])), redo: () => fs.binRestorePaths([r.path], since) }, `Created “${r.name}”`)
    return r.path
  } catch (e) {
    fail(e)
    return null
  }
}

export async function duplicate(paths: string[]): Promise<string[]> {
  const made: string[] = []
  try {
    for (const p of paths) made.push((await fs.duplicate(p)).path)
    let since = 0
    record({ label: `Duplicate ${what(paths)}`, undo: async () => void (since = await fs.recycle(made)), redo: () => fs.binRestorePaths(made, since) }, `Duplicated ${what(paths)}`)
  } catch (e) {
    fail(e)
  }
  return made
}

export async function compress(paths: string[], dir: string): Promise<string | null> {
  progressBus.set({ label: `Compressing ${what(paths)}`, done: 0, total: 0 })
  try {
    const r = await fs.compress(paths, dir)
    let since = 0
    record({ label: 'Compress', undo: async () => void (since = await fs.recycle([r.path])), redo: () => fs.binRestorePaths([r.path], since) }, `Created “${r.name}”`)
    return r.path
  } catch (e) {
    fail(e)
    return null
  } finally {
    progressBus.set(null)
  }
}

export async function extract(zip: string, inner?: string[], dest?: string): Promise<string | null> {
  progressBus.set({ label: `Extracting ${baseName(zip)}`, done: 0, total: 0 })
  try {
    const r = await fs.zipExtract(zip, inner, dest)
    if (!dest) {
      let since = 0
      record({ label: 'Extract', undo: async () => void (since = await fs.recycle([r.path])), redo: () => fs.binRestorePaths([r.path], since) }, `Extracted to “${r.name}”`)
    } else toast(`Extracted ${inner ? plural(inner.length, 'item') : 'everything'} to ${baseName(dest)}`)
    return r.path
  } catch (e) {
    fail(e)
    return null
  } finally {
    progressBus.set(null)
  }
}

export async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(message)
  } catch (e) {
    fail(e)
  }
}
