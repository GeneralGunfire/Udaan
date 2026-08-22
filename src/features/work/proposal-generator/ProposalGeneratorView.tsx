import { useMemo, useState } from 'react'
import { useTemplateLibrary } from './hooks/useTemplateLibrary'
import { extractPlaceholders, fillTemplate, placeholderLabel } from './lib/fillTemplate'
import { ProjectIcon, PencilIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'

/**
 * Proposal / Quote Generator — template-based document generation over
 * the shared template library (src/integrations/template-library),
 * seeded with starter NDA/contract/proposal/quote templates. Fills
 * `{{placeholder}}` tokens with user input and produces a plain-text
 * document, copyable or downloadable as .txt.
 */
export function ProposalGeneratorView() {
  const library = useTemplateLibrary()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)

  const selected = library.templates.find((t) => t.id === selectedId) ?? null
  const placeholders = useMemo(
    () => (selected ? extractPlaceholders(selected.body) : []),
    [selected],
  )
  const filledBody = useMemo(
    () => (selected ? fillTemplate(selected.body, values) : ''),
    [selected, values],
  )

  function selectTemplate(id: string) {
    setSelectedId(id)
    setValues({})
    setCopied(false)
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(filledBody)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  function downloadTxt() {
    if (!selected) return
    const blob = new Blob([filledBody], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.name.replace(/\s+/g, '-').toLowerCase()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full w-full max-w-5xl flex-col gap-3 overflow-y-auto py-2">
      <div className="flex items-center gap-2">
        <ProjectIcon width={16} height={16} className="text-accent-work" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">
          Proposal / Quote Generator
        </h1>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_1fr] gap-3">
        <div className="glass-surface flex flex-col gap-1 rounded-xl p-3">
          <h2 className="text-text-primary mb-1 text-[12px] font-semibold">Templates</h2>
          {library.loading ? (
            <p className="text-text-tertiary text-[11px]">Loading...</p>
          ) : library.error ? (
            <p className="text-danger text-[11px]">{library.error}</p>
          ) : (
            library.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTemplate(t.id)}
                className={`focus-visible:ring-brand-cyan/60 rounded-md px-2 py-1.5 text-left text-[11px] outline-none transition-colors duration-150 focus-visible:ring-2 ${
                  t.id === selectedId
                    ? 'bg-glass-hover text-text-primary font-medium'
                    : 'text-text-secondary hover:bg-glass-hover'
                }`}
              >
                {t.name}
              </button>
            ))
          )}
        </div>

        <div className="glass-surface flex min-h-0 flex-col gap-2 overflow-y-auto rounded-xl p-4">
          {selected ? (
            <>
              <p className="text-text-tertiary text-[10.5px] leading-relaxed">{selected.description}</p>
              {placeholders.length === 0 ? (
                <p className="text-text-tertiary text-[11px]">
                  This template has no fillable fields.
                </p>
              ) : (
                placeholders.map((key) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label className="text-text-secondary text-[10.5px] font-medium">
                      {placeholderLabel(key)}
                    </label>
                    <input
                      type="text"
                      value={values[key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                      className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 rounded-md border px-2 py-1.5 text-[11.5px] outline-none focus-visible:ring-2"
                    />
                  </div>
                ))
              )}
            </>
          ) : (
            <div className="text-text-tertiary flex h-full flex-col items-center justify-center gap-2 text-[11.5px]">
              <PencilIcon width={24} height={24} className="text-text-tertiary" />
              Pick a template to start filling it in.
            </div>
          )}
        </div>

        <div className="glass-surface flex min-h-0 flex-col rounded-xl p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-text-primary text-[12px] font-semibold">Preview</h2>
            {selected && (
              <div className="flex gap-1.5">
                <Button type="button" onClick={copyToClipboard} variant="ghost" size="pill-sm" className="rounded-md">
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button type="button" onClick={downloadTxt} variant="ghost" size="pill-sm" className="rounded-md">
                  Download .txt
                </Button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <pre className="text-text-secondary font-sans text-[11px] leading-relaxed whitespace-pre-wrap">
                {filledBody}
              </pre>
            ) : (
              <p className="text-text-tertiary text-[11px]">No template selected.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
