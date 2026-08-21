const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g

/** Extracts every unique `{{placeholder}}` token from a template body, in first-appearance order. */
export function extractPlaceholders(body: string): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const key = match[1]
    if (!seen.has(key)) {
      seen.add(key)
      ordered.push(key)
    }
  }
  return ordered
}

/** Replaces every `{{placeholder}}` token with the provided value, or leaves it unfilled if no value was given. */
export function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(PLACEHOLDER_PATTERN, (match, key) => {
    const value = values[key]
    return value && value.trim() ? value : match
  })
}

/** Human-readable label for a placeholder key, e.g. "client_name" -> "Client name". */
export function placeholderLabel(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
