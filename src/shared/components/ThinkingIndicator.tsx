import { useEffect, useState } from 'react'

/**
 * "Working on it" for AI replies: three pulsing dots, and after a few
 * seconds how long it has been, so a slow answer never looks frozen.
 */
export function ThinkingIndicator({ label = 'Thinking' }: { label?: string }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-2.5 py-1 text-[13px] text-[var(--color-text-secondary)]">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-text-secondary)]" style={{ animationDelay: `${i * 180}ms` }} />
        ))}
      </span>
      {seconds >= 5 && (
        <span className="tabular-nums">
          {label}… {seconds}s{seconds >= 15 ? ' · longer answers can take up to a minute' : ''}
        </span>
      )}
    </span>
  )
}
