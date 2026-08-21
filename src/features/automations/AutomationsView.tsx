import { useCallback } from 'react'
import { useAutomationRules } from './hooks/useAutomationRules'
import { useAutomationEngine } from './hooks/useAutomationEngine'
import { RuleCard } from './components/RuleCard'
import { NewRuleForm } from './components/NewRuleForm'
import { GaugeIcon } from '@/shared/icons'

/**
 * Rule-Based Automations — "when X happens, do Y". Two real trigger
 * types (Claude Code task failure, new file in a watched folder) and two
 * real actions (push a Notification Hub entry, run a headless Claude
 * Code task). Rules persist to localStorage (small config, not growing
 * transactional data — see lib/rulesStore.ts for why that's the right
 * fit here vs. SQLite). The actual trigger-checking runs in
 * useAutomationEngine, mounted here so it's active whenever this view
 * is open — see NOTES.md for the judgment call on why it's not a
 * background/always-on engine yet.
 */
export function AutomationsView() {
  const { rules, createRule, toggleRule, deleteRule, markFired } = useAutomationRules()

  const onRuleFired = useCallback((id: string) => markFired(id), [markFired])
  useAutomationEngine(rules, onRuleFired)

  return (
    <div className="flex h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GaugeIcon width={16} height={16} className="text-accent-general" />
          <h1 className="font-display text-text-primary text-[16px] font-semibold">Automations</h1>
        </div>
        <NewRuleForm onCreate={createRule} />
      </div>

      <p className="text-text-tertiary text-[11px] leading-relaxed">
        Rules only run while this view is open. Closing it pauses folder polling and the
        task-failure listener — see NOTES.md for why this session scoped it that way.
      </p>

      {rules.length === 0 ? (
        <div className="border-glass-border rounded-lg border border-dashed p-6 text-center">
          <p className="text-text-tertiary text-[11.5px]">
            No automation rules yet. Create one above.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} onToggle={toggleRule} onDelete={deleteRule} />
          ))}
        </div>
      )}
    </div>
  )
}
