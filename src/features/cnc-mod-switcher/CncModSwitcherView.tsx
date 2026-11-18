import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckIcon, DiscIcon, SyncIcon } from '@/shared/icons'
import { getStatus, switchMod, launchGame, restoreBackup, type GameStatus } from '@/integrations/cnc-mod-switcher'
import { Button } from '@/shared/components/ui/button'
import zeroHourDisc from '@/assets/cnc-mod-switcher/zero-hour-disc.jpg'
import zeroHourCover from '@/assets/cnc-mod-switcher/zero-hour-cover.jpg'
import zeroHourEnhancedDisc from '@/assets/cnc-mod-switcher/zero-hour-enhanced-disc.jpg'
import zeroHourEnhancedCover from '@/assets/cnc-mod-switcher/zero-hour-enhanced-cover.jpg'
import { ViewShell, ViewHeader } from '@/shared/components/ui/view'
import { HealthPanel, logActivity } from './HealthPanel'

interface CncModSwitcherViewProps {
  onClose: () => void
}

/** A mod's own disc label, swapped into the player once it's actually
 * launched — anything without an entry here just keeps showing the base
 * Zero Hour disc rather than rendering blank. */
const MOD_DISC_ART: Record<string, string> = {
  'Zero Hour Enhanced': zeroHourEnhancedDisc,
}
/** Large banner art for a mod's own library card — deliberately NOT a
 * fallback-to-base-art map: a mod with no dedicated cover of its own gets
 * a plain card, not someone else's box art. */
const MOD_COVER_ART: Record<string, string> = {
  'Zero Hour Enhanced': zeroHourEnhancedCover,
  'Cold War Crisis': zeroHourCover,
}

/**
 * Udaan-native replacement for Gen Launcher's mod-picker UI. Real mechanism
 * (confirmed by decompiling GenLauncher.exe): a mod's GLM\<Name>\<Version>\
 * folder is symlinked, file by file, onto the game root — never copied.
 * Creating those symlinks needs Developer Mode or Administrator, checked
 * fresh every time this view loads or a switch is attempted, never cached.
 *
 * Visual concept: a physical disc player is the centerpiece. The base
 * Zero Hour disc is always "in the drive" and spinning whenever the game
 * drive itself is connected — mirrors how the drive being plugged in is
 * the actual precondition for anything here working at all. Launching a
 * mod swaps in that mod's own disc label. When the drive ISN'T connected,
 * the player sits empty and the base disc appears ejected off to the
 * side, both as a decorative echo of "this is what would be playing" and
 * as a visual nudge to plug the drive back in.
 */
// `onClose` is part of BaseAppProps (AppHost always passes it) but this
// view no longer needs its own close button — AppTitleBar is now the one
// shared close affordance every app view uses.
export function CncModSwitcherView(_props: CncModSwitcherViewProps) {
  const [status, setStatus] = useState<GameStatus | null>(null)
  const [activeMod, setActiveMod] = useState<string | null>(null)
  const [busyMod, setBusyMod] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [checking, setChecking] = useState(false)

  // Drive/precondition status is only re-checked on open and on an
  // explicit refresh — not polled — since plugging/unplugging a drive or
  // toggling Developer Mode is a deliberate user action they can always
  // follow with this button, and polling a filesystem/registry check on
  // an interval for something that rarely changes mid-session isn't worth
  // the constant background cost.
  const refresh = useCallback(() => {
    setChecking(true)
    return getStatus()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleLaunch(name: string, version: string) {
    setError(null)
    setBusyMod(name)
    try {
      await switchMod(name, version)
      setActiveMod(name)
      logActivity(`Switched to ${name} and launched`)
      await launchGame()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyMod(null)
    }
  }

  async function handleRestore() {
    setError(null)
    setRestoring(true)
    try {
      await restoreBackup()
      setActiveMod(null)
      logActivity('Restored the last backup')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRestoring(false)
    }
  }

  const precondition = status?.precondition
  const canSwitch = precondition?.can_create_symlinks ?? false
  const driveConnected = status?.drive_connected ?? false
  const discArt = (activeMod && MOD_DISC_ART[activeMod]) || zeroHourDisc
  const isSpinning = driveConnected
  const isLaunching = busyMod !== null

  return (
    <ViewShell>
      <ViewHeader
        title="C&C Generals Zero Hour — Mod Switcher"
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void refresh()}
              disabled={checking}
              aria-label="Recheck drive and permissions"
            >
              <motion.span
                className="block"
                animate={checking ? { rotate: 360 } : { rotate: 0 }}
                transition={checking ? { duration: 0.7, repeat: Infinity, ease: 'linear' } : { duration: 0.15 }}
              >
                <SyncIcon width={16} height={16} />
              </motion.span>
            </Button>
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
        {!status && !error && <p className="text-text-tertiary text-sm">Checking drive and permissions…</p>}

        {error && (
          <div className="rounded-xl border border-danger-border px-4 py-3 text-sm text-danger" style={{ background: 'color-mix(in srgb, var(--surface-raised) 80%, var(--color-danger))' }}>
            {error}
          </div>
        )}

        {status && (
          <>
            {/* --- Disc player hero --------------------------------------
                Base disc is "in the drive" and spinning whenever the drive
                itself is connected, regardless of whether a mod has been
                launched yet — the drive connection is the real precondition
                everything else here depends on. Launching a mod swaps in
                that mod's own disc. Disconnected: player sits empty, base
                disc shown ejected to the side. */}
            <section
              className="border-hairline relative flex items-center justify-center gap-2 overflow-hidden rounded-3xl border px-6 pt-8 pb-6"
              style={{
                background:
                  'linear-gradient(180deg, var(--surface-canvas) 0%, var(--surface-base) 55%, var(--surface-canvas) 100%)',
                boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 6%), 0 20px 44px rgb(0 0 0 / 40%)',
              }}
            >
              <DiscPlayer connected={driveConnected} discArt={discArt} spinning={isSpinning} launching={isLaunching} />

              <AnimatePresence>
                {!driveConnected && (
                  <motion.div
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                    className="relative -ml-8 h-28 w-28 shrink-0 self-center overflow-hidden rounded-full"
                    style={{ boxShadow: '0 10px 24px rgb(0 0 0 / 50%), inset 0 0 0 1px rgb(255 255 255 / 10%)' }}
                  >
                    <img src={zeroHourDisc} alt="" className="h-full w-full object-cover opacity-70" draggable={false} />
                    <div
                      className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                      style={{ background: 'var(--surface-base)', borderColor: 'rgb(255 255 255 / 15%)' }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <p className="text-text-tertiary -mt-2 text-center text-xs">
              {!driveConnected
                ? 'Drive disconnected — plug it back in to load the disc.'
                : activeMod
                  ? `${activeMod} is loaded and spinning.`
                  : 'Zero Hour is spinning. Pick a mod below to launch it instead.'}
            </p>

            <section className="border-hairline rounded-2xl border p-4" style={{ background: 'var(--surface-raised)' }}>
              <div className="flex items-center justify-between">
                <h2 className="text-text-primary text-sm font-medium">Drive &amp; permissions</h2>
                {status.drive_connected && canSwitch && (
                  <span className="flex items-center gap-1.5 text-xs text-success">
                    <CheckIcon width={12} height={12} />
                    Ready
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                <p className="text-text-secondary text-xs">
                  {status.drive_connected ? (
                    <>
                      Drive connected — <span className="font-mono text-2xs">{status.game_root}</span>
                    </>
                  ) : (
                    'Drive not connected. Plug in the drive containing your C&C Generals Zero Hour install and reopen this panel.'
                  )}
                </p>
                {!canSwitch && (
                  <div className="mt-1 text-xs text-warning">
                    <p className="mb-1">
                      Windows won't allow creating the symlinks mod switching needs. Do one of the following, then reopen this panel:
                    </p>
                    <ul className="text-text-secondary list-disc space-y-0.5 pl-5">
                      <li>Enable Developer Mode: Settings → Privacy &amp; Security → For Developers → Developer Mode</li>
                      <li>Or run Udaan as Administrator</li>
                    </ul>
                  </div>
                )}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-text-primary text-sm font-medium">Installed mods</h2>
                {status.has_backup && (
                  <Button type="button" variant="ghost" size="pill-sm" onClick={handleRestore} disabled={restoring} className="rounded-lg">
                    {restoring ? 'Restoring…' : 'Restore last backup'}
                  </Button>
                )}
              </div>

              {status.installed_mods.length === 0 ? (
                <p className="text-text-tertiary rounded-xl border border-dashed border-white/10 py-8 text-center text-sm">
                  No installed mods found under GLM\.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {status.installed_mods.map((mod) => (
                    <ModCard
                      key={mod.name}
                      name={mod.name}
                      version={mod.version}
                      fileCount={mod.file_count}
                      coverArt={MOD_COVER_ART[mod.name]}
                      isActive={activeMod === mod.name}
                      isBusy={busyMod === mod.name}
                      disabled={!canSwitch || !status.drive_connected || busyMod !== null}
                      onLaunch={() => handleLaunch(mod.name, mod.version)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <HealthPanel refreshKey={Number(checking) + (status.has_backup ? 1 : 0) + (activeMod ? 2 : 0)} onActive={(m) => setActiveMod(m)} />
          </>
        )}
      </div>
    </ViewShell>
  )
}

interface DiscPlayerProps {
  connected: boolean
  discArt: string
  spinning: boolean
  launching: boolean
}

/**
 * The player itself: an always-present tray ring. When the drive is
 * connected, a disc sits inside it, spinning slowly at idle and faster
 * while a mod is actively being launched — same "something is happening"
 * language as a real optical drive winding up. When disconnected, the
 * tray is empty (the disc is rendered ejected, to the side, by the
 * caller) as both a visual cue and a literal readout of drive state.
 */
function DiscPlayer({ connected, discArt, spinning, launching }: DiscPlayerProps) {
  return (
    <div className="relative flex h-44 w-44 shrink-0 items-center justify-center">
      <div
        className="absolute inset-0 rounded-full border"
        style={{ borderColor: 'rgb(255 255 255 / 8%)', boxShadow: 'inset 0 2px 10px rgb(0 0 0 / 55%)' }}
      />
      <AnimatePresence mode="wait">
        {connected ? (
          <motion.div
            key={discArt}
            initial={{ opacity: 0, scale: 0.7, rotate: -18 }}
            animate={{ opacity: 1, scale: 1, rotate: spinning ? 360 : 0 }}
            exit={{ opacity: 0, scale: 0.7, rotate: 18 }}
            transition={
              spinning
                ? {
                    rotate: { duration: launching ? 0.9 : 5, repeat: Infinity, ease: 'linear' },
                    opacity: { duration: 0.2 },
                    scale: { duration: 0.3 },
                  }
                : { type: 'spring', stiffness: 260, damping: 22 }
            }
            className="relative h-40 w-40 overflow-hidden rounded-full"
            style={{ boxShadow: '0 8px 28px rgb(0 0 0 / 55%), inset 0 0 0 1px rgb(255 255 255 / 12%)' }}
          >
            <img src={discArt} alt="" className="h-full w-full object-cover" draggable={false} />
            <div
              className="absolute top-1/2 left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{ background: 'var(--surface-base)', borderColor: 'rgb(255 255 255 / 15%)' }}
            />
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ background: 'conic-gradient(from 200deg, transparent 0deg, rgb(255 255 255 / 10%) 40deg, transparent 90deg)' }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative flex h-28 w-28 items-center justify-center rounded-full border border-dashed"
            style={{ borderColor: 'rgb(255 255 255 / 14%)' }}
          >
            <DiscIcon width={26} height={26} className="text-text-tertiary/50" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface ModCardProps {
  name: string
  version: string
  fileCount: number
  coverArt?: string
  isActive: boolean
  isBusy: boolean
  disabled: boolean
  onLaunch: () => void
}

/**
 * A mod's library entry, styled as a real game-launcher card rather than
 * a settings-style list row: cover art fills the card as its own banner
 * (not a small thumbnail) when available, with title/actions laid over a
 * gradient scrim for legibility — the same idiom Steam/Epic/Gen Launcher
 * itself use for a library entry. A mod with no dedicated cover falls
 * back to a plain flat card instead of borrowing another mod's art, so
 * "this has its own identity" stays honest.
 */
function ModCard({ name, version, fileCount, coverArt, isActive, isBusy, disabled, onLaunch }: ModCardProps) {
  return (
    <li
      className="border-hairline/60 relative flex h-32 items-end overflow-hidden rounded-2xl border"
      style={{ boxShadow: '0 6px 20px rgb(0 0 0 / 25%)' }}
    >
      {coverArt ? (
        <img src={coverArt} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="bg-surface-raised absolute inset-0" />
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(0deg, rgb(0 0 0 / 78%) 0%, rgb(0 0 0 / 30%) 55%, rgb(0 0 0 / 5%) 100%)' }}
      />
      {isActive && (
        <span className="border-accent/60 absolute top-3 left-3 flex items-center gap-1 rounded-full border bg-black/50 px-2 py-0.5 text-2xs text-white backdrop-blur-sm">
          <CheckIcon width={11} height={11} />
          Active
        </span>
      )}

      <div className="relative flex w-full items-end justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-white drop-shadow-sm">{name}</p>
          <p className="text-xs text-white/70">
            {version} — {fileCount} file(s)
          </p>
        </div>
        <Button
          type="button"
          variant="brand"
          size="pill-sm"
          disabled={disabled}
          onClick={onLaunch}
          className="shrink-0 rounded-lg"
        >
          {isBusy ? 'Launching…' : 'Launch'}
        </Button>
      </div>
    </li>
  )
}
