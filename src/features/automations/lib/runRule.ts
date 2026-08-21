import { submitTask } from '@/integrations/claude-code'
import { homeDir } from '@tauri-apps/api/path'
import { pushNotification } from '@/features/notifications/lib/notificationStore'
import type { AutomationRule, NotifyActionConfig, RunClaudeTaskActionConfig } from './types'

function fillPromptTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match)
}

/**
 * Executes one rule's action, given whatever context the trigger that
 * fired it produced (e.g. a new file's name/path). Both action types are
 * genuinely wired — 'notify' pushes into the real Notification Hub log
 * (src/features/notifications), 'run-claude-task' submits a real headless
 * Claude Code run via the same integrations/claude-code path General
 * Chat uses.
 */
export async function runRuleAction(
  rule: AutomationRule,
  context: Record<string, string> = {},
): Promise<void> {
  if (rule.action === 'notify') {
    const config = rule.actionConfig as NotifyActionConfig
    pushNotification({
      message: fillPromptTemplate(config.message, context),
      source: rule.name,
    })
    return
  }

  if (rule.action === 'run-claude-task') {
    const config = rule.actionConfig as RunClaudeTaskActionConfig
    const prompt = fillPromptTemplate(config.promptTemplate, context)
    const cwd = await homeDir()
    await submitTask(prompt, cwd)
    return
  }
}
