import { GlassPanel } from '@/shared/components/GlassPanel'

interface PlaceholderViewProps {
  label: string
}

/** Generic stand-in so no nav item is a dead end before its real view exists. */
export function PlaceholderView({ label }: PlaceholderViewProps) {
  return (
    <GlassPanel>
      <h1 className="text-lg font-medium">{label}</h1>
      <p className="text-text-secondary mt-1 text-sm">
        This view doesn't exist yet — placeholder so navigation isn't a dead
        end.
      </p>
    </GlassPanel>
  )
}
