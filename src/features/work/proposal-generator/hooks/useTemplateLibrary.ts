import { useCallback, useEffect, useState } from 'react'
import { listTemplates, registerTemplate, type DocumentTemplate } from '@/integrations/template-library'
import { WORK_STARTER_TEMPLATES } from '../lib/starterTemplates'

/**
 * Loads Work's templates from the shared template library, seeding the
 * starter set on first run (idempotent — `registerTemplate` upserts by
 * id, so re-seeding on every mount is safe and just keeps the starters
 * up to date if their body text changes in a future session).
 */
export function useTemplateLibrary() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listTemplates('work')
      setTemplates(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function seedAndLoad() {
      try {
        for (const t of WORK_STARTER_TEMPLATES) {
          await registerTemplate(t)
        }
      } catch (err) {
        console.error('Failed to seed Work starter templates', err)
      }
      if (!cancelled) await reload()
    }
    seedAndLoad()
    return () => {
      cancelled = true
    }
  }, [reload])

  return { templates, loading, error, reload }
}
