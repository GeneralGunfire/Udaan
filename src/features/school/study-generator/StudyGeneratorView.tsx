import { useState } from 'react'
import { useStudyGenerator, type GeneratorBackend } from './hooks/useStudyGenerator'
import type { DocumentType, GradeLevel } from './lib/promptBuilder'
import { ReliabilityOutput } from './components/ReliabilityOutput'
import { GaugeIcon, SparkleIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'

const DOCUMENT_TYPES: { id: DocumentType; label: string }[] = [
  { id: 'study-guide', label: 'Study Guide + Questions' },
  { id: 'essay-analysis', label: 'Essay Analysis' },
  { id: 'scene-breakdown', label: 'Scene Breakdown' },
  { id: 'worksheet', label: 'Worksheet' },
]

const GRADE_LEVELS: { id: GradeLevel; label: string }[] = [
  { id: 'elementary', label: 'Elementary (3-5)' },
  { id: 'middle-school', label: 'Middle School (6-8)' },
  { id: 'high-school', label: 'High School (9-12)' },
  { id: 'college', label: 'College' },
]

/**
 * Study Generator — every generation call goes through
 * `buildStudyGeneratorPrompt`, which pulls in the School knowledge base
 * (tone guide, structure templates, writing style guide) rather than
 * sending a bare prompt. See lib/promptBuilder.ts.
 */
export function StudyGeneratorView() {
  const generator = useStudyGenerator()
  const [documentType, setDocumentType] = useState<DocumentType>('study-guide')
  const [gradeLevel, setGradeLevel] = useState<GradeLevel>('high-school')
  const [topic, setTopic] = useState('')
  const [sourceMaterial, setSourceMaterial] = useState('')
  const [backend, setBackend] = useState<GeneratorBackend>('claude')

  function handleGenerate() {
    if (!topic.trim() || !sourceMaterial.trim()) return
    generator.generate({ documentType, gradeLevel, topic: topic.trim(), sourceMaterial }, backend)
  }

  return (
    <div className="flex h-full w-full max-w-5xl flex-col gap-3 overflow-y-auto py-2">
      <div className="flex items-center gap-2">
        <SparkleIcon width={16} height={16} className="text-accent-school" />
        <h1 className="font-display text-text-primary text-[16px] font-semibold">
          Study Generator
        </h1>
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <div className="glass-surface flex flex-col gap-3 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <label className="text-text-secondary text-[11px] font-medium">Document type</label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
              className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 rounded-md border px-2 py-1 text-[11px] outline-none focus-visible:ring-2"
            >
              {DOCUMENT_TYPES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-text-secondary text-[11px] font-medium">Grade level</label>
            <select
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value as GradeLevel)}
              className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 rounded-md border px-2 py-1 text-[11px] outline-none focus-visible:ring-2"
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-text-secondary text-[11px] font-medium">Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Photosynthesis, Chapter 3 of..."
              className="border-glass-border bg-glass text-text-primary placeholder:text-text-tertiary focus-visible:ring-brand-cyan/60 rounded-md border px-2.5 py-1.5 text-[11.5px] outline-none focus-visible:ring-2"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <label className="text-text-secondary text-[11px] font-medium">
              Source material (notes, text, or excerpt to work from)
            </label>
            <textarea
              value={sourceMaterial}
              onChange={(e) => setSourceMaterial(e.target.value)}
              rows={10}
              placeholder="Paste the notes or text this document should be based on..."
              className="border-glass-border bg-glass text-text-primary placeholder:text-text-tertiary focus-visible:ring-brand-cyan/60 flex-1 resize-none rounded-md border px-2.5 py-1.5 text-[11.5px] leading-relaxed outline-none focus-visible:ring-2"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <GaugeIcon width={12} height={12} className="text-text-tertiary" />
              <label className="text-text-secondary text-[11px] font-medium">Backend</label>
              <select
                value={backend}
                onChange={(e) => setBackend(e.target.value as GeneratorBackend)}
                className="border-glass-border bg-glass text-text-primary focus-visible:ring-brand-cyan/60 rounded-md border px-2 py-1 text-[11px] outline-none focus-visible:ring-2"
              >
                <option value="claude">Claude Code (higher quality)</option>
                <option value="local">Local model (faster, lower quality)</option>
              </select>
            </div>
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={generator.generating || !topic.trim() || !sourceMaterial.trim()}
              variant="brand"
              size="pill-sm"
              className="rounded-md disabled:opacity-40"
            >
              {generator.generating ? 'Generating…' : 'Generate'}
            </Button>
          </div>

          {generator.error && <p className="text-danger text-[11px]">{generator.error}</p>}
        </div>

        <div className="glass-surface flex min-h-0 flex-col rounded-xl p-4">
          <h2 className="text-text-primary mb-2 text-[12.5px] font-semibold">Output</h2>
          <div className="flex-1 overflow-y-auto">
            {generator.generating && !generator.output ? (
              <p className="text-text-tertiary text-[11.5px]">Generating...</p>
            ) : generator.output ? (
              <ReliabilityOutput text={generator.output} />
            ) : (
              <p className="text-text-tertiary text-[11.5px]">
                Fill in a topic and source material, then generate. Every generation references the
                School knowledge base (tone guide, structure templates, writing style guide) — see{' '}
                <code className="text-[10.5px]">src/features/school/knowledge-base/</code>.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
