import { useState } from 'react'
import { GlassPanel } from '@/shared/components/GlassPanel'
import { UserCircleIcon } from '@/shared/icons'
import { useLocalProfile } from './hooks/useLocalProfile'

/**
 * Local profile view. This is a single-user local app — there is no
 * authentication, no account server, no sync between machines. What lives
 * here is a display name and freeform preference notes, saved to this
 * machine's localStorage only.
 */
export function AccountView() {
  const { profile, save, savedAt } = useLocalProfile()
  const [name, setName] = useState(profile.name)
  const [preferences, setPreferences] = useState(profile.preferences)

  const dirty = name !== profile.name || preferences !== profile.preferences

  function handleSave() {
    save({ name, preferences })
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto py-4">
      <div className="flex items-center gap-2">
        <UserCircleIcon width={16} height={16} className="text-brand-teal" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">Account</h1>
      </div>

      <GlassPanel className="flex flex-col gap-1">
        <p className="text-text-secondary text-[12px] leading-relaxed">
          Udaan is a single-user local app — there's no login, no account server, and nothing
          here leaves this machine. This profile is just a name and a few preference notes,
          stored in your browser's local storage.
        </p>
      </GlassPanel>

      <GlassPanel className="flex flex-col gap-4">
        <h2 className="text-text-primary text-[14px] font-medium">Profile</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-text-tertiary text-[11px] font-medium tracking-wide uppercase">
            Name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="glass-surface text-text-primary placeholder:text-text-tertiary rounded-[10px] px-3 py-2 text-[13px] outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-text-tertiary text-[11px] font-medium tracking-wide uppercase">
            Preferences
          </span>
          <textarea
            value={preferences}
            onChange={(e) => setPreferences(e.target.value)}
            placeholder="Freeform notes — timezone, working hours, tone preferences, anything you want remembered."
            rows={4}
            className="glass-surface text-text-primary placeholder:text-text-tertiary resize-none rounded-[10px] px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty}
            className="rounded-[10px] px-4 py-2 text-[12.5px] font-medium text-white transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--gradient-brand)' }}
          >
            Save
          </button>
          {!dirty && savedAt && (
            <span className="text-text-tertiary text-[11px]">
              Saved {savedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </GlassPanel>
    </div>
  )
}
