import type { AutomationRule, FolderWatchConfig, NotifyActionConfig, RunClaudeTaskActionConfig } from '../lib/types'
import { BellIcon, FolderIcon, GaugeIcon } from '@/shared/icons'

interface RuleCardProps {
  rule: AutomationRule
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}

const TRIGGER_LABEL: Record<AutomationRule['trigger'], string> = {
  'claude-task-failed': 'When a Claude Code task fails',
  'new-file-in-folder': 'When a new file lands in',
}

export function RuleCard({ rule, onToggle, onDelete }: RuleCardProps) {
  const triggerDetail =
    rule.trigger === 'new-file-in-folder'
      ? (rule.triggerConfig as FolderWatchConfig)?.folderPath || '(no folder set)'
      : null

  const actionDetail =
    rule.action === 'notify'
      ? `Notify: "${(rule.actionConfig as NotifyActionConfig).message}"`
      : `Run Claude Code: "${(rule.actionConfig as RunClaudeTaskActionConfig).promptTemplate}"`

  return (
    <div
      className={`border-glass-border flex flex-col gap-2 rounded-lg border p-3 transition-opacity duration-150 ${
        rule.enabled ? '' : 'opacity-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <GaugeIcon width={12} height={12} className="text-accent-general shrink-0" />
          <span className="text-text-primary text-[12px] font-medium">{rule.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            onClick={() => onToggle(rule.id)}
            className={`relative h-4 w-7 rounded-full transition-colors duration-150 ${
              rule.enabled ? 'bg-accent-general' : 'bg-glass-bg-hover'
            }`}
          >
            <span
              className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform duration-150"
              style={{ transform: rule.enabled ? 'translateX(14px)' : 'translateX(2px)' }}
            />
          </button>
          <button
            type="button"
            onClick={() => onDelete(rule.id)}
            aria-label="Delete rule"
            className="text-text-tertiary hover:text-danger text-[13px]"
          >
            ×
          </button>
        </div>
      </div>

      <div className="text-text-tertiary flex items-start gap-1.5 text-[10.5px]">
        {rule.trigger === 'new-file-in-folder' ? (
          <FolderIcon width={11} height={11} className="mt-0.5 shrink-0" />
        ) : (
          <BellIcon width={11} height={11} className="mt-0.5 shrink-0" />
        )}
        <span>
          {TRIGGER_LABEL[rule.trigger]} {triggerDetail && <span className="text-text-secondary">{triggerDetail}</span>}
        </span>
      </div>
      <p className="text-text-tertiary pl-[18px] text-[10.5px]">{actionDetail}</p>

      {rule.lastFiredAt && (
        <p className="text-text-tertiary pl-[18px] text-[9.5px]">
          Last fired: {new Date(rule.lastFiredAt).toLocaleString()}
        </p>
      )}
    </div>
  )
}
