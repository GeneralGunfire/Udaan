import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/components/ui/button'
import { useStudioStore } from '../store/studioStore'
import * as engine from '@/integrations/studio/client'
import type {
  AudioConfig,
  AudioOptions,
  DriverKind,
  LatencyEstimate,
} from '@/integrations/studio/types'

/**
 * Audio device setup.
 *
 * ## Why this exists as a real screen rather than a settings row
 * On Windows, audio configuration is the single most common reason a DAW
 * appears broken to a new user: the wrong driver gives 200ms of delay
 * that makes playing impossible, and nothing on screen explains why. The
 * choice cannot be hidden, so it is explained instead — each driver says
 * what it is for in a sentence, and the buffer slider shows the latency
 * it produces in milliseconds rather than a raw frame count that means
 * nothing to anyone who has not read a manual.
 *
 * ## Why latency is shown as one number with a verdict
 * "128 frames at 48kHz" is arithmetic the user should not have to do.
 * Round-trip milliseconds is what a performer actually feels, and the
 * good/ok/high rating turns it into a decision: is this usable for what
 * I am about to do.
 */
export function AudioSetup({ onDone }: { onDone: () => void }) {
  const applyAudioConfig = useStudioStore((s) => s.applyAudioConfig)
  const markSetupComplete = useStudioStore((s) => s.markSetupComplete)
  const currentLatency = useStudioStore((s) => s.latency)

  const [options, setOptions] = useState<AudioOptions | null>(null)
  const [driver, setDriver] = useState<DriverKind>('wasapiShared')
  const [outputId, setOutputId] = useState<string | null>(null)
  const [inputId, setInputId] = useState<string | null>(null)
  const [sampleRate, setSampleRate] = useState(48_000)
  const [bufferFrames, setBufferFrames] = useState(256)
  const [estimate, setEstimate] = useState<LatencyEstimate | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // Devices are enumerated per driver: the ASIO device list and the
  // WASAPI one are genuinely different sets, not the same hardware under
  // two labels, so switching driver must re-query.
  useEffect(() => {
    let cancelled = false
    engine
      .audioOptions(driver)
      .then((opts) => {
        if (cancelled) return
        setOptions(opts)
        const defaultOut = opts.devices.find((d) => d.direction === 'output' && d.isDefault)
        setOutputId((prev) => prev ?? defaultOut?.id ?? null)
        if (opts.sampleRates.length && !opts.sampleRates.includes(sampleRate)) {
          setSampleRate(opts.sampleRates[0])
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setProblem(err instanceof Error ? err.message : 'Could not list audio devices.')
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver])

  const config: AudioConfig = {
    driver,
    outputDeviceId: outputId,
    inputDeviceId: inputId,
    sampleRate,
    bufferFrames,
  }

  // Estimating is cheap and does not open the device, so it runs on every
  // change — the number updates as the slider moves rather than only
  // after applying, which is what makes the slider teachable.
  useEffect(() => {
    let cancelled = false
    engine
      // `duplex` is true only when an input is chosen: a playback-only
      // setup has no capture leg, and counting one would overstate the
      // delay by roughly half.
      .estimateLatency(bufferFrames, sampleRate, inputId !== null)
      .then((value) => {
        if (!cancelled) setEstimate(value)
      })
      .catch(() => {
        if (!cancelled) setEstimate(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, outputId, inputId, sampleRate, bufferFrames])

  const apply = useCallback(async () => {
    setBusy(true)
    setProblem(null)
    try {
      await applyAudioConfig(config)
      markSetupComplete()
      onDone()
    } catch (err) {
      setProblem(
        err instanceof Error
          ? err.message
          : 'That device could not be opened. Another application may be using it exclusively.',
      )
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const outputs = options?.devices.filter((d) => d.direction === 'output') ?? []
  const inputs = options?.devices.filter((d) => d.direction === 'input') ?? []
  const shown = estimate ?? currentLatency

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 overflow-y-auto px-8 py-10">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-text-primary text-xl font-light tracking-tight">
          Audio setup
        </h2>
        <p className="text-text-tertiary text-sm leading-relaxed">
          How Studio talks to your sound hardware. The right driver is the difference between
          playing comfortably and fighting a delay.
        </p>
      </div>

      <Section title="Driver">
        <div className="flex flex-col gap-1.5">
          {(options?.drivers ?? []).map((option) => (
            <button
              key={option.kind}
              type="button"
              onClick={() => setDriver(option.kind)}
              aria-pressed={driver === option.kind}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-150',
                driver === option.kind
                  ? 'bg-accent/12 ring-accent/40 ring-1'
                  : 'hover:bg-white/[0.05]',
              )}
            >
              <span className="text-text-primary text-sm">{option.label}</span>
              <span className="text-text-tertiary text-2xs leading-snug">{option.description}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Output">
        <DeviceList
          devices={outputs}
          selectedId={outputId}
          onSelect={setOutputId}
          emptyLabel="No output devices found."
        />
      </Section>

      <Section
        title="Input"
        hint="Only needed for recording. Leave off if you are only making beats."
      >
        <DeviceList
          devices={inputs}
          selectedId={inputId}
          onSelect={setInputId}
          allowNone
          emptyLabel="No input devices found."
        />
      </Section>

      <Section title="Buffer size">
        <div className="flex flex-col gap-3">
          <input
            type="range"
            min={0}
            max={Math.max(0, (options?.bufferSizes.length ?? 1) - 1)}
            step={1}
            value={Math.max(0, options?.bufferSizes.indexOf(bufferFrames) ?? 0)}
            onChange={(e) => {
              const list = options?.bufferSizes ?? []
              const next = list[Number(e.target.value)]
              if (next) setBufferFrames(next)
            }}
            className="accent-accent w-full"
            aria-label="Buffer size"
          />
          <div className="flex items-center justify-between">
            <span className="text-text-tertiary text-2xs">
              Smaller — less delay, more strain on the CPU
            </span>
            <span className="text-text-tertiary text-2xs">Larger — steadier</span>
          </div>
          <p className="text-text-secondary text-xs tabular-nums">
            {bufferFrames} frames at {(sampleRate / 1000).toFixed(1)} kHz
          </p>
        </div>
      </Section>

      {shown && (
        <div
          className={cn(
            'flex items-center justify-between rounded-xl px-4 py-3',
            shown.rating === 'high' ? 'bg-danger/10' : 'bg-white/[0.05]',
          )}
        >
          <div className="flex flex-col">
            <span
              className={cn(
                'text-lg font-light tabular-nums',
                shown.rating === 'high' ? 'text-danger' : 'text-text-primary',
              )}
            >
              {shown.roundTripMs.toFixed(1)} ms
            </span>
            <span className="text-text-tertiary text-2xs">
              Round trip — what you feel when playing
            </span>
          </div>
          <span
            className={cn(
              'text-xs',
              shown.rating === 'good'
                ? 'text-accent'
                : shown.rating === 'ok'
                  ? 'text-text-secondary'
                  : 'text-danger',
            )}
          >
            {shown.rating === 'good'
              ? 'Comfortable for recording'
              : shown.rating === 'ok'
                ? 'Fine for mixing'
                : 'Too high to play against'}
          </span>
        </div>
      )}

      {problem && (
        <p className="text-danger text-xs leading-relaxed" role="alert">
          {problem}
        </p>
      )}

      <div className="flex justify-end gap-2 pb-4">
        <Button type="button" variant="ghost" size="pill" onClick={onDone}>
          Skip for now
        </Button>
        <Button type="button" variant="brand" size="pill" disabled={busy} onClick={() => void apply()}>
          {busy ? 'Opening device…' : 'Use these settings'}
        </Button>
      </div>
    </div>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-text-secondary text-2xs font-semibold tracking-wider uppercase">
          {title}
        </h3>
        {hint && <p className="text-text-tertiary text-2xs">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function DeviceList({
  devices,
  selectedId,
  onSelect,
  allowNone = false,
  emptyLabel,
}: {
  devices: { id: string; name: string; isDefault: boolean }[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  allowNone?: boolean
  emptyLabel: string
}) {
  if (devices.length === 0) {
    return <p className="text-text-tertiary text-xs">{emptyLabel}</p>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {allowNone && (
        <DeviceRow
          label="None"
          detail="No recording"
          selected={selectedId === null}
          onSelect={() => onSelect(null)}
        />
      )}
      {devices.map((device) => (
        <DeviceRow
          key={device.id}
          label={device.name}
          detail={device.isDefault ? 'System default' : undefined}
          selected={selectedId === device.id}
          onSelect={() => onSelect(device.id)}
        />
      ))}
    </div>
  )
}

function DeviceRow({
  label,
  detail,
  selected,
  onSelect,
}: {
  label: string
  detail?: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150',
        selected ? 'bg-accent/12 ring-accent/40 ring-1' : 'hover:bg-white/[0.05]',
      )}
    >
      <span className="text-text-primary min-w-0 flex-1 truncate text-sm">{label}</span>
      {detail && <span className="text-text-tertiary shrink-0 text-2xs">{detail}</span>}
    </button>
  )
}
