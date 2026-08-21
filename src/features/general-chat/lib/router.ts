/**
 * Router mode heuristic: picks `local` (fast, free, on-device) unless the
 * prompt looks like it needs real reasoning, code, or multi-step work, in
 * which case it defers to `claude`. Deliberately simple — a real classifier
 * is overkill for a 1.5B on-device model whose job is short/simple replies.
 */
const CLAUDE_SIGNAL = /\b(code|debug|refactor|implement|build|write a|analyze|plan|architecture|bug|error|function|class|api|script)\b/i

export function routeMode(prompt: string): 'local' | 'claude' {
  if (prompt.length > 240) return 'claude'
  if (CLAUDE_SIGNAL.test(prompt)) return 'claude'
  return 'local'
}
