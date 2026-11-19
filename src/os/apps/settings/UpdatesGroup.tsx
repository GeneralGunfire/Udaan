import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { checkForUpdate, currentVersion, installUpdate, type Available } from '@/os/kernel/updates'
import { toastError } from '@/os/ui/toasts'
import { ActionButton, Group, Row } from './ui'

/** Settings: the version, and a button that looks for a newer one. Updating keeps all your settings and data. */
export function UpdatesGroup() {
  const [version, setVersion] = useState('')
  const [state, setState] = useState<'idle' | 'checking' | 'uptodate' | 'found' | 'installing' | 'error'>('idle')
  const [found, setFound] = useState<Available | null>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    void currentVersion().then(setVersion)
    const off = listen<{ done: number; total: number }>('update://progress', (e) => setProgress(e.payload.total ? Math.round((e.payload.done / e.payload.total) * 100) : 0))
    return () => void off.then((fn) => fn())
  }, [])

  const check = async () => {
    setState('checking')
    try {
      const a = await checkForUpdate()
      setFound(a)
      setState(a ? 'found' : 'uptodate')
    } catch (err) {
      setState('error')
      toastError('Couldn’t check for updates', err)
    }
  }

  const install = async () => {
    if (!found) return
    setState('installing')
    try {
      await installUpdate(found)
    } catch (err) {
      setState('found')
      toastError('Couldn’t install the update', err)
    }
  }

  const status =
    state === 'checking' ? 'Checking…' : state === 'uptodate' ? 'You have the newest version.' : state === 'found' && found ? `Version ${found.version} is available${found.size ? ` (${found.size})` : ''}.` : state === 'installing' ? `Downloading and installing${progress ? `… ${progress}%` : '…'} Udaan will restart.` : state === 'error' ? 'The check did not work. Try again in a moment.' : 'Updates keep your settings, PIN and notes.'

  return (
    <Group title="Updates" footer="Updating replaces only the program. Your settings, PIN, Work password, notes and wallpapers are kept.">
      <Row title={`Udaan ${version}`} description={status}>
        {state === 'found' ? <ActionButton onClick={() => void install()}>Update now</ActionButton> : <ActionButton onClick={() => void check()} disabled={state === 'checking' || state === 'installing'}>Check for updates</ActionButton>}
      </Row>
      {state === 'found' && found && found.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 px-8 py-3 text-[12.5px] text-(--u-ink-2)">{found.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
    </Group>
  )
}
