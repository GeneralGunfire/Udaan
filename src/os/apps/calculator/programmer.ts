/** Programmer mode arithmetic: fixed-width integers on BigInt, so 64-bit values are exact. */

export type Radix = 2 | 8 | 10 | 16
export type Width = 8 | 16 | 32 | 64
export type BinOp =
  | 'and'
  | 'or'
  | 'xor'
  | 'nand'
  | 'nor'
  | 'lsh'
  | 'rsh'
  | 'rol'
  | 'ror'
  | '+'
  | '-'
  | '*'
  | '/'
  | 'mod'

export const RADIX_NAME: Record<Radix, string> = {
  16: 'HEX',
  10: 'DEC',
  8: 'OCT',
  2: 'BIN',
}

const bits = (w: Width) => BigInt(w)
const maskOf = (w: Width) => (1n << bits(w)) - 1n

/** Wraps a value to the word: unsigned 0..2^w-1, or signed two's complement. */
export function normalize(v: bigint, width: Width, signed: boolean): bigint {
  let u = v & maskOf(width)
  if (signed && u >> (bits(width) - 1n) === 1n) u -= 1n << bits(width)
  return u
}

/** The raw bit pattern, always non-negative. */
export const unsignedBits = (v: bigint, width: Width) => v & maskOf(width)

export function toRadix(
  v: bigint,
  radix: Radix,
  width: Width,
  signed: boolean,
): string {
  // Decimal shows the value; other bases show the bit pattern, as programmers expect.
  if (radix === 10) return normalize(v, width, signed).toString(10)
  return unsignedBits(v, width).toString(radix).toUpperCase()
}

/** Groups digits for readability: 4 for binary and hex, 3 for octal and decimal. */
export function groupDigits(s: string, radix: Radix): string {
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  const n = radix === 2 || radix === 16 ? 4 : 3
  const sep = radix === 10 ? ',' : ' '
  const out = body.replace(new RegExp(`\\B(?=(\\w{${n}})+(?!\\w))`, 'g'), sep)
  return (neg ? '-' : '') + out
}

export function digitAllowed(d: string, radix: Radix): boolean {
  const v = parseInt(d, 16)
  return !Number.isNaN(v) && v < radix
}

/** Appends one digit, refusing it when the word would overflow. */
export function appendDigit(
  v: bigint,
  d: string,
  radix: Radix,
  width: Width,
  signed: boolean,
): bigint {
  if (!digitAllowed(d, radix)) return v
  const base =
    radix === 10 ? normalize(v, width, signed) : unsignedBits(v, width)
  const neg = base < 0n
  const mag = (neg ? -base : base) * BigInt(radix) + BigInt(parseInt(d, 16))
  if (radix === 10) {
    const max = signed
      ? (1n << (bits(width) - 1n)) - (neg ? 0n : 1n)
      : maskOf(width)
    if (mag > max) return v
    return normalize(neg ? -mag : mag, width, signed)
  }
  if (mag > maskOf(width)) return v
  return normalize(mag, width, signed)
}

export function removeDigit(
  v: bigint,
  radix: Radix,
  width: Width,
  signed: boolean,
): bigint {
  if (radix === 10) {
    const n = normalize(v, width, signed)
    return normalize(n / 10n, width, signed)
  }
  return normalize(unsignedBits(v, width) / BigInt(radix), width, signed)
}

export class ProgError extends Error {}

export function applyBinary(
  op: BinOp,
  a: bigint,
  b: bigint,
  width: Width,
  signed: boolean,
): bigint {
  const w = bits(width)
  const ua = unsignedBits(a, width)
  const sh = Number(unsignedBits(b, width) % w)
  switch (op) {
    case 'and':
      return normalize(a & b, width, signed)
    case 'or':
      return normalize(a | b, width, signed)
    case 'xor':
      return normalize(a ^ b, width, signed)
    case 'nand':
      return normalize(~(a & b), width, signed)
    case 'nor':
      return normalize(~(a | b), width, signed)
    case 'lsh':
      return normalize(a << unsignedBits(b, width), width, signed)
    case 'rsh': {
      const n = unsignedBits(b, width)
      // Arithmetic shift when signed, logical when unsigned.
      return normalize(
        signed ? normalize(a, width, true) >> n : ua >> n,
        width,
        signed,
      )
    }
    case 'rol':
      return normalize(
        ((ua << BigInt(sh)) | (ua >> (w - BigInt(sh)))) & maskOf(width),
        width,
        signed,
      )
    case 'ror':
      return normalize(
        ((ua >> BigInt(sh)) | (ua << (w - BigInt(sh)))) & maskOf(width),
        width,
        signed,
      )
    case '+':
      return normalize(a + b, width, signed)
    case '-':
      return normalize(a - b, width, signed)
    case '*':
      return normalize(a * b, width, signed)
    case '/':
      if (b === 0n) throw new ProgError('Cannot divide by zero')
      return normalize(a / b, width, signed)
    case 'mod':
      if (b === 0n) throw new ProgError('Cannot divide by zero')
      return normalize(a % b, width, signed)
  }
}

export const bitNot = (v: bigint, width: Width, signed: boolean) =>
  normalize(~v, width, signed)
export const negate = (v: bigint, width: Width, signed: boolean) =>
  normalize(-v, width, signed)
export const toggleBit = (
  v: bigint,
  bit: number,
  width: Width,
  signed: boolean,
) => normalize(v ^ (1n << BigInt(bit)), width, signed)
export const bitAt = (v: bigint, bit: number, width: Width) =>
  ((unsignedBits(v, width) >> BigInt(bit)) & 1n) === 1n

export const OP_LABEL: Record<BinOp, string> = {
  and: 'AND',
  or: 'OR',
  xor: 'XOR',
  nand: 'NAND',
  nor: 'NOR',
  lsh: '<<',
  rsh: '>>',
  rol: 'RoL',
  ror: 'RoR',
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
  mod: 'mod',
}
