// @ts-nocheck -- this test reads source files with Node APIs; the app's tsconfig has no Node types.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The frontend and the Rust side are joined only by strings: `invoke('some_command')`. A rename or a
 * deletion on one side fails silently at runtime, in whichever window happens to call it. This test
 * makes that a build-time failure: every command the frontend invokes must be registered in Rust.
 */

const root = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

function registeredCommands(): Set<string> {
  const lib = readFileSync(join(root, 'src-tauri', 'src', 'lib.rs'), 'utf8')
  const start = lib.indexOf('generate_handler![')
  const end = lib.indexOf('])', start)
  const body = lib.slice(start, end)
  const names = new Set<string>()
  for (const m of body.matchAll(/^\s*(?:[a-z_0-9]+::)*([a-z_0-9]+),/gm)) names.add(m[1])
  return names
}

function invokedCommands(): Map<string, string> {
  const found = new Map<string, string>()
  const re = /invoke(?:<[^(]*?>)?\(\s*['"]([a-z][a-z0-9_]*)['"]/g
  for (const file of walk(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) if (!found.has(m[1])) found.set(m[1], file.replace(root, ''))
  }
  return found
}

describe('frontend/backend command contract', () => {
  it('registers every command the frontend invokes', () => {
    const registered = registeredCommands()
    expect(registered.size).toBeGreaterThan(100)
    const missing = [...invokedCommands()].filter(([name]) => !registered.has(name))
    expect(missing.map(([name, file]) => `${name}  (called in ${file})`)).toEqual([])
  })
})
