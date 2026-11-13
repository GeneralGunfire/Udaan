interface ResumePromptProps {
  onResume: () => void
  onStartOver: () => void
}

/** Shown when a document has a saved reading position from a previous session — offers to pick up where the user left off rather than silently restarting or silently resuming (either extreme would surprise the user). */
export function ResumePrompt({ onResume, onStartOver }: ResumePromptProps) {
  return (
    <div className="absolute inset-x-0 top-4 z-10 flex justify-center px-4">
      <div className="glass-surface border-hairline flex items-center gap-3 rounded-full border px-4 py-2 shadow-lg">
        <span className="text-text-secondary text-sm">You left off partway through this document.</span>
        <button
          type="button"
          onClick={onResume}
          className="bg-accent text-accent-contrast rounded-full px-3 py-1 text-xs font-medium transition-transform active:scale-95"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="text-text-tertiary hover:text-text-primary rounded-full px-3 py-1 text-xs transition-colors"
        >
          Start over
        </button>
      </div>
    </div>
  )
}
