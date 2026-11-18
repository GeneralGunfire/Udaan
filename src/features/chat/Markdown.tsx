import { createContext, memo, useContext, useState, type ReactNode } from 'react'
import { marked, type Token, type Tokens } from 'marked'
import { launchApp } from '@/integrations/installed-apps/client'
import { cn } from '@/shared/lib/cn'

/**
 * Markdown -> React, never HTML. The model's text is tokenised by `marked` and each token
 * becomes a React element, so nothing it writes can run as markup or script in a window
 * that can call Tauri. Raw HTML in a reply shows as text.
 */

function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) void launchApp(href).catch(() => {})
}

function inline(tokens: Token[] | undefined, key = 'i'): ReactNode[] {
  if (!tokens) return []
  return tokens.map((t, i) => {
    const k = `${key}.${i}`
    switch (t.type) {
      case 'strong':
        return <strong key={k} className="font-semibold">{inline((t as Tokens.Strong).tokens, k)}</strong>
      case 'em':
        return <em key={k}>{inline((t as Tokens.Em).tokens, k)}</em>
      case 'del':
        return <del key={k}>{inline((t as Tokens.Del).tokens, k)}</del>
      case 'codespan':
        return <code key={k} className="rounded-[5px] bg-(--u-wash-on) px-1.5 py-px font-mono text-[0.88em]">{decode((t as Tokens.Codespan).text)}</code>
      case 'link': {
        const l = t as Tokens.Link
        return (
          <a key={k} href={l.href} title={l.href} onClick={(e) => (e.preventDefault(), openLink(l.href))} className="text-(--u-accent) underline decoration-[0.5px] underline-offset-2 hover:decoration-2">
            {inline(l.tokens, k)}
          </a>
        )
      }
      case 'image': {
        const im = t as Tokens.Image
        return <span key={k} className="text-(--u-ink-3)">[image: {im.text || im.href}]</span>
      }
      case 'br':
        return <br key={k} />
      case 'text': {
        const tt = t as Tokens.Text
        return tt.tokens ? <span key={k}>{inline(tt.tokens, k)}</span> : <span key={k}>{cite(decode(tt.text), k)}</span>
      }
      case 'escape':
        return <span key={k}>{decode((t as Tokens.Escape).text)}</span>
      default:
        return <span key={k}>{decode((t as { raw?: string }).raw ?? '')}</span>
    }
  })
}

/** Optional: makes [1], [2] interactive (Research uses it). Without it they are plain marks. */
export interface CiteInfo {
  ok: boolean
  title?: string
  url?: string
}
export const CiteContext = createContext<{ info: (n: number) => CiteInfo; onCite: (n: number) => void } | null>(null)

function CiteMark({ n }: { n: number }) {
  const c = useContext(CiteContext)
  const base = 'mx-px rounded-[4px] px-1 text-[0.72em] font-medium'
  if (!c) return <sup className={`${base} bg-(--u-wash-on) text-(--u-accent)`}>{n}</sup>
  const i = c.info(n)
  return (
    <sup>
      <button
        type="button"
        title={i.ok ? `${i.title ?? ''}${i.url ? `
${i.url}` : ''}` : `[${n}] points at no source`}
        onClick={() => c.onCite(n)}
        className={`${base} ${i.ok ? 'bg-(--u-wash-on) text-(--u-accent) hover:bg-(--u-accent) hover:text-white' : 'bg-[color-mix(in_srgb,var(--u-danger)_22%,transparent)] text-(--u-danger) line-through'}`}
      >
        {n}
      </button>
    </sup>
  )
}

/** Turns [1], [2] into small citation marks. */
function cite(text: string, key: string): ReactNode {
  const parts = text.split(/(\[\d{1,2}\])/g)
  if (parts.length === 1) return text
  return parts.map((p, i) => (/^\[\d{1,2}\]$/.test(p) ? <CiteMark key={`${key}c${i}`} n={Number(p.slice(1, -1))} /> : p))
}

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENT[m] ?? m)

function Code({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="my-3 overflow-hidden rounded-[10px] bg-[#0d1117] shadow-[inset_0_0_0_1px_var(--u-edge)]">
      <div className="flex h-8 items-center justify-between border-b border-(--u-edge) px-3 text-[11.5px] text-(--u-ink-3)">
        <span className="font-mono">{lang || 'text'}</span>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1400)))}
          className="rounded-[5px] px-2 py-0.5 hover:bg-(--u-wash-hover) hover:text-(--u-ink)"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="u-scroll overflow-x-auto p-3.5 font-mono text-[12.5px] leading-[1.6] text-[#e6edf3]">
        <code>{text}</code>
      </pre>
    </div>
  )
}

function block(t: Token, k: string): ReactNode {
  switch (t.type) {
    case 'heading': {
      const h = t as Tokens.Heading
      const cls = h.depth <= 1 ? 'mt-5 mb-2 text-[19px] font-semibold' : h.depth === 2 ? 'mt-5 mb-2 text-[16.5px] font-semibold' : 'mt-4 mb-1.5 text-[14.5px] font-semibold'
      return <p key={k} className={cls}>{inline(h.tokens, k)}</p>
    }
    case 'paragraph':
      return <p key={k} className="my-2.5">{inline((t as Tokens.Paragraph).tokens, k)}</p>
    case 'code': {
      const c = t as Tokens.Code
      return <Code key={k} lang={c.lang ?? ''} text={c.text} />
    }
    case 'blockquote':
      return (
        <blockquote key={k} className="my-3 border-l-[3px] border-(--u-edge-strong) pl-4 text-(--u-ink-2)">
          {(t as Tokens.Blockquote).tokens.map((x, i) => block(x, `${k}.${i}`))}
        </blockquote>
      )
    case 'list': {
      const l = t as Tokens.List
      const Tag = l.ordered ? 'ol' : 'ul'
      return (
        <Tag key={k} start={l.ordered && typeof l.start === 'number' ? l.start : undefined} className={cn('my-2.5 space-y-1 pl-6', l.ordered ? 'list-decimal' : 'list-disc', 'marker:text-(--u-ink-3)')}>
          {l.items.map((it, i) => (
            <li key={i} className="pl-1">
              {it.task && <input type="checkbox" checked={!!it.checked} readOnly className="mr-2 align-middle accent-(--u-accent)" />}
              {it.tokens.map((x, j) => (x.type === 'text' ? <span key={j}>{inline((x as Tokens.Text).tokens ?? [x], `${k}.${i}.${j}`)}</span> : block(x, `${k}.${i}.${j}`)))}
            </li>
          ))}
        </Tag>
      )
    }
    case 'table': {
      const tb = t as Tokens.Table
      return (
        <div key={k} className="u-scroll my-3 overflow-x-auto rounded-[8px] shadow-[inset_0_0_0_1px_var(--u-edge)]">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-(--u-wash-hover)">
                {tb.header.map((h, i) => (
                  <th key={i} className="border-b border-(--u-edge) px-3 py-2 text-left font-semibold" style={{ textAlign: tb.align[i] ?? undefined }}>
                    {inline(h.tokens, `${k}h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r, ri) => (
                <tr key={ri} className="border-b border-(--u-edge) last:border-0">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-1.5 align-top" style={{ textAlign: tb.align[ci] ?? undefined }}>
                      {inline(c.tokens, `${k}r${ri}c${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'hr':
      return <hr key={k} className="my-5 border-0 border-t border-(--u-edge)" />
    case 'space':
      return null
    case 'html':
      return <p key={k} className="my-2.5 whitespace-pre-wrap">{(t as Tokens.HTML).text}</p>
    case 'text': {
      const tt = t as Tokens.Text
      return <p key={k} className="my-2.5">{tt.tokens ? inline(tt.tokens, k) : decode(tt.text)}</p>
    }
    default:
      return <p key={k} className="my-2.5 whitespace-pre-wrap">{(t as { raw?: string }).raw}</p>
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  // An unfinished code fence while streaming still renders as code.
  const fences = (text.match(/^```/gm) ?? []).length
  const src = fences % 2 ? text + '\n```' : text
  const tokens = marked.lexer(src, { gfm: true, breaks: false })
  return <div className="text-[14.5px] leading-[1.7]">{tokens.map((t, i) => block(t, String(i)))}</div>
})
