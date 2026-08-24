import {
  PlayIcon,
  PauseIcon,
  StopIcon,
  SkipForwardIcon,
  SkipBackIcon,
  VolumeIcon,
} from '@/shared/icons'
import type { TtsVoice } from '@/integrations/local-model/client'
import type { PlaybackStatus } from '../lib/playbackEngine'

const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2]

interface PlaybackControlsProps {
  status: PlaybackStatus
  voices: TtsVoice[]
  voiceId: string
  speed: number
  volume: number
  progressLabel: string
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

export function PlaybackControls({
  status,
  voices,
  voiceId,
  speed,
  volume,
  progressLabel,
  onTogglePlayPause,
  onStop,
  onSkipForwardSentence,
  onSkipBackSentence,
  onSkipForwardParagraph,
  onSkipBackParagraph,
  onVoiceChange,
  onSpeedChange,
  onVolumeChange,
}: PlaybackControlsProps) {
  const isPlaying = status === 'playing' || status === 'buffering'

  return (
    <div
      className="glass-surface border-glass-border flex flex-wrap items-center gap-4 border-t px-5 py-3"
      style={{ backgroundColor: 'rgb(4 6 10 / 97%)' }}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSkipBackParagraph}
          title="Previous paragraph"
          className="text-text-secondary hover:text-text-primary rounded-md p-1.5 transition-colors"
        >
          <SkipBackIcon width={16} height={16} />
          <span className="sr-only">Previous paragraph</span>
        </button>
        <button
          type="button"
          onClick={onSkipBackSentence}
          title="Previous sentence"
          className="text-text-tertiary hover:text-text-primary rounded-md p-1 text-[10px] transition-colors"
        >
          −1
        </button>

        <button
          type="button"
          onClick={onTogglePlayPause}
          disabled={status === 'buffering'}
          className="bg-brand-blue hover:bg-brand-cyan mx-1 flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors disabled:opacity-60"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {status === 'buffering' ? (
            <span className="h-3 w-3 animate-pulse rounded-full bg-white" />
          ) : isPlaying ? (
            <PauseIcon width={16} height={16} />
          ) : (
            <PlayIcon width={16} height={16} />
          )}
        </button>

        <button
          type="button"
          onClick={onStop}
          title="Stop"
          className="text-text-secondary hover:text-text-primary rounded-md p-1.5 transition-colors"
        >
          <StopIcon width={14} height={14} />
        </button>

        <button
          type="button"
          onClick={onSkipForwardSentence}
          title="Next sentence"
          className="text-text-tertiary hover:text-text-primary rounded-md p-1 text-[10px] transition-colors"
        >
          +1
        </button>
        <button
          type="button"
          onClick={onSkipForwardParagraph}
          title="Next paragraph"
          className="text-text-secondary hover:text-text-primary rounded-md p-1.5 transition-colors"
        >
          <SkipForwardIcon width={16} height={16} />
        </button>
      </div>

      <span className="text-text-tertiary text-xs tabular-nums">{progressLabel}</span>

      <div className="ml-auto flex items-center gap-4">
        <select
          value={voiceId}
          onChange={(e) => onVoiceChange(e.target.value)}
          className="border-glass-border bg-glass-bg text-text-primary rounded-md border px-2 py-1 text-xs"
        >
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>

        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="border-glass-border bg-glass-bg text-text-primary rounded-md border px-2 py-1 text-xs"
        >
          {SPEED_STEPS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <VolumeIcon width={15} height={15} className="text-text-tertiary" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="w-20"
          />
        </div>
      </div>
    </div>
  )
}
