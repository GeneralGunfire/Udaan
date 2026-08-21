import type { PropsWithChildren } from 'react'

interface GlassPanelProps {
  className?: string
}

/** Base floating glass surface. Category modules and dialogs compose this. */
export function GlassPanel({
  className = '',
  children,
}: PropsWithChildren<GlassPanelProps>) {
  return (
    <div className={`glass-surface rounded-lg p-5 ${className}`}>
      {children}
    </div>
  )
}
