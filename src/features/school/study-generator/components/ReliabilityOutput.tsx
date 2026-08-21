import { useMemo } from 'react'
import { parseReliabilityMarkers, countMarkers, MARKER_LABEL } from '../lib/reliabilityMarkers'

interface ReliabilityOutputProps {
  text: string
}

/**
 * Renders generated output with inline reliability flags visible —
 * uncertain claims and externally-sourced facts (see
 * lib/reliabilityMarkers.ts) get a distinct highlighted span with a
 * tooltip, everything else renders as plain text (assumed grounded in
 * the provided source material / knowledge base).
 */
export function ReliabilityOutput({ text }: ReliabilityOutputProps) {
  const segments = useMemo(() => parseReliabilityMarkers(text), [text])
  const counts = useMemo(() => countMarkers(segments), [segments])
  const hasFlags = counts.uncertain > 0 || counts.external > 0

  return (
    <div className="flex flex-col gap-2">
      {hasFlags && (
        <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
          {counts.uncertain > 0 && (
            <span className="bg-warning/15 text-warning rounded-full px-2 py-0.5 font-medium">
              {counts.uncertain} uncertain
            </span>
          )}
          {counts.external > 0 && (
            <span className="bg-brand-cyan/15 text-brand-cyan rounded-full px-2 py-0.5 font-medium">
              {counts.external} from general knowledge
            </span>
          )}
          <span className="text-text-tertiary">Hover a highlighted span for details.</span>
        </div>
      )}
      <pre className="text-text-secondary font-sans text-[11.5px] leading-relaxed whitespace-pre-wrap">
        {segments.map((seg, i) =>
          seg.marker ? (
            <span
              key={i}
              title={MARKER_LABEL[seg.marker]}
              className={`cursor-help rounded-[3px] px-0.5 ${
                seg.marker === 'uncertain'
                  ? 'bg-warning/20 decoration-warning underline decoration-dotted underline-offset-2'
                  : 'bg-brand-cyan/20 decoration-brand-cyan underline decoration-dotted underline-offset-2'
              }`}
            >
              {seg.text}
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </pre>
    </div>
  )
}
