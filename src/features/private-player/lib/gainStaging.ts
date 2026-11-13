import type { TrackAnalysis } from '@/integrations/audio-library/client'

/**
 * Automatic gain staging — making tracks mastered decades apart sit at
 * comparable loudness without hand-riding the trim knob before every mix.
 *
 * This is the practical half of blueprint §6. The other half — "decode to
 * 32-bit float, keep headroom" — is already true by construction: the Web
 * Audio API is float throughout, so there is no intermediate integer
 * stage to clip against. What is left is the part that actually needs
 * deciding: what gain to suggest for a given track.
 *
 * The suggestion is based on RMS rather than peak. A 1970s master and a
 * modern one can share an identical peak (both normalised to roughly
 * 0 dBFS) while differing by 10dB or more in perceived loudness, because
 * the modern one is compressed far harder. Matching peaks would therefore
 * do nothing about the problem; matching RMS is what actually equalises
 * how loud two tracks sound.
 */

/**
 * Target RMS the trim suggestion aims for, in dBFS.
 *
 * -14 dBFS RMS is roughly where streaming platforms normalise, which
 * makes it a reasonable common denominator for a mixed-era library — and
 * it leaves useful headroom above for the master limiter to work with.
 * Aiming for something hot like -9 would mean quiet old records get
 * pushed into the limiter constantly.
 */
const TARGET_RMS_DBFS = -14

/**
 * Bounds on the suggestion, matching the trim knob's own range.
 *
 * Beyond this the suggestion is not applicable anyway, and a very quiet
 * recording (a field recording, a lecture) would otherwise be handed a
 * +30dB suggestion that would deafen the user and amplify its noise floor
 * along with the content.
 */
const MIN_SUGGESTION_DB = -12
const MAX_SUGGESTION_DB = 12

/** Guard against amplifying a track into clipping. A suggestion that
 * would push the existing peak past this is reduced until it does not —
 * loudness matching must never cost headroom. */
const PEAK_CEILING_DBFS = -1

export interface GainSuggestion {
  /** dB to apply at the deck's trim. */
  gainDb: number
  /** Why this value, in one line, for the UI to show on hover. Users
   * distrust a number that appears with no explanation, and rightly. */
  reason: string
  /** True when the peak ceiling reduced the RMS-matched value — the
   * track cannot reach target loudness without clipping, which usually
   * means it is already heavily limited. */
  limitedByPeak: boolean
}

/**
 * Suggests a trim for one track. Returns null when analysis is missing or
 * carries no usable level data — better to offer nothing than to offer a
 * number derived from an empty measurement.
 */
export function suggestGain(analysis: TrackAnalysis | null): GainSuggestion | null {
  if (!analysis) return null
  const { rms, peak } = analysis
  if (!Number.isFinite(rms) || rms <= 0) return null

  const rmsDb = 20 * Math.log10(rms)
  const wanted = TARGET_RMS_DBFS - rmsDb

  // How much gain the track can take before its peak hits the ceiling.
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity
  const headroom = Number.isFinite(peakDb) ? PEAK_CEILING_DBFS - peakDb : MAX_SUGGESTION_DB

  const capped = Math.min(wanted, headroom)
  const clamped = Math.max(MIN_SUGGESTION_DB, Math.min(MAX_SUGGESTION_DB, capped))
  const limitedByPeak = capped < wanted - 0.1

  const rounded = Number(clamped.toFixed(1))
  const reason = limitedByPeak
    ? `Would need ${wanted.toFixed(1)}dB to reach ${TARGET_RMS_DBFS} dBFS, capped at ${rounded}dB to keep peaks under ${PEAK_CEILING_DBFS} dBFS`
    : `Track sits at ${rmsDb.toFixed(1)} dBFS RMS; ${rounded > 0 ? '+' : ''}${rounded}dB brings it to ${TARGET_RMS_DBFS} dBFS`

  return { gainDb: rounded, reason, limitedByPeak }
}

/**
 * The trim offset that would match deck B's loudness to deck A's,
 * independent of any absolute target.
 *
 * Distinct from `suggestGain` on purpose: matching the two decks to each
 * other is what matters during a transition, and it is a different
 * question from bringing both to a reference level. Returns null when
 * either track lacks analysis.
 */
export function matchLoudness(from: TrackAnalysis | null, to: TrackAnalysis | null): number | null {
  if (!from || !to) return null
  if (from.rms <= 0 || to.rms <= 0) return null
  const diff = 20 * Math.log10(from.rms / to.rms)
  if (!Number.isFinite(diff)) return null
  return Number(Math.max(MIN_SUGGESTION_DB, Math.min(MAX_SUGGESTION_DB, diff)).toFixed(1))
}
