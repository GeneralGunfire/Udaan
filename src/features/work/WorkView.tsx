import { GlassPanel } from '@/shared/components/GlassPanel'

/** Placeholder entry point for the Work category. No feature logic yet. */
export function WorkView() {
  return (
    <GlassPanel>
      <h1 className="text-lg font-medium">Work</h1>
      <p className="text-text-secondary mt-1 text-sm">
        Work-specific tools (projects, proposals, client tracking) will live
        here. For queued Claude Code runs, see Task Queue under General in
        the sidebar — that's a cross-cutting tool shared by every category,
        not something Work builds its own copy of.
      </p>
    </GlassPanel>
  )
}
