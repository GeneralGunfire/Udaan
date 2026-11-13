import { useMemo, useState } from 'react'
import { DjKnob } from './DjKnob'
import { RACK_SECTIONS, type ParamSpec, type ParamValues } from '../lib/dsp'

interface EffectRackProps {
  /** Every parameter the deck's chain exposes, in chain order. */
  specs: ParamSpec[]
  values: ParamValues
  onChange: (patch: ParamValues) => void
}

/**
 * The deck's effect rack, rendered from the chain's own parameter schema
 * rather than from hardcoded markup.
 *
 * This replaces two dense flanking boxes that held ten knobs with no
 * grouping, ordering rationale, or labels beyond each knob's own — which
 * is what made the board read as cluttered and structureless. Three
 * things changed:
 *
 *  - Controls are grouped into named sections (EQ, Filter, Tone, Drive,
 *    Modulation, Space, Rhythm) that match how a DJ actually thinks about
 *    them, so finding "the reverb" means looking under Space rather than
 *    scanning ten identical dials.
 *  - The four sections used constantly (level, EQ, kills, filter) stay
 *    permanently visible; the rest live in a drawer that opens on demand.
 *    A twelve-effect rack shown all at once is not more capable, it is
 *    just louder.
 *  - Sections holding a non-default value get a marker, so an effect left
 *    engaged is visible even while its section is collapsed. Without that,
 *    hiding controls would hide state, which is worse than clutter.
 *
 * Because it renders from the schema, adding an effect to `createDeckChain`
 * and naming its keys in `RACK_SECTIONS` is the whole UI change.
 */
export function EffectRack({ specs, values, onChange }: EffectRackProps) {
  const [openSection, setOpenSection] = useState<string | null>(null)

  const specByKey = useMemo(() => new Map(specs.map((s) => [s.key, s])), [specs])
  const sections = useMemo(
    () =>
      RACK_SECTIONS.map((section) => ({
        ...section,
        specs: section.keys.map((k) => specByKey.get(k)).filter((s): s is ParamSpec => Boolean(s)),
      })).filter((s) => s.specs.length > 0),
    [specByKey],
  )

  const primary = sections.filter((s) => s.primary)
  const secondary = sections.filter((s) => !s.primary)

  return (
    <div className="flex flex-col gap-2.5">
      {primary.map((section) => (
        <Section key={section.id} label={section.label}>
          <div className="flex items-end justify-center gap-2">
            {section.specs.map((spec) => (
              <Control key={spec.key} spec={spec} values={values} onChange={onChange} />
            ))}
          </div>
        </Section>
      ))}

      <div className="border-hairline flex flex-wrap gap-1 border-t pt-2">
        {secondary.map((section) => {
          const engaged = section.specs.some((s) => isEngaged(s, values))
          const open = openSection === section.id
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setOpenSection(open ? null : section.id)}
              aria-expanded={open}
              className={`relative rounded-full px-2.5 py-1 text-2xs-alt font-medium tracking-wide transition-colors ${
                open
                  ? 'bg-white/12 text-text-primary'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-white/8'
              }`}
            >
              {section.label}
              {engaged && (
                <span
                  aria-label="active"
                  className="absolute top-0.5 right-1 h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                />
              )}
            </button>
          )
        })}
      </div>

      {secondary
        .filter((s) => s.id === openSection)
        .map((section) => (
          <Section key={section.id} label={section.label}>
            <div className="flex flex-wrap items-end justify-center gap-2">
              {section.specs.map((spec) => (
                <Control key={spec.key} spec={spec} values={values} onChange={onChange} size="sm" />
              ))}
            </div>
          </Section>
        ))}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-text-tertiary text-3xs font-semibold tracking-widest uppercase">{label}</span>
      {children}
    </div>
  )
}

function Control({
  spec,
  values,
  onChange,
  size = 'md',
}: {
  spec: ParamSpec
  values: ParamValues
  onChange: (patch: ParamValues) => void
  size?: 'sm' | 'md'
}) {
  if (spec.kind === 'toggle') {
    const on = values[spec.key] === true
    return (
      <button
        type="button"
        onClick={() => onChange({ [spec.key]: !on })}
        aria-pressed={on}
        title={spec.label}
        className={`rounded-md px-2 py-1.5 text-3xs font-bold tracking-wide transition-colors ${
          on ? 'bg-danger text-white' : 'bg-white/8 text-text-tertiary hover:bg-white/12'
        }`}
      >
        {/* "Kill Bass" reads as just "BASS" here — the section header
            already says Kill, so repeating it in every button is noise. */}
        {spec.label.replace(/^Kill\s*/i, '').toUpperCase()}
      </button>
    )
  }

  const raw = values[spec.key]
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.neutral
  return (
    <DjKnob
      label={spec.label}
      value={value}
      min={spec.min}
      max={spec.max}
      centerValue={spec.neutral}
      step={spec.step ?? 1}
      size={size}
      formatValue={spec.format}
      onChange={(v) => onChange({ [spec.key]: v })}
    />
  )
}

function isEngaged(spec: ParamSpec, values: ParamValues): boolean {
  const v = values[spec.key]
  if (spec.kind === 'toggle') return v === true
  return typeof v === 'number' && Math.abs(v - spec.neutral) > 1e-6
}
