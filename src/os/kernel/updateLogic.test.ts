import { describe, expect, it } from 'vitest'
import { compareVersions, pickUpdate, type ReleaseFile } from './updateLogic'

const file = (version: string, urls: { '10'?: string; '11'?: string } = {}): ReleaseFile => ({
  version,
  date: '2026-12-01',
  installers: {
    '10': { url: urls['10'] ?? null, size: '90 MB', sha256: urls['10'] ? 'a'.repeat(64) : null },
    '11': { url: urls['11'] ?? null, size: '90 MB', sha256: urls['11'] ? 'b'.repeat(64) : null },
  },
  updates: [{ date: '2026-12-01', kind: 'release', version, title: 'Things got better', notes: ['One', 'Two'] }],
})

describe('compareVersions', () => {
  it('orders numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('1.0', '1.0.1')).toBe(-1)
  })
})

describe('pickUpdate', () => {
  it('offers a newer version with the installer for this Windows', () => {
    const a = pickUpdate(file('0.2.0', { '10': 'https://x/w10-setup.exe', '11': 'https://x/w11-setup.exe' }), '0.1.0', '11')
    expect(a?.url).toBe('https://x/w11-setup.exe')
    expect(a?.notes).toEqual(['One', 'Two'])
  })
  it('offers nothing when already up to date or ahead', () => {
    expect(pickUpdate(file('0.1.0', { '10': 'https://x/a' }), '0.1.0', '10')).toBeNull()
    expect(pickUpdate(file('0.1.0', { '10': 'https://x/a' }), '0.2.0', '10')).toBeNull()
  })
  it('offers nothing when this Windows has no installer yet', () => {
    expect(pickUpdate(file('0.2.0', { '10': 'https://x/a' }), '0.1.0', '11')).toBeNull()
  })
  it('refuses an installer that has no checksum', () => {
    const f = file('0.2.0', { '10': 'https://x/a' })
    f.installers['10'].sha256 = null
    expect(pickUpdate(f, '0.1.0', '10')).toBeNull()
  })
})
