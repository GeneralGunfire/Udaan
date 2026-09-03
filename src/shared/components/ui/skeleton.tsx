import { cn } from '@/shared/lib/cn'

/**
 * Shape-matched loading placeholder.
 *
 * Replaces bare "Loading…" text, which has two costs: it tells the user
 * nothing about what is arriving, and it occupies a different amount of
 * space than the real content, so the layout jumps when data lands. A
 * skeleton sized like the thing it stands in for avoids both — the page
 * settles into its final shape immediately and only the detail fills in.
 *
 * The shimmer is a single CSS gradient sweep (see `.skeleton-shimmer` in
 * theme.css) rather than a JS animation, so a list of thirty skeletons
 * costs one compositor animation rather than thirty React components
 * driving frames. It stops entirely under `prefers-reduced-motion`.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('skeleton-shimmer rounded-md bg-[var(--surface-raised)]', className)}
      {...props}
    />
  )
}

/**
 * Several skeleton lines standing in for a paragraph. The last line is
 * short, the way a real final line of text rarely reaches the margin —
 * uniform full-width bars read as a placeholder grid rather than as text.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  )
}
