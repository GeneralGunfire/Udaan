import { open } from '@tauri-apps/plugin-dialog'
import { BookOpenIcon, UploadIcon } from '@/shared/icons'

interface EmptyStateProps {
  onFileSelected: (path: string) => void
  errorMessage?: string | null
}

export function EmptyState({ onFileSelected, errorMessage }: EmptyStateProps) {
  async function handleBrowse() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Documents', extensions: ['txt', 'md', 'markdown', 'pdf', 'docx'] }],
    })
    if (typeof selected === 'string') onFileSelected(selected)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="text-text-tertiary">
        <BookOpenIcon width={48} height={48} />
      </div>
      <div>
        <h2 className="text-text-primary text-lg font-medium">Document Reader</h2>
        <p className="text-text-secondary mt-1 max-w-sm text-sm">
          Open a document to get started — Udaan will read it aloud with a local, offline voice.
        </p>
      </div>
      <button
        type="button"
        onClick={handleBrowse}
        className="bg-brand-blue hover:bg-brand-cyan mt-2 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-white transition-colors"
      >
        <UploadIcon width={16} height={16} />
        Open document
      </button>
      <p className="text-text-tertiary text-xs">Supports .txt, .md, .pdf, and .docx</p>
      {errorMessage && (
        <p className="mt-2 max-w-md rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
