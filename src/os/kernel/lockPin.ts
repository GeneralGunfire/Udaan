import { getPref, setPref } from './prefs'

/** The PIN Udaan Lock shipped with, used until you choose your own. */
export const DEFAULT_PIN_HASH = 'REMOVED-HASH'
export const DEFAULT_PIN_LENGTH = 4

export async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface PinConfig {
  hash: string
  length: number
}

export async function loadPinConfig(): Promise<PinConfig> {
  const [hash, length] = await Promise.all([getPref('lock.pinHash'), getPref('lock.pinLength')])
  return { hash: hash || DEFAULT_PIN_HASH, length: length >= 4 && length <= 8 ? length : DEFAULT_PIN_LENGTH }
}

export async function verifyPin(pin: string): Promise<boolean> {
  return (await sha256(pin)) === (await loadPinConfig()).hash
}

/** Changes the PIN. The current one must be right; the new one is digits only, 4 to 8 of them. */
export async function changePin(current: string, next: string): Promise<'ok' | 'wrong-current' | 'invalid'> {
  if (!(await verifyPin(current))) return 'wrong-current'
  if (!/^\d{4,8}$/.test(next)) return 'invalid'
  await setPref('lock.pinLength', next.length)
  await setPref('lock.pinHash', await sha256(next))
  return 'ok'
}
