import { useEffect, useRef } from 'react'
import { onTaskEvent } from '@/integrations/claude-code'
import { pollFolderForNewFiles } from '@/integrations/folder-watcher'
import { runRuleAction } from '../lib/runRule'
import type { AutomationRule } from '../lib/types'
import type { FolderWatchConfig } from '../lib/types'

const FOLDER_POLL_INTERVAL_MS = 5000

/**
 * Runs the two real trigger checks against the current rule set:
 *   - 'claude-task-failed': event-driven, via the same onTaskEvent stream
 *     General Chat and the Notification Hub already subscribe to.
 *   - 'new-file-in-folder': polls every 5s via the Rust folder_watcher
 *     snapshot-diff command (see src-tauri/src/folder_watcher).
 * Fires `runRuleAction` for every enabled rule whose trigger matches.
 * `onRuleFired` lets the UI update `lastFiredAt` without this hook owning
 * rule storage itself.
 */
export function useAutomationEngine(rules: AutomationRule[], onRuleFired: (ruleId: string) => void) {
  const rulesRef = useRef(rules)
  rulesRef.current = rules

  // Claude-task-failed trigger
  useEffect(() => {
    const unlistenPromise = onTaskEvent((event) => {
      if (event.kind !== 'status' || event.status !== 'failed') return
      for (const rule of rulesRef.current) {
        if (!rule.enabled || rule.trigger !== 'claude-task-failed') continue
        runRuleAction(rule, { task_id: event.task_id })
        onRuleFired(rule.id)
      }
    })
    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [onRuleFired])

  // New-file-in-folder trigger — polled, one interval per distinct watched folder.
  useEffect(() => {
    const folderRules = rulesRef.current.filter(
      (r) => r.enabled && r.trigger === 'new-file-in-folder' && (r.triggerConfig as FolderWatchConfig)?.folderPath,
    )
    const uniqueFolders = Array.from(
      new Set(folderRules.map((r) => (r.triggerConfig as FolderWatchConfig).folderPath)),
    )

    const intervalId = window.setInterval(async () => {
      for (const folderPath of uniqueFolders) {
        try {
          const newFiles = await pollFolderForNewFiles(folderPath)
          if (newFiles.length === 0) continue
          for (const rule of rulesRef.current) {
            if (!rule.enabled || rule.trigger !== 'new-file-in-folder') continue
            if ((rule.triggerConfig as FolderWatchConfig)?.folderPath !== folderPath) continue
            for (const file of newFiles) {
              await runRuleAction(rule, { file_name: file.fileName, file_path: file.path })
            }
            onRuleFired(rule.id)
          }
        } catch (err) {
          console.error('Folder watch poll failed for', folderPath, err)
        }
      }
    }, FOLDER_POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules.map((r) => `${r.id}:${r.enabled}:${r.trigger}`).join(','), onRuleFired])
}
