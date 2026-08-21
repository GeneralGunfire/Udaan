import { GlassPanel } from '@/shared/components/GlassPanel'

/** Placeholder entry point for the Work category. No feature logic yet. */
export function WorkView() {
  return (
    <GlassPanel>
      <h1 className="text-lg font-medium">Work</h1>
      <p className="text-text-secondary mt-1 text-sm">
        Task queue, projects, and orchestration tools will live here.
      </p>
    </GlassPanel>
  )
}
