/**
 * Minimal markdown rendering — fenced code blocks and inline `code` spans
 * only, not a full markdown parser. Assistant replies routinely include
 * code, and rendering it as a monospace block (not plain wrapped text) is
 * the single highest-value case for a chat that talks to an LLM.
 */
export function MessageText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g)

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const match = /^```(\w*)\n?([\s\S]*?)```$/.exec(part)
          const code = match ? match[2].replace(/\n$/, '') : part.slice(3, -3)
          const lang = match?.[1]
          return (
            <pre
              key={i}
              className="border-glass-border bg-bg-base/60 my-1.5 overflow-x-auto rounded-lg border p-2.5 text-[12px]"
            >
              {lang && (
                <div className="text-text-tertiary mb-1 text-[12px] font-medium uppercase">
                  {lang}
                </div>
              )}
              <code className="font-mono whitespace-pre">{code}</code>
            </pre>
          )
        }
        return (
          <InlineCode key={i} text={part} />
        )
      })}
    </>
  )
}

function InlineCode({ text }: { text: string }) {
  const segments = text.split(/(`[^`]+`)/g)
  return (
    <p className="whitespace-pre-wrap">
      {segments.map((seg, i) =>
        seg.startsWith('`') && seg.endsWith('`') && seg.length > 1 ? (
          <code
            key={i}
            className="bg-bg-base/50 rounded px-1 py-0.5 font-mono text-[12px]"
          >
            {seg.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{seg}</span>
        ),
      )}
    </p>
  )
}
