import { memo, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { spring } from '@/shared/lib/motion'
import { ClipboardIcon } from '@/shared/icons'
import { Button } from '@/shared/components/ui/button'

/**
 * Minimal markdown rendering — fenced code blocks and inline `code` spans
 * only, not a full markdown parser. Assistant replies routinely include
 * code, and rendering it as a monospace block (not plain wrapped text) is
 * the single highest-value case for a chat that talks to an LLM.
 *
 * Memoized on `text` — while a reply is streaming, `text` genuinely
 * changes every chunk and re-splitting is real, necessary work, but this
 * also re-rendered (and re-ran both regex splits) on ANY re-render of the
 * message list, not just ones where this particular message's text
 * actually changed. `React.memo` + `useMemo` mean an unrelated re-render
 * (e.g. a sibling message updating, a hover state elsewhere) skips the
 * parse entirely when `text` is unchanged.
 */
export const MessageText = memo(function MessageText({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(```[\s\S]*?```)/g), [text])

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const match = /^```(\w*)\n?([\s\S]*?)```$/.exec(part)
          const code = match ? match[2].replace(/\n$/, '') : part.slice(3, -3)
          const lang = match?.[1]
          return <CodeBlock key={i} code={code} lang={lang} />
        }
        return (
          <InlineCode key={i} text={part} />
        )
      })}
    </>
  )
})

/** Code block with a hover-reveal copy button — same reveal pattern ChatMessage uses for its own metadata row. */
const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission denied or unavailable — no user-facing error needed.
    }
  }

  return (
    <pre className="group/code relative my-1.5 overflow-x-auto rounded-md border border-(--border-hairline) bg-(--surface-overlay) p-2.5 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        {lang ? (
          <div className="text-text-tertiary text-xs font-medium uppercase">{lang}</div>
        ) : (
          <div />
        )}
        <Button
          type="button"
          aria-label="Copy code"
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          className="rounded-md opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 focus-visible:opacity-100"
        >
          {copied ? (
            <motion.svg
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.micro}
              width="10"
              height="10"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-accent"
            >
              <path d="M4 10l4 4 8-8" />
            </motion.svg>
          ) : (
            <ClipboardIcon width={10} height={10} />
          )}
        </Button>
      </div>
      <code className="font-mono whitespace-pre">{code}</code>
    </pre>
  )
})

const InlineCode = memo(function InlineCode({ text }: { text: string }) {
  const segments = useMemo(() => text.split(/(`[^`]+`)/g), [text])
  return (
    <p className="whitespace-pre-wrap">
      {segments.map((seg, i) =>
        seg.startsWith('`') && seg.endsWith('`') && seg.length > 1 ? (
          <code
            key={i}
            className="rounded-sm bg-(--surface-overlay) px-1 py-0.5 font-mono text-xs"
          >
            {seg.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{seg}</span>
        ),
      )}
    </p>
  )
})
