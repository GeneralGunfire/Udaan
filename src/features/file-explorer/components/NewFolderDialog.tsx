import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'

interface NewFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (name: string) => void
}

export function NewFolderDialog({ open, onOpenChange, onCreate }: NewFolderDialogProps) {
  const [name, setName] = useState('New folder')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName('New folder')
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [open])

  function submit() {
    const trimmed = name.trim()
    if (trimmed) {
      onCreate(trimmed)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogContent>
            <DialogTitle className="text-text-primary text-base font-semibold">New folder</DialogTitle>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <Input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-4"
              />
              <div className="mt-5 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="pill" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="brand" size="pill">
                  Create
                </Button>
              </div>
            </form>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
