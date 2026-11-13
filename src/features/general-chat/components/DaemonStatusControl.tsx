import { AnimatePresence } from 'framer-motion'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '@/shared/components/ui/dialog'
import { WindowCloseIcon } from '@/shared/icons'

/** Minimal shape both `useOllamaControl` and `useOmniRouteControl` satisfy. */
export interface DaemonControl {
  running: boolean
  startedByApp: boolean
  pending: boolean
  start: () => void
  stop: () => void
}

interface DaemonStatusControlProps {
  daemonLabel: string
  /** e.g. "ollama serve" / "omniroute serve --daemon" — shown in the idle-state explainer. */
  startCommandLabel: string
  historyDescription: string
  control: DaemonControl
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Status text + control dialog for a locally-managed daemon (Ollama,
 * OmniRoute) that backs General Chat — start/stop it without a separate
 * terminal. Flat, quiet trigger: a dot and a line of text, no pill chrome,
 * no pulsing glow — status is information, not a thing to draw the eye.
 */
export function DaemonStatusControl({
  daemonLabel,
  startCommandLabel,
  historyDescription,
  control,
  open,
  onOpenChange,
}: DaemonStatusControlProps) {
  const { running, startedByApp, pending, start, stop } = control
  const statusLabel = pending ? (running ? 'Stopping…' : 'Starting…') : running ? 'Running' : 'Stopped'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`${daemonLabel} status and controls`}
          className="text-text-tertiary hover:text-text-primary flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-success' : 'bg-text-tertiary/50'}`} />
          {daemonLabel}
        </button>
      </DialogTrigger>

      <AnimatePresence>
        {open && (
          <DialogContent className="max-w-sm p-0">
            <div className="border-hairline flex items-center justify-between border-b px-4 py-3">
              <DialogTitle className="text-text-primary text-sm font-semibold">{daemonLabel}</DialogTitle>
              <Button type="button" aria-label="Close" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} className="rounded-lg">
                <WindowCloseIcon width={11} height={11} />
              </Button>
            </div>

            <div className="flex flex-col gap-3 px-4 py-4">
              <DialogDescription className="text-text-tertiary text-xs">{historyDescription}</DialogDescription>

              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Status</span>
                <span className="text-text-primary">{statusLabel}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Managed by</span>
                <span className="text-text-primary">{running ? (startedByApp ? 'Udaan' : 'External process') : '—'}</span>
              </div>

              <p className="text-text-tertiary text-xs leading-relaxed">
                {running
                  ? `Stops the local "${startCommandLabel}" process.`
                  : `Starts "${startCommandLabel}" locally in the background.`}
              </p>

              <Button
                type="button"
                variant={running ? 'danger' : 'secondary'}
                disabled={pending}
                onClick={() => (running ? stop() : start())}
                className="w-full justify-center rounded-lg"
              >
                {pending ? (running ? 'Stopping…' : 'Starting…') : running ? `Stop ${daemonLabel}` : `Start ${daemonLabel}`}
              </Button>
            </div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
