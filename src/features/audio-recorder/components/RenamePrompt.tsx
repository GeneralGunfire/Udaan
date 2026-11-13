import { useState } from 'react'
import { CheckIcon } from '@/shared/icons'
import { Input } from '@/shared/components/ui/input'

interface RenamePromptProps {
  defaultName: string
  saving: boolean
  onConfirm: (name: string) => void
  onSkip: () => void
}

/** Shown immediately after a recording stops — lets the user replace the
 * default timestamp filename with a real name before the file is
 * considered "done." Skipping keeps the timestamp name as-is. */
export function RenamePrompt({ defaultName, saving, onConfirm, onSkip }: RenamePromptProps) {
  const [name, setName] = useState(defaultName)

  return (
    <div className="border-hairline bg-surface-raised flex w-full max-w-sm flex-col gap-3 rounded-xl border px-5 py-4">
      <p className="text-text-primary text-sm font-medium">Name this recording</p>
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onConfirm(name)
          if (e.key === 'Escape') onSkip()
        }}
        onFocus={(e) => e.target.select()}
        disabled={saving}
        
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={saving}
          className="text-text-secondary hover:text-text-primary rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          Keep default name
        </button>
        <button
          type="button"
          onClick={() => name.trim() && onConfirm(name)}
          disabled={saving || !name.trim()}
          className="bg-brand-blue hover:bg-brand-cyan flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-40"
        >
          <CheckIcon width={13} height={13} />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
