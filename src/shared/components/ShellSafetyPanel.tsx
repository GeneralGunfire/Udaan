import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog'
import { Button } from './ui/button'
import { cn } from '@/shared/lib/cn'
import {
  shellStatus,
  shellBackupCurrentValue,
  shellRestoreDefault,
  shellSetToUdaan,
  type ShellStatus,
} from '@/integrations/shell-replace/client'

export interface ShellSafetyPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * "Safe Mode" escape hatch for the shell-replacement feature — this is the
 * in-app half of the safety infrastructure described in
 * src-tauri/src/shell_replace/mod.rs. Independent of whether Udaan is
 * actually registered as the shell yet: `status`/`backup` are always safe
 * to call, and `restore` is a no-op-safe way to confirm the mechanism
 * works — it just re-asserts whatever the correct shell value already is.
 *
 * Manual recovery (documented here too, not just in the Rust module, since
 * this is the one place the panel itself might not be reachable from):
 *   1. Ctrl+Shift+Esc → Task Manager → File → Run new task → `explorer.exe`.
 *      This alone gets you a working desktop, no registry edit needed.
 *   2. To make it permanent: Run new task → `regedit` → go to
 *      HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon
 *      → set `Shell` back to `explorer.exe`.
 *   3. If Task Manager won't open: boot Safe Mode (hold Shift while
 *      clicking Restart), open Command Prompt, run:
 *      reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /t REG_SZ /d explorer.exe /f
 */
export function ShellSafetyPanel({ open, onOpenChange }: ShellSafetyPanelProps) {
  const [status, setStatus] = useState<ShellStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'backup' | 'restore' | 'switch' | null>(null)
  const [confirmingRestore, setConfirmingRestore] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const [confirmingSwitch, setConfirmingSwitch] = useState(false)
  const [switchAcknowledgeText, setSwitchAcknowledgeText] = useState('')
  const [switchMessage, setSwitchMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setRestoreMessage(null)
    setConfirmingRestore(false)
    setConfirmingSwitch(false)
    setSwitchAcknowledgeText('')
    setSwitchMessage(null)
    shellStatus()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read shell status.'))
  }, [open])

  async function handleBackup() {
    setBusy('backup')
    setError(null)
    try {
      const next = await shellBackupCurrentValue()
      setStatus(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a backup.')
    } finally {
      setBusy(null)
    }
  }

  async function handleRestore() {
    setBusy('restore')
    setError(null)
    setRestoreMessage(null)
    try {
      await shellRestoreDefault()
      const next = await shellStatus()
      setStatus(next)
      setRestoreMessage('Shell setting restored, and explorer.exe was relaunched.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore the shell setting.')
    } finally {
      setBusy(null)
      setConfirmingRestore(false)
    }
  }

  const CONFIRM_PHRASE = 'set udaan as my shell'

  async function handleSwitch() {
    setBusy('switch')
    setError(null)
    setSwitchMessage(null)
    try {
      const next = await shellSetToUdaan()
      setStatus(next)
      setSwitchMessage(
        'Udaan is now set as your Windows shell. This takes effect on your NEXT login or restart — nothing changes on this session. If anything goes wrong, shell-watchdog will fall back to explorer.exe automatically, or use "Restore default shell now" above.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set Udaan as the shell.')
    } finally {
      setBusy(null)
      setConfirmingSwitch(false)
      setSwitchAcknowledgeText('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogContent className="max-w-md">
            <DialogTitle className="font-display text-text-primary text-base font-semibold">
              Windows Shell Safety
            </DialogTitle>
            <DialogDescription className="text-text-tertiary mt-1 text-xs">
              Controls for the experimental "Udaan as your Windows shell" feature. Safe to open
              anytime — nothing here changes anything until you press a button.
            </DialogDescription>

            <div className="mt-4 flex flex-col gap-3">
              {status && (
                <div className="bg-white/5 flex flex-col gap-2 rounded-xl px-3.5 py-3 text-xs">
                  <Row label="Current shell" value={status.currentShellValue} />
                  <Row
                    label="Udaan is shell"
                    value={status.udaanIsShell ? 'Yes' : 'No'}
                    tone={status.udaanIsShell ? 'warning' : undefined}
                  />
                  <Row label="Backup exists" value={status.hasBackup ? 'Yes' : 'No'} />
                  <Row label="Running as Administrator" value={status.isElevated ? 'Yes' : 'No'} />
                </div>
              )}

              <p className="text-text-tertiary text-2xs">
                To switch between the Windows and Udaan taskbars, use the toggle in the top bar
                (next to this gear icon) — it swaps both at once.
              </p>

              {error && <p className="text-danger text-xs">{error}</p>}
              {restoreMessage && <p className="text-success text-xs">{restoreMessage}</p>}

              <div className="flex flex-col gap-2">
                <Button
                  variant="surface"
                  size="pill"
                  onClick={handleBackup}
                  disabled={busy !== null}
                  className="w-full justify-center"
                >
                  {busy === 'backup' ? 'Backing up…' : 'Back up current shell setting'}
                </Button>

                {!confirmingRestore ? (
                  <Button
                    variant="danger"
                    size="pill"
                    onClick={() => setConfirmingRestore(true)}
                    disabled={busy !== null}
                    className="w-full justify-center"
                  >
                    Restore default shell now
                  </Button>
                ) : (
                  <div className="border-danger/30 flex flex-col gap-2 rounded-xl border p-3">
                    <p className="text-text-secondary text-xs">
                      This sets the shell registry value back and relaunches explorer.exe
                      immediately. May ask for Administrator permission.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="pill-sm"
                        onClick={() => setConfirmingRestore(false)}
                        className="flex-1 justify-center"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        size="pill-sm"
                        onClick={handleRestore}
                        disabled={busy !== null}
                        className="flex-1 justify-center"
                      >
                        {busy === 'restore' ? 'Restoring…' : 'Yes, restore now'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {switchMessage && <p className="text-success text-xs">{switchMessage}</p>}

              <div className="border-warning/30 flex flex-col gap-2 rounded-xl border p-3">
                <p className="text-text-primary text-xs font-medium">
                  Set Udaan as your Windows shell
                </p>
                <p className="text-text-tertiary text-2xs">
                  Replaces explorer.exe as your Windows login shell on your NEXT login/restart —
                  not immediately. shell-watchdog will fall back to explorer.exe automatically if
                  Udaan crashes or fails to start.
                </p>

                {!confirmingSwitch ? (
                  <Button
                    variant="danger"
                    size="pill"
                    onClick={() => setConfirmingSwitch(true)}
                    disabled={busy !== null}
                    className="w-full justify-center"
                  >
                    Set Udaan as shell…
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-text-secondary text-xs">
                      Type <span className="text-text-primary font-medium">{CONFIRM_PHRASE}</span>{' '}
                      to confirm. This takes effect at your next login — you can revert it anytime
                      with "Restore default shell now" above, or with the manual recovery steps
                      below if this panel is ever unreachable.
                    </p>
                    <input
                      value={switchAcknowledgeText}
                      onChange={(e) => setSwitchAcknowledgeText(e.target.value)}
                      placeholder={CONFIRM_PHRASE}
                      className="border-hairline bg-white/5 text-text-primary placeholder:text-text-tertiary rounded-lg border px-3 py-2 text-xs outline-none focus:border-white/30"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="pill-sm"
                        onClick={() => {
                          setConfirmingSwitch(false)
                          setSwitchAcknowledgeText('')
                        }}
                        className="flex-1 justify-center"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        size="pill-sm"
                        onClick={handleSwitch}
                        disabled={busy !== null || switchAcknowledgeText.trim().toLowerCase() !== CONFIRM_PHRASE}
                        className="flex-1 justify-center"
                      >
                        {busy === 'switch' ? 'Setting…' : 'Confirm'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <details className="text-text-tertiary text-2xs">
                <summary className="cursor-pointer select-none">
                  Manual recovery (if this panel is ever unreachable)
                </summary>
                <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-4">
                  <li>
                    Press <span className="text-text-secondary font-medium">Ctrl+Shift+Esc</span> →
                    Task Manager → File → Run new task → type{' '}
                    <span className="text-text-secondary font-medium">explorer.exe</span>. This
                    alone restores a working desktop.
                  </li>
                  <li>
                    To make it permanent: Run new task → <span className="text-text-secondary font-medium">regedit</span> →
                    go to{' '}
                    <span className="text-text-secondary font-medium">
                      HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon
                    </span>{' '}
                    → set <span className="text-text-secondary font-medium">Shell</span> to{' '}
                    <span className="text-text-secondary font-medium">explorer.exe</span>.
                  </li>
                  <li>
                    If Task Manager won't open: boot Safe Mode (hold Shift while clicking Restart),
                    open Command Prompt, and run:{' '}
                    <code className="text-text-secondary block break-all">
                      reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell
                      /t REG_SZ /d explorer.exe /f
                    </code>
                  </li>
                </ol>
              </details>
            </div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'warning'
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-tertiary">{label}</span>
      <span className={cn('font-medium', tone === 'warning' ? 'text-warning' : 'text-text-primary')}>
        {value}
      </span>
    </div>
  )
}
