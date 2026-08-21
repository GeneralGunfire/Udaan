export type TriggerType = 'claude-task-failed' | 'new-file-in-folder'
export type ActionType = 'notify' | 'run-claude-task'

export interface FolderWatchConfig {
  folderPath: string
}

export interface NotifyActionConfig {
  message: string
}

export interface RunClaudeTaskActionConfig {
  /** Prompt template — `{{file_name}}` / `{{file_path}}` are substituted for new-file-in-folder triggers. */
  promptTemplate: string
}

export interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  trigger: TriggerType
  /** Only meaningful for 'new-file-in-folder'. */
  triggerConfig: FolderWatchConfig | null
  action: ActionType
  actionConfig: NotifyActionConfig | RunClaudeTaskActionConfig
  createdAt: string
  lastFiredAt: string | null
}

export function defaultRuleFor(trigger: TriggerType): Omit<AutomationRule, 'id' | 'createdAt' | 'lastFiredAt'> {
  if (trigger === 'new-file-in-folder') {
    return {
      name: 'When a new file lands in a folder',
      enabled: true,
      trigger,
      triggerConfig: { folderPath: '' },
      action: 'notify',
      actionConfig: { message: 'New file detected: {{file_name}}' },
    }
  }
  return {
    name: 'When a Claude Code task fails',
    enabled: true,
    trigger: 'claude-task-failed',
    triggerConfig: null,
    action: 'notify',
    actionConfig: { message: 'A Claude Code task failed.' },
  }
}
