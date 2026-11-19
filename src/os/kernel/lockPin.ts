import { getPref, setPref } from './prefs'

/** A fresh install has no PIN. The lock screen asks the person to create one the first time it is used. */
export const DEFAULT_PIN_LENGTH = 4

export async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((x) => parseInt(x, 16)))
const ITERATIONS = 200_000

async function derive(text: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits'])
  return toHex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256)))
}

/** A salted, slow hash for a PIN or password: `pbkdf2$iterations$salt$hash`. */
export async function hashSecret(text: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${await derive(text, salt, ITERATIONS)}`
}

/** Checks text against a stored hash. Plain SHA-256 values from older versions still verify. */
export async function checkSecret(text: string, stored: string): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts[0] === 'pbkdf2' && parts.length === 4) return (await derive(text, fromHex(parts[2]), Number(parts[1]))) === parts[3]
  return (await sha256(text)) === stored
}

export interface PinConfig {
  hash: string
  length: number
}

export async function loadPinConfig(): Promise<PinConfig> {
  const [hash, length] = await Promise.all([getPref('lock.pinHash'), getPref('lock.pinLength')])
  return { hash: hash || '', length: length >= 4 && length <= 8 ? length : DEFAULT_PIN_LENGTH }
}

export async function verifyPin(pin: string): Promise<boolean> {
  return checkSecret(pin, (await loadPinConfig()).hash)
}

/** Changes the PIN. The current one must be right; the new one is digits only, 4 to 8 of them. */
export async function changePin(current: string, next: string): Promise<'ok' | 'wrong-current' | 'invalid'> {
  if ((await loadPinConfig()).hash && !(await verifyPin(current))) return 'wrong-current'
  if (!/^\d{4,8}$/.test(next)) return 'invalid'
  await setPref('lock.pinLength', next.length)
  await setPref('lock.pinHash', await hashSecret(next))
  return 'ok'
}

/** Sets a new PIN without asking for the old one: for someone who forgot it. Settings sits behind the lock itself, so this is no weaker than the lock. */
export async function resetPin(next: string): Promise<'ok' | 'invalid'> {
  if (!/^\d{4,8}$/.test(next)) return 'invalid'
  await setPref('lock.pinLength', next.length)
  await setPref('lock.pinHash', await hashSecret(next))
  return 'ok'
}
