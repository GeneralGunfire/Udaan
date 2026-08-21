import { invoke } from '@tauri-apps/api/core'
import type { DocumentTemplate, TemplateOwner } from './types'

/** Raw shape returned by the Rust `template_library_list` command (serde snake_case). */
interface RawTemplate {
  id: string
  owner: string
  category: string
  name: string
  description: string
  body: string
  created_at: string
}

function fromRaw(raw: RawTemplate): DocumentTemplate {
  return {
    id: raw.id,
    owner: raw.owner as TemplateOwner,
    category: raw.category,
    name: raw.name,
    description: raw.description,
    body: raw.body,
    createdAt: raw.created_at,
  }
}

/** Lists templates, optionally filtered to one owner ('school' | 'work'). Omit to list every registered template. */
export async function listTemplates(owner?: TemplateOwner): Promise<DocumentTemplate[]> {
  const raw = await invoke<RawTemplate[]>('template_library_list', { owner: owner ?? null })
  return raw.map(fromRaw)
}

/**
 * Registers (or updates, if the id already exists) a template in the
 * shared library. Called at app startup by each feature's seed module to
 * ensure its starter templates exist — idempotent via SQLite upsert.
 */
export async function registerTemplate(template: DocumentTemplate): Promise<void> {
  await invoke('template_library_register', {
    template: {
      id: template.id,
      owner: template.owner,
      category: template.category,
      name: template.name,
      description: template.description,
      body: template.body,
      created_at: template.createdAt,
    },
  })
}
