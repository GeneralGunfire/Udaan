import type { SearchResult, SearchResultKind } from '../lib/types'
import { TaskIcon, BellIcon, FileTextIcon } from '@/shared/icons'

const ICON_BY_KIND: Record<SearchResultKind, React.ComponentType<{ width?: number; height?: number; className?: string }>> = {
  task: TaskIcon,
  notification: BellIcon,
  document: FileTextIcon,
}

interface SearchResultsDropdownProps {
  results: SearchResult[]
  loading: boolean
  query: string
  onSelect: (result: SearchResult) => void
}

export function SearchResultsDropdown({ results, loading, query, onSelect }: SearchResultsDropdownProps) {
  if (!query.trim()) return null

  return (
    <div
      className="glass-surface absolute top-13 right-0 z-30 max-h-96 w-80 overflow-y-auto rounded-2xl p-1.5 backdrop-blur-2xl"
      style={{ boxShadow: 'var(--shadow-panel)' }}
    >
      {loading ? (
        <p className="text-text-tertiary px-3 py-3 text-[11.5px]">Searching…</p>
      ) : results.length === 0 ? (
        <p className="text-text-tertiary px-3 py-3 text-[11.5px]">No matches for "{query}".</p>
      ) : (
        results.map((r) => {
          const Icon = ICON_BY_KIND[r.kind]
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r)}
              className="hover:bg-glass-hover flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors duration-150"
            >
              <Icon width={13} height={13} className="text-text-tertiary mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-text-primary truncate text-[12px] font-medium">{r.title}</p>
                <p className="text-text-tertiary truncate text-[10.5px]">{r.subtitle}</p>
              </div>
            </button>
          )
        })
      )}
    </div>
  )
}
