import type { TtsVoice } from '@/integrations/local-model/client'
import { Select } from '@/shared/components/ui/select'
import type { PlaybackStatus } from '../lib/playbackEngine'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

interface PlaybackControlsProps {
  status: PlaybackStatus
  voices: TtsVoice[]
  voiceId: string
  speed: number
  volume: number
  progressLabel: string
  sentenceIndex: number
  sentenceCount: number
  onSeek: (index: number) => void
  onTogglePlayPause: () => void
  onStop: () => void
  onSkipForwardSentence: () => void
  onSkipBackSentence: () => void
  onSkipForwardParagraph: () => void
  onSkipBackParagraph: () => void
  onVoiceChange: (id: string) => void
  onSpeedChange: (speed: number) => void
  onVolumeChange: (volume: number) => void
}

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d={d} />
    </svg>
  )
}

function Btn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-10 w-10 items-center justify-center rounded-full text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white active:scale-95">
      {children}
    </button>
  )
}

/** Reader transport: scrub bar, big play/pause, sentence and paragraph skips, speed chips, voice and volume. */
export function PlaybackControls(p: PlaybackControlsProps) {
  const playing = p.status === 'playing' || p.status === 'buffering'
  const pct = p.sentenceCount ? ((p.sentenceIndex + 1) / p.sentenceCount) * 100 : 0
  return (
    <div className="shrink-0 border-t border-white/[0.07] bg-[#232429] px-6 pb-4 pt-3">
      {/* Scrub bar: drag or click to jump anywhere in the document. */}
      <div className="flex items-center gap-3 text-[11.5px] tabular-nums text-white/45">
        <span className="w-12">{p.progressLabel.split(' / ')[0]}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, p.sentenceCount - 1)}
          value={p.sentenceIndex}
          onChange={(e) => p.onSeek(Number(e.target.value))}
          aria-label="Position in document"
          className="u-range flex-1"
          style={{ ['--pct' as string]: `${pct}%` }}
        />
        <span className="w-12 text-right">{p.sentenceCount}</span>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex items-center gap-1.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => p.onSpeedChange(s)}
              className={`h-7 rounded-full px-2.5 text-[12px] font-semibold transition-colors ${p.speed === s ? 'bg-white text-black' : 'text-white/55 hover:bg-white/[0.08] hover:text-white'}`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Btn label="Previous paragraph (Shift+←)" onClick={p.onSkipBackParagraph}>
            <Icon d="M6 6h2v12H6zM9.5 12 18 18V6z" />
          </Btn>
          <Btn label="Previous sentence (←)" onClick={p.onSkipBackSentence}>
            <Icon d="M11 18V6l-8.5 6zM20 18V6l-8.5 6z" size={16} />
          </Btn>
          <button
            type="button"
            aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            onClick={p.onTogglePlayPause}
            className="mx-2 flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-[0_6px_20px_rgb(0_0_0/0.35)] transition-transform hover:scale-105 active:scale-95"
          >
            {p.status === 'buffering' ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
            ) : playing ? (
              <Icon d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" size={22} />
            ) : (
              <Icon d="M8 5.5v13l10.5-6.5Z" size={24} />
            )}
          </button>
          <Btn label="Next sentence (→)" onClick={p.onSkipForwardSentence}>
            <Icon d="M13 6v12l8.5-6zM4 6v12l8.5-6z" size={16} />
          </Btn>
          <Btn label="Next paragraph (Shift+→)" onClick={p.onSkipForwardParagraph}>
            <Icon d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
          </Btn>
        </div>

        <div className="flex items-center justify-end gap-3">
          <Select value={p.voiceId} onChange={p.onVoiceChange} size="sm" options={p.voices.map((v) => ({ value: v.id, label: v.label }))} />
          <label className="flex items-center gap-2 text-white/55" title="Volume">
            <Icon d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4Z" size={16} />
            <input type="range" min={0} max={1} step={0.05} value={p.volume} onChange={(e) => p.onVolumeChange(Number(e.target.value))} aria-label="Volume" className="u-range w-20" />
          </label>
        </div>
      </div>
    </div>
  )
}
