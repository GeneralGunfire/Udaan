import toneGuides from '@/features/school/knowledge-base/tone-guides.md?raw'
import structureTemplates from '@/features/school/knowledge-base/structure-templates.md?raw'
import writingStyleGuide from '@/features/school/knowledge-base/writing-style-guide.md?raw'

export type DocumentType = 'study-guide' | 'essay-analysis' | 'scene-breakdown' | 'worksheet'
export type GradeLevel = 'elementary' | 'middle-school' | 'high-school' | 'college'

export interface StudyGeneratorRequest {
  documentType: DocumentType
  gradeLevel: GradeLevel
  topic: string
  sourceMaterial: string
}

const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  'study-guide': 'Study guide + practice questions',
  'essay-analysis': 'Essay analysis',
  'scene-breakdown': 'Scene-by-scene / chapter-by-chapter breakdown',
  worksheet: 'Worksheet',
}

const GRADE_LEVEL_LABEL: Record<GradeLevel, string> = {
  elementary: 'Elementary (grades 3-5)',
  'middle-school': 'Middle school (grades 6-8)',
  'high-school': 'High school (grades 9-12)',
  college: 'College / adult learner',
}

/**
 * Assembles the full system context sent to the model: the three knowledge
 * base files (tone, structure, style) plus the specific request. This is
 * what makes generation calls reference real guidance instead of a bare
 * "write a study guide" prompt — every call goes through this function.
 */
export function buildStudyGeneratorPrompt(request: StudyGeneratorRequest): string {
  const sections = [
    '# School Knowledge Base — Reference Material',
    '',
    'The following three documents are your guidance for this task. Follow',
    'them precisely — they define tone, structure, and prose style for',
    'academic documents produced by this tool.',
    '',
    '## Tone Guide',
    toneGuides,
    '',
    '## Structure Templates',
    structureTemplates,
    '',
    '## Writing Style Guide',
    writingStyleGuide,
    '',
    '---',
    '',
    '# Task',
    '',
    `Produce a **${DOCUMENT_TYPE_LABEL[request.documentType]}** for a `,
    `**${GRADE_LEVEL_LABEL[request.gradeLevel]}** student.`,
    '',
    `Topic: ${request.topic}`,
    '',
    'Source material:',
    '```',
    request.sourceMaterial.trim(),
    '```',
    '',
    'Apply the tone guide for the specified grade level, follow the',
    'matching structure template exactly, and write every sentence per the',
    'writing style guide — vary sentence length, cut transitional filler',
    '("Furthermore," "It is important to note that," etc.), use concrete',
    'specific language over generic filler, and avoid obvious AI-patterned',
    'phrasing. Output only the finished document — no meta-commentary about',
    'what you are about to do.',
    '',
    '# Reliability markers',
    '',
    'Wrap text in one of these two inline tags wherever it applies —',
    'everything else is assumed to come directly from the source material',
    'provided above, so only tag the exceptions:',
    '',
    '- `[[uncertain: text]]` — wrap any claim you are not confident is',
    '  correct, or where the source material is ambiguous/incomplete and',
    '  you are filling a gap with your best guess.',
    '- `[[external: text]]` — wrap any fact, date, name, or figure that',
    '  did NOT come from the source material above and instead came from',
    '  your general training knowledge.',
    '',
    'Be honest and specific with these tags — under-tagging defeats the',
    'point, and over-tagging routine, clearly-sourced restatements of the',
    'provided material is unnecessary noise. Do not tag structural/style',
    'choices, only factual claims.',
  ]
  return sections.join('\n')
}
