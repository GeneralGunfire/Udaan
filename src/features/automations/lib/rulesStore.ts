import type { AutomationRule } from './types'

const STORAGE_KEY = 'udaan.automations.rules'

/**
 * Automation rules are small, infrequently-changed config (a handful of
 * "when X, do Y" entries), unlike the Client Tracker's growing
 * transactional contact/note data — localStorage is the right fit here,
 * matching the Account profile and folder-path preference patterns
 * elsewhere in this app, rather than a new SQLite table for a few rows.
 */
export function loadRules(): AutomationRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveRules(rules: AutomationRule[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
}
