import { useEffect, useState } from 'react'
import { detectApps } from '@/integrations/installed-apps/client'
import type { NewFileKind } from '@/integrations/file-explorer/types'

export interface NewFileOption {
  kind: NewFileKind
  label: string
}

const TEXT_OPTION: NewFileOption = { kind: 'text', label: 'Text Document' }

const OFFICE_OPTIONS: Record<string, NewFileOption> = {
  word: { kind: 'word', label: 'Word Document' },
  excel: { kind: 'excel', label: 'Excel Spreadsheet' },
  powerpoint: { kind: 'power_point', label: 'PowerPoint Presentation' },
}

/** "New file" options for the toolbar/context menu — Text is always available; Office options only appear for apps actually detected as installed (same detection as the Launchpad's Microsoft folder). */
export function useNewFileKinds(): NewFileOption[] {
  const [officeOptions, setOfficeOptions] = useState<NewFileOption[]>([])

  useEffect(() => {
    let cancelled = false
    detectApps('microsoft')
      .then((apps) => {
        if (cancelled) return
        const options = apps
          .map((app) => OFFICE_OPTIONS[app.id])
          .filter((option): option is NewFileOption => !!option)
        setOfficeOptions(options)
      })
      .catch(() => {
        if (!cancelled) setOfficeOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return [TEXT_OPTION, ...officeOptions]
}
