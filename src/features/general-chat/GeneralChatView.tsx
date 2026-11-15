import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useGeneralChat } from './hooks/useGeneralChat'
import { MessageText } from '@/shared/components/MessageText'
import { ThinkingIndicator } from '@/shared/components/ThinkingIndicator'
import { SearchIcon, TrashIcon, CopyIcon } from '@/shared/icons'
import type { ChatSession } from '@/integrations/general-chat'

const SUGGESTIONS = [
  { title: 'Plan my week', prompt: 'Help me plan my week. Ask me what I have on first.' },
  { title: 'Explain something', prompt: 'Explain how black holes form, simply, with an analogy.' },
  { title: 'Create an image', prompt: '/imagine a cinematic sunset over Cape Town, Table Mountain in the background' },
  { title: 'Write for me', prompt: 'Write a short, friendly email asking my teacher for an extension on my project.' },
]

function groupSessions(sessions: ChatSession[]) {
  const now = Date.now()
  const groups: { label: string; items: ChatSession[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const s of sessions) {
    const age = now - new Date(s.updated_at || s.created_at).getTime()
    groups[age < 86_400_000 ? 0 : age < 7 * 86_400_000 ? 1 : 2].items.push(s)
  }
  return groups.filter((g) => g.items.length)
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']

/** Chat: a ChatGPT-style assistant with saved conversations, pictures in and out. */
export function GeneralChatView() {
  const chat = useGeneralChat('omniroute')
  const [draft, setDraft] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [dragging, setDragging] = useState(false)
  const [web, setWeb] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const groups = useMemo(() => groupSessions(chat.sessions.filter((s) => !search || s.title.toLowerCase().includes(search.toLowerCase()))), [chat.sessions, search])
  const current = chat.sessions.find((s) => s.id === chat.sessionId)

  // Keep the newest message in view.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [chat.messages])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(220, el.scrollHeight)}px`
  }, [draft])

  const send = (text = draft) => {
    if (chat.responding || (!text.trim() && !images.length)) return
    void chat.send(text, images, web)
    setDraft('')
    setImages([])
  }

  const addFiles = async (files: File[]) => {
    for (const f of files.filter((f) => f.type.startsWith('image/')).slice(0, 4)) {
      const bytes = Array.from(new Uint8Array(await f.arrayBuffer()))
      const path = await invoke<string>('chat_save_image', { bytes, extension: f.name.split('.').pop() ?? 'png' }).catch(() => null)
      if (path) setImages((prev) => [...prev, path].slice(0, 4))
    }
  }

  const pickImages = async () => {
    const picked = await openDialog({ multiple: true, filters: [{ name: 'Images', extensions: IMAGE_EXT }] })
    const list = Array.isArray(picked) ? picked : picked ? [picked] : []
    setImages((prev) => [...prev, ...list].slice(0, 4))
  }

  const lastUserText = [...chat.messages].reverse().find((m) => m.role === 'user')?.text.split('\n\n![')[0]

  return (
    <div className="flex h-full bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      {/* ---------- conversations ---------- */}
      <aside className="flex w-[270px] shrink-0 flex-col border-r border-[var(--border-hairline)] bg-[var(--surface-raised)]">
        <div className="p-3">
          <button
            type="button"
            onClick={() => {
              chat.newChat()
              inputRef.current?.focus()
            }}
            className="u-btn u-btn--tonal h-10 w-full justify-start gap-2 px-3 text-[13.5px] font-medium"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New chat
          </button>
          <label className="u-search mt-2 h-9">
            <SearchIcon width={13} height={13} className="text-[var(--color-text-tertiary)]" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--color-text-tertiary)]" />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {groups.length === 0 && <p className="px-3 py-4 text-[12.5px] text-[var(--color-text-tertiary)]">{search ? 'No chats match' : 'Your chats will be saved here'}</p>}
          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-3 pb-1 text-[11px] font-semibold text-[var(--color-text-tertiary)]">{g.label}</p>
              {g.items.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => chat.switchSession(s.id)}
                  data-selected={s.id === chat.sessionId || undefined}
                  className="u-row group h-9 gap-2 px-3 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <button
                    type="button"
                    aria-label="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (window.confirm(`Delete "${s.title}"?`)) void chat.closeSession(s.id)
                    }}
                    className="hidden rounded p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] group-hover:block"
                  >
                    <TrashIcon width={13} height={13} />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-[var(--border-hairline)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
          <span className="h-2 w-2 rounded-full bg-(--u-ok)" />
          <span className="min-w-0 flex-1 truncate">{chat.provider ? `Answered by ${chat.provider}` : 'AI ready'}</span>
          {chat.lastLatencyMs != null && <span className="tabular-nums text-(--u-ink-3)">{(chat.lastLatencyMs / 1000).toFixed(1)}s</span>}
        </div>
      </aside>

      {/* ---------- thread ---------- */}
      <main
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void addFiles(Array.from(e.dataTransfer.files))
        }}
      >
        <header className="flex h-12 shrink-0 items-center border-b border-[var(--border-hairline)] px-5">
          <p className="truncate text-[14px] font-semibold">{current?.title ?? 'New chat'}</p>
        </header>

        <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
          {chat.messages.length === 0 && !chat.loadingHistory ? (
            <div className="mx-auto flex h-full max-w-[720px] flex-col items-center justify-center px-6">
              <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-[30px] font-semibold tracking-tight">
                What can I help with?
              </motion.h1>
              <div className="mt-8 grid w-full grid-cols-2 gap-3">
                {SUGGESTIONS.map((s, i) => (
                  <motion.button
                    key={s.title}
                    type="button"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 + i * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    onClick={() => send(s.prompt)}
                    className="u-tile items-start p-4 text-left"
                  >
                    <p className="text-[14px] font-semibold">{s.title}</p>
                    <p className="mt-1 line-clamp-2 text-[12.5px] text-[var(--color-text-secondary)]">{s.prompt}</p>
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-[760px] px-6 py-6">
              <AnimatePresence initial={false}>
                {chat.messages.map((m, i) => (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} className="mb-6">
                    {m.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="max-w-[80%] rounded-[18px] rounded-br-[6px] bg-[var(--surface-overlay)] px-4 py-2.5">
                          <MessageText text={m.text} />
                        </div>
                      </div>
                    ) : (
                      <div className="group flex gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-alt)] text-[12px] font-bold">U</span>
                        <div className="min-w-0 flex-1">
                          {m.text ? <MessageText text={m.text} /> : <ThinkingIndicator label={m.steps?.[0]?.label ?? 'Thinking'} />}
                          {m.text && !(chat.responding && i === chat.messages.length - 1) && (
                            <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard.writeText(m.text)
                                  setCopiedId(m.id)
                                  setTimeout(() => setCopiedId(null), 1400)
                                }}
                                className="flex items-center gap-1 rounded-[6px] px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-(--os-hover) hover:text-[var(--color-text-primary)]"
                              >
                                <CopyIcon width={12} height={12} /> {copiedId === m.id ? 'Copied' : 'Copy'}
                              </button>
                              {i === chat.messages.length - 1 && lastUserText && (
                                <button type="button" onClick={() => send(lastUserText)} className="rounded-[6px] px-2 py-1 text-[12px] text-[var(--color-text-secondary)] hover:bg-(--os-hover) hover:text-[var(--color-text-primary)]">
                                  Regenerate
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* ---------- composer ---------- */}
        <div className="shrink-0 px-6 pb-5">
          <div className="mx-auto max-w-[760px] rounded-[20px] border border-[var(--border-hairline)] bg-[var(--surface-raised)] p-2 ">
            {images.length > 0 && (
              <div className="flex gap-2 px-2 pb-2 pt-1">
                {images.map((p) => (
                  <div key={p} className="relative">
                    <img src={convertFileSrc(p)} alt="" className="h-16 w-16 rounded-[10px] object-cover" />
                    <button type="button" aria-label="Remove image" onClick={() => setImages((prev) => prev.filter((x) => x !== p))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-text-primary)] text-[11px] text-[var(--surface-base)] ring-1 ring-[var(--border-hairline)]">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <button type="button" aria-label="Attach images" title="Attach images" onClick={() => void pickImages()} className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-(--os-hover) hover:text-[var(--color-text-primary)]">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2L9.8 17.5a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Search the web"
                aria-pressed={web}
                title={web ? 'Web search on' : 'Search the web for this answer'}
                onClick={() => setWeb((w) => !w)}
                className={`mb-0.5 flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium transition-colors ${web ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] hover:bg-(--os-hover) hover:text-[var(--color-text-primary)]'}`}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
                {web && 'Web'}
              </button>
              <textarea
                ref={inputRef}
                value={draft}
                rows={1}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData.files)
                  if (files.some((f) => f.type.startsWith('image/'))) {
                    e.preventDefault()
                    void addFiles(files)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder="Message Udaan — paste a picture, or try /imagine"
                className="max-h-[220px] min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed outline-none placeholder:text-[var(--color-text-tertiary)]"
              />
              {chat.responding ? (
                <button type="button" aria-label="Stop" onClick={chat.stop} className="u-btn u-btn--primary u-btn--icon u-btn--pill mb-0.5 h-9 w-9 shrink-0">
                  <span className="h-3 w-3 rounded-[3px] bg-[var(--color-text-primary)]" />
                </button>
              ) : (
                <button type="button" aria-label="Send" disabled={!draft.trim() && !images.length} onClick={() => send()} className="u-btn u-btn--primary u-btn--icon u-btn--pill mb-0.5 h-9 w-9 shrink-0 disabled:opacity-30">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--color-text-tertiary)]">Chats are saved automatically. Replies can be wrong — double-check anything important.</p>
        </div>

        <AnimatePresence>
          {dragging && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[20px] border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[16px] font-semibold">
              Drop images to attach
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
