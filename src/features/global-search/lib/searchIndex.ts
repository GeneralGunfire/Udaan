import { listTasks } from '@/integrations/claude-code'
import { getNotifications } from '@/features/notifications/lib/notificationStore'
import { listTemplates } from '@/integrations/template-library'
import { fuzzyScore } from './fuzzyMatch'
import type { SearchResult } from './types'

/**
 * Pulls a fresh snapshot from every real, currently-persisted source at search time (small
 * data volumes for a personal single-user app — no need to maintain a live index). Sources:
 * Claude Code task history, the notification log, registered document templates (the closest
 * thing to "documents" that actually persists today — Study Generator and a Word Processor
 * were named as examples in the brief, but neither persists output yet, see NOTES.md).
 */
async function buildCorpus(): Promise<SearchResult[]> {
  const [tasks, templates] = await Promise.all([
    listTasks().catch(() => []),
    listTemplates().catch(() => []),
  ])
  const notifications = getNotifications()

  const results: SearchResult[] = []

  for (const task of tasks) {
    results.push({
      id: `task-${task.id}`,
      kind: 'task',
      title: task.prompt,
      subtitle: `Claude Code · ${task.status}`,
      createdAt: task.created_at,
      navTarget: { kind: 'task', id: task.id },
    })
  }

  for (const n of notifications) {
    results.push({
      id: `notification-${n.id}`,
      kind: 'notification',
      title: n.prompt,
      subtitle: n.source ? `Notification · ${n.source}` : 'Notification',
      createdAt: n.createdAt,
      navTarget: { kind: 'notification', id: n.id },
    })
  }

  for (const t of templates) {
    results.push({
      id: `document-${t.id}`,
      kind: 'document',
      title: t.name,
      subtitle: `Template · ${t.owner}/${t.category}`,
      createdAt: t.createdAt,
      navTarget: { kind: 'document', id: t.id },
    })
  }

  return results
}

export async function searchEverything(query: string, limit = 30): Promise<SearchResult[]> {
  if (!query.trim()) return []
  const corpus = await buildCorpus()
  const scored = corpus
    .map((item) => {
      const score = Math.max(
        fuzzyScore(query, item.title) ?? -1,
        (fuzzyScore(query, item.subtitle) ?? -1) - 0.5, // subtitle matches rank slightly lower
      )
      return { item, score }
    })
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map((s) => s.item)
}
