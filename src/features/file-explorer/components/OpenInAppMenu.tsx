import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/shared/components/ui/dropdown-menu'
import { Button } from '@/shared/components/ui/button'
import { ChevronRightIcon } from '@/shared/icons'
import { useOpenWithHandlers } from '../hooks/useOpenWithHandlers'
import type { FileHandler } from '@/integrations/installed-apps/types'

interface OpenInAppMenuProps {
  extension: string
  /** Called with the chosen handler's exe path, or `null` for "just use the default/best-effort open". */
  onChoose: (exePath: string | null) => void
  label?: string
}

/**
 * "Open in App ▾" control — clicking it opens a small picker (default app
 * first, then every other OS-registered handler for the extension) so
 * opening a file externally is always an explicit, confirmed choice of
 * which app, not a silent guess.
 */
export function OpenInAppMenu({ extension, onChoose, label = 'Open in App' }: OpenInAppMenuProps) {
  const [open, setOpen] = useState(false)
  const handlers = useOpenWithHandlers(open ? extension : null)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="brand" size="pill-sm">
          {label} <ChevronRightIcon width={12} height={12} className="rotate-90" />
        </Button>
      </DropdownMenuTrigger>
      <AnimatePresence>
        {open && (
          <DropdownMenuContent align="center" className="w-56 p-1">
            {handlers.length === 0 && (
              <DropdownMenuItem onSelect={() => onChoose(null)}>Use system default</DropdownMenuItem>
            )}
            {handlers.map((handler: FileHandler) => (
              <DropdownMenuItem key={handler.exePath} onSelect={() => onChoose(handler.exePath)}>
                {handler.name}
                {handler.isDefault && <span className="text-text-tertiary ml-auto text-2xs-alt">Default</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        )}
      </AnimatePresence>
    </DropdownMenu>
  )
}
