import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect } from 'react'
import { usePref } from '@/os/kernel/prefs'
import { hasWorkPassword, setWorkPassword, verifyWorkPassword } from '@/os/kernel/profile'
import { pictureOf } from '@/os/kernel/identity'
import { toastError } from '@/os/ui/toasts'
import { ActionButton, Group, Row, Switch } from './ui'

/** The picture, cropped square from the middle and shrunk to 160 px, so it stays a few KB in the preferences. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const side = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = c.height = 160
  const g = c.getContext('2d')
  if (!g) throw new Error('No canvas')
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 160, 160)
  return c.toDataURL('image/jpeg', 0.88)
}

/** Settings: the name and picture Start and the lock screen show. */
export function ProfileGroup() {
  const [name, setName] = usePref('profile.name')
  const [avatar, setAvatar] = usePref('profile.avatar')
  const [system, setSystem] = useState('')
  const [draft, setDraft] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void invoke<string>('shell_user_name').then(setSystem, () => {})
  }, [])
  const picture = pictureOf(avatar)
  const shown = draft ?? name
  const save = () => {
    if (draft === null) return
    void setName(draft.trim().slice(0, 40))
    setDraft(null)
  }
  return (
    <Group title="Profile" footer="Shown on the Start menu and the lock screen. It never changes your Windows account.">
      <Row title="Name" description={system ? `Leave empty to use ${system}.` : 'Leave empty to use your Windows name.'}>
        <input
          aria-label="Profile name"
          value={shown}
          placeholder={system || 'Your name'}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), undefined)}
          className="h-8 w-[220px] rounded-[10px] bg-(--u-wash-hover) px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--u-edge)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--u-accent,#3072f0)]"
        />
      </Row>
      <Row title="Picture" description="A square crop from the middle of the image you choose.">
        <div className="flex items-center gap-3">
          {picture ? <img src={picture} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--u-wash-on) text-[15px] font-semibold">{(name || system || 'U').charAt(0).toUpperCase()}</span>}
          <ActionButton onClick={() => file.current?.click()}>Choose…</ActionButton>
          {picture && <ActionButton onClick={() => void setAvatar('')}>Remove</ActionButton>}
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void shrink(f).then((d) => setAvatar(d), (err) => toastError('Couldn’t use that picture', err))
            }}
          />
        </div>
      </Row>
    </Group>
  )
}

const field = 'h-8 w-[220px] rounded-[10px] bg-(--u-wash-hover) px-3 text-[13px] shadow-[inset_0_0_0_1px_var(--u-edge)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--u-accent,#3072f0)]'

/** Settings: the optional Work profile. Off until switched on; it has its own password, set here. */
export function WorkProfileGroup() {
  const [on, setOn] = usePref('work.enabled')
  const [has, setHas] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    void hasWorkPassword().then(setHas)
  }, [])

  const save = async () => {
    if (next.length < 4) return setMsg({ ok: false, text: 'Use at least 4 characters.' })
    if (next !== again) return setMsg({ ok: false, text: 'The two new passwords do not match.' })
    if (has && !(await verifyWorkPassword(cur))) return setMsg({ ok: false, text: 'The current password is not right.' })
    await setWorkPassword(next)
    setHas(true)
    setOpen(false)
    setCur('')
    setNext('')
    setAgain('')
    setMsg({ ok: true, text: has ? 'Work password changed.' : 'Work password set.' })
  }

  return (
    <Group title="Work profile" footer="A second, separate desktop for work, with its own password, pinned apps, notes and wallpaper. When it is off, nothing about Work appears in Start.">
      <Row title="Use a Work profile" description="Adds Switch to Work to the Start menu.">
        <Switch checked={on} onChange={(v) => void setOn(v)} label="Use a Work profile" />
      </Row>
      {on && (
        <>
          <Row title="Work password" description={has === false ? 'Not set yet. You will also be asked the first time you switch to Work.' : 'Asked every time you switch to Work.'}>
            <ActionButton onClick={() => (setOpen((o) => !o), setMsg(null))}>{open ? 'Cancel' : has ? 'Change…' : 'Set password…'}</ActionButton>
          </Row>
          {open && (
            <div className="flex flex-col gap-2.5 px-4 pb-4">
              {has && <input type="password" autoComplete="off" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} className={field} />}
              <input type="password" autoComplete="off" placeholder="New password (4 or more characters)" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
              <input type="password" autoComplete="off" placeholder="Repeat new password" value={again} onChange={(e) => setAgain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} className={field} />
              <ActionButton onClick={() => void save()}>Save password</ActionButton>
            </div>
          )}
          {msg && <p className={`px-4 pb-3 text-[12px] ${msg.ok ? 'text-(--u-ok)' : 'text-(--u-danger)'}`}>{msg.text}</p>}
        </>
      )}
    </Group>
  )
}
