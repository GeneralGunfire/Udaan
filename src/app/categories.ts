import { PLACEHOLDER_DESCRIPTORS } from './placeholderData'

export type CategoryId = 'school' | 'work' | 'creativity' | 'general'

export interface CategoryItem {
  id: string
  label: string
}

export interface CategoryDefinition {
  id: CategoryId
  label: string
  descriptor: string
  accentVar: string // CSS var name, e.g. --color-accent-school
  items: CategoryItem[]
}

/**
 * Channels — project categories only. "General" is not a channel; its
 * features (schedule, model dashboard, task queue, general chat) live in
 * the sidebar's Workspace section instead, since they're cross-cutting
 * tools rather than a project you organize work under.
 */
export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'school',
    label: 'School',
    descriptor: PLACEHOLDER_DESCRIPTORS.school,
    accentVar: '--color-accent-school',
    items: [
      { id: 'school-study-generator', label: 'Study Generator' },
      { id: 'school-templates', label: 'Templates' },
      { id: 'school-quiz-generator', label: 'Quiz Generator' },
      { id: 'school-past-paper-matcher', label: 'Past-Paper Matcher' },
      { id: 'school-reading-summarizer', label: 'Reading List / Summarizer' },
      { id: 'school-progress-dashboard', label: 'Progress Dashboard' },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    descriptor: PLACEHOLDER_DESCRIPTORS.work,
    accentVar: '--color-accent-work',
    items: [
      { id: 'work-prospect', label: 'Prospect' },
      { id: 'work-project-health', label: 'Project Health Dashboard' },
      { id: 'work-proposal-generator', label: 'Proposal / Quote Generator' },
      { id: 'work-portfolio', label: 'Portfolio' },
      { id: 'work-client-tracker', label: 'Client Tracker' },
    ],
  },
  {
    id: 'creativity',
    label: 'Creativity',
    descriptor: PLACEHOLDER_DESCRIPTORS.creativity,
    accentVar: '--color-accent-creativity',
    items: [
      { id: 'creativity-video-editor', label: 'Video Editor' },
      { id: 'creativity-image-editor', label: 'Image Editor' },
      { id: 'creativity-dj-mixer', label: 'DJ / Music Mixer' },
      { id: 'creativity-music-player', label: 'Music Player' },
      { id: 'creativity-word-processor', label: 'Word Processor' },
      { id: 'creativity-asset-library', label: 'Asset Library' },
    ],
  },
]
