/**
 * Best-effort rendering of one `claude --output-format stream-json` line.
 * Unknown/unparseable shapes fall back to the raw line so nothing is hidden.
 */
export interface RenderedLine {
  key: string
  text: string
  variant: 'assistant' | 'tool' | 'system' | 'result' | 'raw'
}

let counter = 0

export function parseStreamLine(line: string): RenderedLine {
  const key = `l${counter++}`
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    return { key, text: line, variant: 'raw' }
  }
  if (typeof json !== 'object' || json === null) {
    return { key, text: line, variant: 'raw' }
  }
  const obj = json as Record<string, unknown>

  if (obj.type === 'assistant' && isRecord(obj.message)) {
    const content = obj.message.content
    if (Array.isArray(content)) {
      const text = content
        .filter((c): c is { type: string; text?: string } => isRecord(c))
        .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
        .join('')
      if (text) return { key, text, variant: 'assistant' }
    }
  }

  if (obj.type === 'result' && typeof obj.result === 'string') {
    return { key, text: obj.result, variant: 'result' }
  }

  if (obj.type === 'system') {
    return { key, text: `${String(obj.subtype ?? 'system')}`, variant: 'system' }
  }

  return { key, text: line, variant: 'raw' }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
