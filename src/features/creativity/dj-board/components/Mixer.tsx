import { Fader } from './Fader'
import { HeadphonesIcon } from '@/shared/icons'

interface MixerProps {
  crossfade: number
  onCrossfade: (v: number) => void
  masterVolume: number
  onMasterVolume: (v: number) => void
}

/** Center mixer strip — crossfader + master volume, sits between the two decks. */
export function Mixer({ crossfade, onCrossfade, masterVolume, onMasterVolume }: MixerProps) {
  return (
    <div className="glass-surface flex flex-col items-center gap-4 rounded-xl p-4">
      <div className="flex items-center gap-1.5">
        <HeadphonesIcon width={13} height={13} className="text-text-tertiary" />
        <span className="text-text-tertiary text-[10.5px] font-medium tracking-wide uppercase">
          Master
        </span>
      </div>

      <Fader label="Master Vol" value={masterVolume} min={0} max={1.5} onChange={onMasterVolume} />

      <div className="border-glass-border w-full border-t" />

      <div className="flex w-full flex-col items-center gap-1.5">
        <div className="flex w-full items-center justify-between text-[9px] font-semibold">
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
      </div>
    </div>
  )
}
