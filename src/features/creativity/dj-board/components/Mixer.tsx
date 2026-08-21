import { Fader } from './Fader'
import { PeakMeter } from './PeakMeter'
import type { CrossfaderCurve } from '../lib/audioEngine'
import { HeadphonesIcon } from '@/shared/icons'

interface MixerProps {
  crossfade: number
  onCrossfade: (v: number) => void
  crossfaderCurve: CrossfaderCurve
  onCrossfaderCurve: (curve: CrossfaderCurve) => void
  masterVolume: number
  onMasterVolume: (v: number) => void
  peakMaster: number
}

/**
 * Center shared/mixer column — crossfader, curve toggle, master volume +
 * peak meter — sits between the two decks, everything cross-deck grouped
 * here rather than scattered across the layout.
 */
export function Mixer({
  crossfade,
  onCrossfade,
  crossfaderCurve,
  onCrossfaderCurve,
  masterVolume,
  onMasterVolume,
  peakMaster,
}: MixerProps) {
  return (
    <div className="glass-surface flex flex-col items-center gap-4 rounded-xl p-4">
      <div className="flex items-center gap-1.5">
        <HeadphonesIcon width={13} height={13} className="text-text-tertiary" />
        <span className="text-text-tertiary text-[10.5px] font-medium tracking-wide uppercase">
          Master
        </span>
      </div>

      <div className="flex items-stretch gap-2">
        <Fader label="Master Vol" value={masterVolume} min={0} max={1.5} onChange={onMasterVolume} />
        <PeakMeter level={peakMaster} accent="var(--color-success)" />
      </div>

      <div className="border-glass-border w-full border-t" />

      <div className="flex w-full flex-col items-center gap-2">
        <div className="flex w-full items-center justify-between text-[10px] font-semibold">
          <span className="text-brand-cyan">A</span>
          <span className="text-accent-creativity">B</span>
        </div>
        <Fader
          label="Crossfader"
          value={crossfade}
          min={-1}
          max={1}
          step={0.01}
          onChange={onCrossfade}
          orientation="horizontal"
        />
        <div className="flex w-full overflow-hidden rounded-md">
          <button
            type="button"
            onClick={() => onCrossfaderCurve('smooth')}
            title="Smooth-blend crossfader response"
            className="h-6 flex-1 text-[9.5px] font-medium tracking-wide uppercase transition-colors duration-100"
            style={{
              background: crossfaderCurve === 'smooth' ? 'var(--gradient-brand)' : 'var(--color-glass-bg-hover)',
              color: crossfaderCurve === 'smooth' ? '#fff' : 'var(--color-text-tertiary)',
            }}
          >
            Smooth
          </button>
          <button
            type="button"
            onClick={() => onCrossfaderCurve('sharp')}
            title="Sharp-cut crossfader response"
            className="h-6 flex-1 text-[9.5px] font-medium tracking-wide uppercase transition-colors duration-100"
            style={{
              background: crossfaderCurve === 'sharp' ? 'var(--gradient-brand)' : 'var(--color-glass-bg-hover)',
              color: crossfaderCurve === 'sharp' ? '#fff' : 'var(--color-text-tertiary)',
            }}
          >
            Sharp
          </button>
        </div>
      </div>
    </div>
  )
}
