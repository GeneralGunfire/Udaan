import { memo, useMemo } from 'react'
import { cn } from '@/shared/lib/cn'
import type { PageContent } from '@/integrations/omni-find/client'
import type { Claim } from '../lib/types'

/**
 * Renders the report, with citations turned into real links.
 *
 * ## Why citations are interactive rather than plain text
 * A bracketed number that does nothing asks the reader to trust it. One
 * that hovers to reveal the source title and clicks through to the page
 * lets them check it in a second, which is the entire premise of a
 * research tool — the citation is the product, not decoration on it.
 *
 * ## Why unverified claims are marked in place
 * Flagged claims are underlined where they appear rather than only listed
 * at the bottom. A reader skimming the report should encounter the
 * uncertainty at the sentence it applies to, not discover afterwards that
 * a paragraph they already believed was unsupported.
 */

interface ReportViewProps {
  markdown: string
  sources: PageContent[]
  claims: Claim[]
}

export const ReportView = memo(function ReportView({
  markdown,
  sources,
  claims,
}: ReportViewProps) {
  const flagged = useMemo(
    () => claims.filter((c) => c.verdict !== 'supported'),
    [claims],
  )

  const blocks = useMemo(() => parseBlocks(markdown), [markdown])

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h3 key={index} className="text-text-primary mt-2 text-base font-medium tracking-tight">
              {block.text}
            </h3>
          )
        }
        if (block.kind === 'list') {
          return (
            <ul key={index} className="flex flex-col gap-1.5 pl-1">
              {block.items.map((item, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden className="text-text-tertiary mt-[7px] h-1 w-1 shrink-0 rounded-full bg-current" />
                  <span className="min-w-0 flex-1">
                    <Inline text={item} sources={sources} flagged={flagged} />
                  </span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index} className="leading-[1.75]">
            <Inline text={block.text} sources={sources} flagged={flagged} />
          </p>
        )
      })}
    </div>
  )
})

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }

/**
 * Splits markdown into the three block types a report actually uses.
 *
 * Deliberately not a full markdown parser: reports are prose, headings
 * and bullets, and pulling in a parser for that would add a dependency
 * whose extra capability is never exercised. Anything unrecognised falls
 * through as a paragraph, so nothing is ever dropped.
 */
function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = []
  let listBuffer: string[] = []

  function flushList() {
    if (listBuffer.length === 0) return
    blocks.push({ kind: 'list', items: listBuffer })
    listBuffer = []
  }

  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flushList()
      continue
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line)
    if (heading) {
      flushList()
      blocks.push({ kind: 'heading', text: heading[1] })
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      listBuffer.push(bullet[1])
      continue
    }
    const numbered = /^\d+\.\s+(.*)$/.exec(line)
    if (numbered) {
      listBuffer.push(numbered[1])
      continue
    }
    flushList()
    // Consecutive prose lines join into one paragraph, since a model
    // wrapping at 80 columns should not produce a paragraph break per
    // line.
    const last = blocks[blocks.length - 1]
    if (last && last.kind === 'paragraph') last.text += ` ${line}`
    else blocks.push({ kind: 'paragraph', text: line })
  }
  flushList()
  return blocks
}

/**
 * Renders one line: bold spans, citation links, and flagged-claim marks.
 */
function Inline({
  text,
  sources,
  flagged,
}: {
  text: string
  sources: PageContent[]
  flagged: Claim[]
}) {
  // A sentence is flagged when a flagged claim's text substantially
  // overlaps it. Exact matching fails almost always — the checker
  // paraphrases — so a generous prefix comparison is used instead, and
  // the cost of a false positive (an extra underline) is far lower than
  // a missed warning.
  const isFlagged = useMemo(
    () => flagged.some((claim) => overlaps(text, claim.text)),
    [text, flagged],
  )

  const parts = useMemo(() => splitInline(text), [text])

  return (
    <span
      className={cn(
        isFlagged && 'decoration-danger/60 underline decoration-wavy underline-offset-4',
      )}
      title={isFlagged ? 'This claim could not be verified against the sources.' : undefined}
    >
      {parts.map((part, index) => {
        if (part.kind === 'citation') {
          const source = sources[part.index - 1]
          if (!source) {
            // A number pointing at nothing is exactly what a hallucinated
            // citation looks like, so it is shown as broken rather than
            // rendered as a working link.
            return (
              <sup
                key={index}
                className="text-danger/70 mx-0.5 text-2xs-alt"
                title="Citation does not match any source"
              >
                [{part.index}]
              </sup>
            )
          }
          return (
            <a
              key={index}
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              title={source.title || source.url}
              className="text-accent mx-0.5 rounded px-1 text-2xs-alt no-underline transition-colors hover:bg-[var(--os-menu-item-hover)]"
              style={{ verticalAlign: 'super' }}
            >
              {part.index}
            </a>
          )
        }
        if (part.kind === 'bold') {
          return (
            <strong key={index} className="text-text-primary font-medium">
              {part.text}
            </strong>
          )
        }
        return <span key={index}>{part.text}</span>
      })}
    </span>
  )
}

type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'citation'; index: number }

function splitInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  // One pass over both patterns, so a citation inside bold text is still
  // found rather than swallowed by whichever ran first.
  const pattern = /\*\*(.+?)\*\*|\[(\d+)\]/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, match.index) })
    }
    if (match[1] !== undefined) parts.push({ kind: 'bold', text: match[1] })
    else parts.push({ kind: 'citation', index: Number(match[2]) })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) })
  return parts
}

/** Whether a claim plausibly refers to this line. Compares a normalised
 * opening fragment, which survives the paraphrasing a checker does while
 * still being specific enough not to match unrelated sentences. */
function overlaps(line: string, claim: string): boolean {
  const normalise = (s: string) =>
    s.toLowerCase().replace(/\[\d+\]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  const a = normalise(line)
  const b = normalise(claim)
  if (!a || !b) return false
  const head = b.slice(0, 40)
  return head.length > 15 && a.includes(head)
}
