import { useEffect, useRef, useState } from 'react'
import { ChevronRightIcon } from '@/shared/icons'
import { breadcrumbSegments } from '../lib/pathUtils'
import { Input } from '@/shared/components/ui/input'

interface BreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
}

/** Windows-style breadcrumb path bar — clickable segments, click-to-edit like the real address bar. */
export function Breadcrumb({ path, onNavigate }: BreadcrumbProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(path)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(path)
  }, [path, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  if (editing) {
    return (
      <form
        className="flex min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = draft.trim()
          if (trimmed) onNavigate(trimmed)
          setEditing(false)
        }}
      >
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(path)
              setEditing(false)
            }
          }}
          inputSize="sm"
          className="h-8 min-w-0 flex-1"
        />
      </form>
    )
  }

  const segments = breadcrumbSegments(path)

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="hover:bg-(--os-hover) flex h-8 min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg px-2 text-left transition-colors duration-150"
      aria-label="Edit address"
    >
      {segments.map((seg, i) => (
        <span key={seg.path} className="flex shrink-0 items-center gap-1">
          {i > 0 && <ChevronRightIcon width={12} height={12} className="text-text-tertiary shrink-0" />}
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(seg.path)
            }}
            className="text-text-secondary hover:text-text-primary hover:bg-(--os-hover) rounded px-1.5 py-1 text-sm transition-colors duration-150"
          >
            {seg.name}
          </span>
        </span>
      ))}
    </button>
  )
}
