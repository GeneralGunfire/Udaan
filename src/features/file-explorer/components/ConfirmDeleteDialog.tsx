import { AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'

interface ConfirmDeleteDialogProps {
  open: boolean
  count: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ConfirmDeleteDialog({ open, count, onOpenChange, onConfirm }: ConfirmDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogContent>
            <DialogTitle className="text-text-primary text-base font-semibold">
              Delete {count === 1 ? 'this item' : `${count} items`}?
            </DialogTitle>
            <DialogDescription className="text-text-secondary mt-1.5 text-sm">
              This can't be undone. {count === 1 ? 'The item' : 'These items'} will be permanently deleted.
            </DialogDescription>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" size="pill" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                size="pill"
                onClick={() => {
                  onConfirm()
                  onOpenChange(false)
                }}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
