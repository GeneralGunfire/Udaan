import { useState } from 'react'
import { pickAssetFolder } from '@/integrations/asset-library'
import type { ActionType, AutomationRule, TriggerType } from '../lib/types'
import { defaultRuleFor } from '../lib/types'
import { PlusIcon, FolderIcon } from '@/shared/icons'

interface NewRuleFormProps {
  onCreate: (rule: Omit<AutomationRule, 'id' | 'createdAt' | 'lastFiredAt'>) => void
}

export function NewRuleForm({ onCreate }: NewRuleFormProps) {
  const [open, setOpen] = useState(false)
  const [trigger, setTrigger] = useState<TriggerType>('new-file-in-folder')
  const [folderPath, setFolderPath] = useState('')
  const [action, setAction] = useState<ActionType>('notify')
  const [message, setMessage] = useState('New file detected: {{file_name}}')
  const [promptTemplate, setPromptTemplate] = useState('Summarize the file {{file_name}}')
  const [name, setName] = useState('')

  async function pickFolder() {
    const chosen = await pickAssetFolder()
    if (chosen) setFolderPath(chosen)
  }

  function submit() {
    const base = defaultRuleFor(trigger)
    onCreate({
      ...base,
      name: name.trim() || base.name,
      trigger,
      triggerConfig: trigger === 'new-file-in-folder' ? { folderPath } : null,
      action,
      actionConfig:
        action === 'notify' ? { message } : { promptTemplate },
    })
    setOpen(false)
    setName('')
  }

  const canSubmit = trigger !== 'new-file-in-folder' || folderPath.trim().length > 0

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-text-secondary hover:text-text-primary hover:bg-glass-hover flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150"
      >
        <PlusIcon width={12} height={12} />
        New rule
      </button>
    )
  }

  return (
    <div className="border-glass-border flex flex-col gap-2 rounded-lg border p-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Rule name (optional)"
        className="border-glass-border bg-glass text-text-primary rounded-md border px-2 py-1.5 text-[11px]"
      />

      <div className="flex items-center gap-2">
        <label className="text-text-secondary w-16 shrink-0 text-[10.5px] font-medium">When</label>
        <select
          value={trigger}
          onChange={(e) => setTrigger(e.target.value as TriggerType)}
          className="border-glass-border bg-glass text-text-primary flex-1 rounded-md border px-2 py-1.5 text-[11px]"
        >
          <option value="new-file-in-folder">A new file lands in a watched folder</option>
          <option value="claude-task-failed">A Claude Code task fails</option>
        </select>
      </div>

      {trigger === 'new-file-in-folder' && (
        <div className="flex items-center gap-2 pl-[72px]">
          <input
            type="text"
            value={folderPath}
            readOnly
            placeholder="No folder chosen"
            className="border-glass-border bg-glass text-text-primary placeholder:text-text-tertiary flex-1 rounded-md border px-2 py-1.5 text-[11px]"
          />
          <button
            type="button"
            onClick={pickFolder}
            className="border-glass-border hover:bg-glass-hover text-text-secondary flex items-center gap-1 rounded-md border px-2 py-1.5 text-[10.5px] font-medium transition-colors duration-150"
          >
            <FolderIcon width={11} height={11} />
            Pick
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-text-secondary w-16 shrink-0 text-[10.5px] font-medium">Do</label>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as ActionType)}
          className="border-glass-border bg-glass text-text-primary flex-1 rounded-md border px-2 py-1.5 text-[11px]"
        >
          <option value="notify">Create a notification</option>
          <option value="run-claude-task">Run a Claude Code task</option>
        </select>
      </div>

      <div className="pl-[72px]">
        {action === 'notify' ? (
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Notification message ({{file_name}} available for folder triggers)"
            className="border-glass-border bg-glass text-text-primary w-full rounded-md border px-2 py-1.5 text-[11px]"
          />
        ) : (
          <input
            type="text"
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            placeholder="Prompt ({{file_name}} / {{file_path}} available for folder triggers)"
            className="border-glass-border bg-glass text-text-primary w-full rounded-md border px-2 py-1.5 text-[11px]"
          />
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-text-tertiary hover:text-text-secondary rounded-md px-2.5 py-1.5 text-[11px]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="text-white disabled:opacity-40"
          style={{
            background: 'var(--gradient-brand)',
            borderRadius: 'var(--radius-md)',
            padding: '6px 14px',
            fontSize: '11px',
            fontWeight: 600,
          }}
        >
          Create rule
        </button>
      </div>
    </div>
  )
}
