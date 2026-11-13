import { memo, useMemo } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { convertFileSrc } from '@tauri-apps/api/core'
import { openWithSystem } from '@/integrations/file-explorer/client'
import { launchApp } from '@/integrations/installed-apps/client'

const marked = new Marked({ gfm: true, breaks: true })

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

marked.use({
  renderer: {
    // Code blocks get a language label and a copy button (wired by event delegation below).
    code({ text, lang }) {
      const label = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : '<span></span>'
      return `<div class="md-code"><div class="md-code-bar">${label}<button type="button" data-copy>Copy</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`
    },
  },
})

/** Local image paths (C:\...) become asset URLs the webview can load. */
function localImages(text: string) {
  return text.replace(/!\[([^\]]*)\]\(((?:[A-Za-z]:[\\/]|file:\/\/\/)[^)]+)\)/g, (_m, alt: string, path: string) => `![${alt}](${convertFileSrc(decodeURI(path.replace(/^file:\/\/\//, '')))})`)
}

/**
 * Chat message markdown: headings, lists, tables, links, quotes, code
 * blocks with copy, and images (web or local files). AI output is
 * untrusted, so everything passes through DOMPurify before rendering.
 */
export const MessageText = memo(function MessageText({ text }: { text: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(localImages(text), { async: false }) as string
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['data-copy'], ALLOWED_URI_REGEXP: /^(?:https?:|http:\/\/asset\.localhost|asset:|data:image\/|mailto:)/i })
  }, [text])

  return (
    <div
      className="md-body select-text"
      onClick={(e) => {
        const el = e.target as HTMLElement
        if (el.matches('button[data-copy]')) {
          const code = el.closest('.md-code')?.querySelector('code')?.textContent ?? ''
          void navigator.clipboard.writeText(code)
          el.textContent = 'Copied'
          setTimeout(() => (el.textContent = 'Copy'), 1400)
          return
        }
        // Links open in the default browser; images open full size.
        const a = el.closest('a')
        if (a?.href) {
          e.preventDefault()
          void launchApp(a.href)
          return
        }
        if (el instanceof HTMLImageElement) {
          const local = el.src.match(/^http:\/\/asset\.localhost\/(.+)$/)
          if (local) void openWithSystem(decodeURIComponent(local[1]))
          else void launchApp(el.src)
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
