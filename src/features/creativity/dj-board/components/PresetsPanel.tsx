import { useState } from 'react'
import type { BoardPreset } from '../lib/presets'
import { PlusIcon } from '@/shared/icons'

interface PresetsPanelProps {
  presets: BoardPreset[]
  onSave: (name: string) => void
  onLoad: (preset: BoardPreset) => void
  onDelete: (id: string) => void
}

/** Named save/load slots for deck settings (EQ/bass/filter/volume/tempo/crossfader) — not track/playback state, which is auto-restored separately (see boardSession.ts). */
export function PresetsPanel({ presets, onSave, onLoad, onDelete }: PresetsPanelProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed)
    setName('')
    setOpen(false)
  }

  return (
    <div className="glass-surface flex flex-col gap-2 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <span className="text-text-secondary text-[11px] font-semibold">Presets</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-text-tertiary hover:text-text-secondary flex items-center gap-1 text-[10px] font-medium"
        >
          <PlusIcon width={10} height={10} />
          Save current
        </button>
      </div>

      {open && (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Preset name"
            autoFocus
            className="border-glass-border bg-glass text-text-primary min-w-0 flex-1 rounded-md border px-2 py-1 text-[10.5px]"
          />
          <button
            type="button"
            onClick={submit}
            className="text-white rounded-md px-2 py-1 text-[10.5px] font-medium"
            style={{ background: 'var(--gradient-brand)' }}
          >
            Save
          </button>
        </div>
      )}

      {presets.length === 0 ? (
        <p className="text-text-tertiary text-[10px]">
          No saved presets yet — set up your decks the way you like, then save.
        </p>
      ) : (
        <ul className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
          {presets.map((p) => (
            <li key={p.id} className="group flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onLoad(p)}
                className="text-text-secondary hover:text-text-primary hover:bg-glass-hover min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-[10.5px]"
              >
                {p.name}
              </button>
              <button
                type="button"
                onClick={() => onDelete(p.id)}
                aria-label={`Delete preset ${p.name}`}
                className="text-text-tertiary hover:text-danger px-1 text-[11px] opacity-0 group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
