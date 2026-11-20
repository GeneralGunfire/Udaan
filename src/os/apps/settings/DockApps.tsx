import { useCallback, useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from '@/shared/components/ui/button'
import { useShellMenu } from '@/os/ui/useShellMenu'
import { APP_DEFS, APP_IDS } from '@/os/kernel/registry'
import { AppIcon } from '@/os/ui/icons/AppIcon'
import { appKey, baseName, defaultPins, exeKey, loadPins, onPinsChanged, savePins, type Pin } from '@/os/dock/pins'
import { toastError } from '@/os/ui/toasts'
import { Group, Row } from './ui'

/**
 * The dock's apps, in the person's hands: remove any of them (nothing is pinned for good), reorder them, add an
 * Udaan app or any program on the PC, or start over from the defaults. Changes show in the dock at once.
 */
export function DockApps() {
  const [pins, setPins] = useState<Pin[] | null>(null)
  const openMenu = useShellMenu()

  const reload = useCallback(() => void loadPins().then(setPins, () => setPins([])), [])
  useEffect(() => {
    reload()
    const un = onPinsChanged(reload)
    return () => void un.then((fn) => fn())
  }, [reload])

  const save = (next: Pin[]) => {
    setPins(next)
    void savePins(next).catch((err) => toastError('Couldn’t change the dock', err))
  }

  const move = (i: number, d: -1 | 1) => {
    if (!pins) return
    const j = i + d
    if (j < 0 || j >= pins.length) return
    const next = [...pins]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }

  const addUdaanApp = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!pins) return
    const have = new Set(pins.map((p) => p.key))
    const free = APP_IDS.filter((id) => !have.has(appKey(id)))
    const r = e.currentTarget.getBoundingClientRect()
    openMenu(
      { x: r.left, y: r.bottom + 4 },
      free.length
        ? free.map((id) => ({ label: APP_DEFS[id].name, onSelect: () => save([...pins, { key: appKey(id), kind: 'app', appId: id, name: APP_DEFS[id].name }]) }))
        : [{ label: 'Every Udaan app is already in the dock', disabled: true }],
    )
  }

  const addProgram = async () => {
    if (!pins) return
    try {
      const picked = await openDialog({ multiple: false, directory: false, filters: [{ name: 'Programs', extensions: ['exe'] }] })
      const path = Array.isArray(picked) ? picked[0] : picked
      if (!path) return
      const file = baseName(path)
      if (pins.some((p) => p.key === exeKey(file))) return
      save([...pins, { key: exeKey(file), kind: 'exe', match: file, launch: path, name: file.replace(/\.exe$/i, '') }])
    } catch (err) {
      toastError('Couldn’t add that program', err)
    }
  }

  return (
    <Group title="Dock apps" footer="Remove anything you don't want. Nothing is locked to the dock. You can also right-click an icon in the dock, or drag it up and off.">
      {pins === null ? (
        <Row title="Loading…" />
      ) : pins.length === 0 ? (
        <Row title="The dock has no apps" description="Add an Udaan app or a program below." />
      ) : (
        pins.map((p, i) => (
          <Row key={p.key} title={p.name} description={p.kind === 'app' ? 'Udaan app' : p.launch.includes('\\') || p.launch.includes('/') ? p.launch : 'Program'}>
            <div className="flex items-center gap-1.5">
              <span className="mr-1 flex h-7 w-7 items-center justify-center overflow-hidden rounded-[8px] bg-(--u-wash-on)">
                {p.kind === 'app' ? <AppIcon appId={p.appId} size={22} /> : <span className="text-[12px] font-semibold text-(--u-ink-2)">{p.name.slice(0, 1).toUpperCase()}</span>}
              </span>
              <Button type="button" size="pill-sm" variant="surface" disabled={i === 0} aria-label={`Move ${p.name} earlier`} onClick={() => move(i, -1)}>
                Up
              </Button>
              <Button type="button" size="pill-sm" variant="surface" disabled={i === pins.length - 1} aria-label={`Move ${p.name} later`} onClick={() => move(i, 1)}>
                Down
              </Button>
              <Button type="button" size="pill-sm" variant="surface" aria-label={`Remove ${p.name} from the dock`} onClick={() => save(pins.filter((x) => x.key !== p.key))}>
                Remove
              </Button>
            </div>
          </Row>
        ))
      )}
      <Row title="Add to the dock" description="An Udaan app, or any program on this PC.">
        <div className="flex items-center gap-1.5">
          <Button type="button" size="pill-sm" variant="surface" onClick={addUdaanApp}>
            Add an Udaan app
          </Button>
          <Button type="button" size="pill-sm" variant="surface" onClick={() => void addProgram()}>
            Add a program…
          </Button>
        </div>
      </Row>
      <Row title="Start over" description="Puts the dock back to how a new install begins: File Explorer and Visual Studio Code.">
        <Button type="button" size="pill-sm" variant="surface" onClick={() => save(defaultPins())}>
          Reset dock
        </Button>
      </Row>
    </Group>
  )
}
