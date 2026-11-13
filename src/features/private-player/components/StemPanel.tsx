import { useEffect, useState } from 'react'
import { stemStatus, separateStems, type StemStatus } from '@/integrations/audio-library/client'
import { STEM_NAMES, STEM_LABELS, type StemName } from '../lib/stems'
import type { AudioTrack } from '../lib/types'

interface StemPanelProps {
  track: AudioTrack | null
  side: 'A' | 'B'
}

/**
 * Per-stem mute/solo for a deck.
 *
 * Honest about its own state: separation is not implemented yet (the
 * model is not shipped — see src-tauri/audio_library/stems.rs), so rather
 * than showing four dead buttons this reports what is actually true and
 * why. A control that looks live but does nothing is worse than an
 * explicit "not available yet", because the user spends time working out
 * whether they broke it.
 *
 * The mute/solo controls are rendered in their real form and disabled, so
 * that when stems land the layout does not change — only the disabled
 * state lifts.
 */
export function StemPanel({ track, side }: StemPanelProps) {
  const [status, setStatus] = useState<StemStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState<Set<StemName>>(new Set())
  const [soloed, setSoloed] = useState<Set<StemName>>(new Set())

  useEffect(() => {
    if (!track) {
      setStatus(null)
      return
    }
    let cancelled = false
    stemStatus(track.path)
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {
        // A status check failing is not worth an error banner — it just
        // means stems are unavailable, which is the default state anyway.
        if (!cancelled) setStatus(null)
      })
    return () => {
      cancelled = true
    }
  }, [track?.path])

  const ready = status?.kind === 'ready'

  async function handleSeparate() {
    if (!track) return
    setBusy(true)
    setError(null)
    try {
      await separateStems(track.path)
      const next = await stemStatus(track.path)
      setStatus(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function toggle(set: Set<StemName>, name: StemName, apply: (s: Set<StemName>) => void) {
    const next = new Set(set)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    apply(next)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-text-tertiary text-3xs font-semibold tracking-widest uppercase">Stems</span>
        {status?.kind === 'modelMissing' && (
          <span className="text-text-tertiary text-3xs">~{status.approxDownloadMb}MB download</span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1">
        {STEM_NAMES.map((name) => {
          const isMuted = muted.has(name)
          const isSoloed = soloed.has(name)
          return (
            <div key={name} className="flex flex-col items-center gap-1">
              <span className="text-text-tertiary text-3xs">{STEM_LABELS[name]}</span>
              <div className="flex gap-0.5">
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => toggle(muted, name, setMuted)}
                  aria-pressed={isMuted}
                  title={`Mute ${STEM_LABELS[name]}`}
                  className={`rounded px-1.5 py-0.5 text-3xs font-bold transition-colors disabled:opacity-30 ${
                    isMuted ? 'bg-danger text-white' : 'bg-white/8 text-text-tertiary hover:bg-white/12'
                  }`}
                >
                  M
                </button>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => toggle(soloed, name, setSoloed)}
                  aria-pressed={isSoloed}
                  title={`Solo ${STEM_LABELS[name]}`}
                  className="rounded px-1.5 py-0.5 text-3xs font-bold transition-colors disabled:opacity-30"
                  style={{
                    backgroundColor: isSoloed
                      ? side === 'A'
                        ? 'var(--color-brand-blue)'
                        : 'var(--color-brand-cyan)'
                      : 'rgb(255 255 255 / 8%)',
                    color: isSoloed ? '#fff' : 'var(--color-text-tertiary)',
                  }}
                >
                  S
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {!ready && (
        <button
          type="button"
          onClick={handleSeparate}
          disabled={!track || busy}
          className="border-hairline text-text-secondary hover:text-text-primary rounded-full border px-3 py-1 text-2xs-alt font-medium transition-colors disabled:opacity-30"
        >
          {busy ? 'Separating…' : status?.kind === 'modelMissing' ? 'Download model' : 'Separate stems'}
        </button>
      )}

      {error && (
        <p className="text-text-tertiary text-3xs leading-snug" role="status">
          {error}
        </p>
      )}
    </div>
  )
}
