import { useCallback, useState } from 'react'
import { loadRules, saveRules } from '../lib/rulesStore'
import type { AutomationRule } from '../lib/types'

let idCounter = 0
function nextId() {
  idCounter += 1
  return `rule-${Date.now()}-${idCounter}`
}

export function useAutomationRules() {
  const [rules, setRules] = useState<AutomationRule[]>(() => loadRules())

  const persist = useCallback((next: AutomationRule[]) => {
    setRules(next)
    saveRules(next)
  }, [])

  const createRule = useCallback(
    (input: Omit<AutomationRule, 'id' | 'createdAt' | 'lastFiredAt'>) => {
      const rule: AutomationRule = {
        ...input,
        id: nextId(),
        createdAt: new Date().toISOString(),
        lastFiredAt: null,
      }
      persist([rule, ...rules])
    },
    [rules, persist],
  )

  const toggleRule = useCallback(
    (id: string) => {
      persist(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)))
    },
    [rules, persist],
  )

  const deleteRule = useCallback(
    (id: string) => {
      persist(rules.filter((r) => r.id !== id))
    },
    [rules, persist],
  )

  const markFired = useCallback(
    (id: string) => {
      setRules((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, lastFiredAt: new Date().toISOString() } : r))
        saveRules(next)
        return next
      })
    },
    [],
  )

  return { rules, createRule, toggleRule, deleteRule, markFired }
}
