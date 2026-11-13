import { AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import type { ConflictMode } from '@/integrations/file-explorer/types'

interface ConflictDialogProps {
  open: boolean
  conflictCount: number
  onResolve: (mode: ConflictMode) => void
  onCancel: () => void
}

/** Shown before a copy/move that would overwrite an existing file — never silently clobbers or drops files. */
export function ConflictDialog({ open, conflictCount, onResolve, onCancel }: ConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AnimatePresence>
        {open && (
          <DialogContent>
            <DialogTitle className="text-text-primary text-base font-semibold">
              {conflictCount === 1 ? 'An item with this name already exists' : `${conflictCount} items already exist here`}
            </DialogTitle>
            <DialogDescription className="text-text-secondary mt-1.5 text-sm">
              Choose what to do with the {conflictCount === 1 ? 'conflicting item' : 'conflicting items'}.
            </DialogDescription>
            <div className="mt-5 flex flex-col gap-2">
              <Button type="button" variant="surface" size="pill" onClick={() => onResolve('keep_both')} className="justify-start">
                Keep both (add a number)
              </Button>
              <Button type="button" variant="surface" size="pill" onClick={() => onResolve('overwrite')} className="justify-start">
                Overwrite the existing {conflictCount === 1 ? 'item' : 'items'}
              </Button>
              <Button type="button" variant="surface" size="pill" onClick={() => onResolve('skip')} className="justify-start">
                Skip {conflictCount === 1 ? 'this item' : 'these items'}
              </Button>
            </div>
            <div className="mt-4 flex justify-end">
              <Button type="button" variant="ghost" size="pill" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
