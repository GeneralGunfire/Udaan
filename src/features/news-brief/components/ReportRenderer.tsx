import { Fragment } from 'react'
import { motion } from 'framer-motion'
import {
  LandmarkIcon,
  ShieldAlertIcon,
  CodeEditorIcon,
  FlaskIcon,
  BriefcaseIcon,
  HeartIcon,
  type IconComponent,
} from '@/shared/icons'

interface ReportRendererProps {
  markdown: string
  /** Called once per section, right when its DOM node mounts/updates (and
   * with `null` on unmount) — the single source of truth NewsBriefView
   * uses to build its section-ref map for the IntersectionObserver and
   * scroll-to-category logic. Replaces an earlier design where the rail
   * independently queried `document.getElementById` on its own timer,
   * which could run before these nodes existed (or after they'd already
   * been swapped out by a date change) and silently find nothing. */
  onSectionRef?: (slug: string, el: HTMLElement | null) => void
  /** The section a category-rail click just scrolled to, for exactly the
   * duration of its one-shot arrival highlight — a soft glow + scale pulse
   * around that section's heading, so landing on it after the scroll
   * reads as a deliberate "you're here" moment instead of the scroll
   * position just quietly stopping. `null` the rest of the time. */
  arrivalSlug?: string | null
}

interface StoryBlock {
  headline: string
  body: string[]
}

export interface CategorySection {
  title: string
  slug: string
  storyCount: number
}

/** Maps a section's rendered title back to a category icon/id — matched
 * by substring rather than an exact enum, since the title text comes
 * straight from the summarizer's own Markdown heading (e.g. "Conflict &
 * Geopolitics") rather than a stable category key already parsed apart
 * from it. A title that matches nothing gets no icon rather than a
 * misleading generic one. */
const CATEGORY_MATCHERS: { test: RegExp; icon: IconComponent; slug: string }[] = [
  { test: /politic/i, icon: LandmarkIcon, slug: 'politics' },
  { test: /conflict|geopolit/i, icon: ShieldAlertIcon, slug: 'conflict' },
  { test: /tech/i, icon: CodeEditorIcon, slug: 'technology' },
  { test: /science/i, icon: FlaskIcon, slug: 'science' },
  { test: /business|econom/i, icon: BriefcaseIcon, slug: 'business' },
  { test: /health/i, icon: HeartIcon, slug: 'health' },
]

export function matchCategory(title: string) {
  return CATEGORY_MATCHERS.find((m) => m.test.test(title))
}

/** Stable per-section anchor id, derived from the title. */
function slugify(title: string, index: number): string {
  const matched = matchCategory(title)
  if (matched) return matched.slug
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `section-${index}`
  )
}

export interface ParsedSection extends CategorySection {
  stories: StoryBlock[]
}

/**
 * Turns the summarizer's constrained Markdown output (`## ` category
 * headings, `**Headline**` lines, plain paragraph sentences underneath)
 * into structured sections/stories. Deliberately NOT a general Markdown
 * renderer (no `marked`/remark) — the model is instructed to only ever
 * produce this one shape, so a small purpose-built parser is simpler and
 * has zero risk of rendering arbitrary HTML from a source that's ultimately
 * LLM output derived from public RSS text.
 */
export function parseReportFull(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n').map((l) => l.trim())
  const sections: ParsedSection[] = []
  let currentSection: ParsedSection | null = null
  let currentStory: StoryBlock | null = null

  function flushStory() {
    if (currentStory && currentSection) currentSection.stories.push(currentStory)
    currentStory = null
  }
  function flushSection() {
    flushStory()
    if (currentSection) sections.push(currentSection)
    currentSection = null
  }

  for (const line of lines) {
    if (!line) continue
    const headingMatch = line.match(/^##\s+(.*)/)
    if (headingMatch) {
      flushSection()
      const title = headingMatch[1].replace(/\*\*/g, '')
      currentSection = { title, slug: slugify(title, sections.length), storyCount: 0, stories: [] }
      continue
    }
    const headlineMatch = line.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/)
    if (headlineMatch) {
      flushStory()
      currentStory = { headline: headlineMatch[1], body: headlineMatch[2] ? [headlineMatch[2]] : [] }
      continue
    }
    if (currentStory) {
      currentStory.body.push(line)
    } else if (currentSection) {
      // A stray paragraph with no bold headline — still render it rather
      // than silently dropping content the model produced.
      currentStory = { headline: '', body: [line] }
    }
  }
  flushSection()
  for (const s of sections) s.storyCount = s.stories.length
  return sections
}

/** Public, lightweight parse — used by NewsBriefView just to know section
 * titles/slugs/counts for the rail, without needing the full story bodies. */
export function parseReport(markdown: string): CategorySection[] {
  return parseReportFull(markdown).map(({ title, slug, storyCount }) => ({ title, slug, storyCount }))
}

/** Renders `*italic*`/plain text within a sentence — the only inline
 * emphasis the summarizer is likely to reach for beyond the headline bold,
 * which the parser already strips out at the line level. */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
          <em key={i} className="text-text-primary not-italic font-medium">
            {part.slice(1, -1)}
          </em>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

/**
 * The report itself — editorial typography (clear section headers, a
 * bold headline-style title per story, generous whitespace) rendered in
 * Udaan's own dark glass palette. Section entrance uses a plain CSS
 * keyframe (`.animate-report-story-in`, defined once in theme.css) rather
 * than a Framer Motion instance per story — with up to ~20 stories across
 * a full 6-category report, giving each one its own JS-driven animation
 * was measurable overhead that showed up as sluggish scrolling.
 */
export function ReportRenderer({ markdown, onSectionRef, arrivalSlug }: ReportRendererProps) {
  const sections = parseReportFull(markdown)

  if (sections.length === 0) {
    return <p className="text-text-secondary text-sm">This report has no readable content.</p>
  }

  return (
    <article className="flex w-full flex-col gap-11">
      {sections.map((section, i) => {
        // Not gated behind reduced-motion — see NewsBriefView's
        // jumpToSection comment for why: a gentle opacity glow marking
        // "you clicked and arrived here" isn't the kind of motion that
        // guideline exists to suppress, and gating it made the whole
        // category-jump feature silently do nothing extra on a machine
        // where Windows' own animation setting happened to be off.
        const arriving = arrivalSlug === section.slug
        return (
          <section
            key={section.slug}
            ref={(el) => onSectionRef?.(section.slug, el)}
            className="animate-report-story-in scroll-mt-6 flex flex-col gap-5"
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <motion.div
              className="relative -mx-3 flex items-center gap-2.5 rounded-lg px-3 py-1"
              animate={
                arriving
                  ? { backgroundColor: ['color-mix(in srgb, var(--color-accent) 0%, transparent)', 'color-mix(in srgb, var(--color-accent) 14%, transparent)', 'color-mix(in srgb, var(--color-accent) 0%, transparent)'] }
                  : { backgroundColor: 'color-mix(in srgb, var(--color-accent) 0%, transparent)' }
              }
              transition={arriving ? { duration: 0.9, times: [0, 0.25, 1], ease: 'easeOut' } : { duration: 0 }}
            >
              {arriving && (
                <motion.span
                  className="border-accent/50 pointer-events-none absolute inset-0 rounded-lg border"
                  initial={{ opacity: 0.9, scale: 1.01 }}
                  animate={{ opacity: 0, scale: 1 }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
              <h2 className="text-text-primary relative text-sm font-semibold tracking-[0.08em] uppercase">
                {section.title}
              </h2>
              <span className="text-text-secondary relative text-2xs font-medium tabular-nums">
                {section.stories.length} {section.stories.length === 1 ? 'story' : 'stories'}
              </span>
              <div className="border-hairline relative h-px flex-1 border-t" />
            </motion.div>

            <div className="flex flex-col gap-6">
              {section.stories.map((story, j) => (
                <div
                  key={j}
                  className="animate-report-story-in flex flex-col gap-1.5"
                  style={{ animationDelay: `${i * 0.05 + Math.min(j, 6) * 0.035}s` }}
                >
                  {story.headline && (
                    <h3 className="text-text-primary text-[15px] leading-snug font-semibold">{story.headline}</h3>
                  )}
                  {story.body.map((sentence, k) => (
                    <p key={k} className="text-text-secondary text-[13.5px] leading-relaxed">
                      <InlineText text={sentence} />
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </article>
  )
}
