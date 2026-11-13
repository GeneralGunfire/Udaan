import { useCallback, useEffect, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

/**
 * Edge-light settings, shared by the overlay window that draws them and the
 * flyout that edits them. They live in localStorage (all Udaan windows share
 * one origin, so a write in the flyout reaches the overlay through the
 * `storage` event) and are also broadcast as a Tauri event so a change lands
 * immediately even where storage events are throttled.
 */

export type EdgeColorMode = 'solid' | 'gradient' | 'rainbow' | 'level'
export type EdgeDirection = 'clockwise' | 'anticlockwise'
/** Bars stand on the edge; a wave is one smooth filled curve; glow is a soft ambient wash. */
export type EdgeStyle = 'bars' | 'wave' | 'glow'

export interface EdgeLightConfig {
  enabled: boolean
  style: EdgeStyle
  /** Small caps that hang above each bar and fall slowly (bars only). */
  peaks: boolean
  /** Keep the light lively whether the music is quiet or loud. */
  autoGain: boolean
  /** Which screen edges light up. */
  sides: { top: boolean; right: boolean; bottom: boolean; left: boolean }
  /** Which way the spectrum (bass → treble) travels around the border. */
  direction: EdgeDirection
  /** Fold the spectrum so it mirrors on both halves of the loop. */
  mirror: boolean
  /** Bar thickness, px. */
  thickness: number
  /** Space between bars, as a fraction of the bar width. */
  gap: number
  /** Round-ended bars rather than square-ended. */
  rounded: boolean
  /** How far the light can reach into the screen, px. */
  height: number
  /** Input gain, 0.3–3. */
  sensitivity: number
  /** 0 = twitchy, 0.95 = slow and liquid. */
  smoothing: number
  colorMode: EdgeColorMode
  color1: string
  color2: string
  /** Rainbow / gradient drift, cycles per minute. */
  hueSpeed: number
  /** Master opacity. */
  opacity: number
  /** Soft bloom around the light, px (0 = crisp). */
  softness: number
  /** How strongly beats flash the whole border, 0–1. */
  beatPulse: number
  /** Spin the spectrum around the border, revolutions per minute (signed). */
  spin: number
  /** Round the corners like a phone screen, px. */
  cornerRadius: number
}

export const EDGE_DEFAULTS: EdgeLightConfig = {
  enabled: false,
  style: 'bars',
  peaks: true,
  autoGain: true,
  sides: { top: true, right: true, bottom: true, left: true },
  direction: 'clockwise',
  mirror: true,
  thickness: 5,
  gap: 0.6,
  rounded: true,
  height: 140,
  sensitivity: 1.2,
  smoothing: 0.6,
  colorMode: 'gradient',
  color1: '#4cc9f0',
  color2: '#b5179e',
  hueSpeed: 6,
  opacity: 0.9,
  softness: 6,
  beatPulse: 0.5,
  spin: 0,
  cornerRadius: 0,
}

export interface EdgePreset {
  name: string
  patch: Partial<EdgeLightConfig>
}

export const EDGE_PRESETS: EdgePreset[] = [
  { name: 'Neon', patch: { style: 'bars', peaks: true, thickness: 6, gap: 0.6, height: 140, colorMode: 'rainbow', sides: { top: false, right: false, bottom: true, left: false }, mirror: true, smoothing: 0.4, softness: 10, spin: 0 } },
  { name: 'Aurora', patch: { style: 'wave', peaks: false, thickness: 5, height: 170, colorMode: 'gradient', color1: '#2dd4bf', color2: '#8b5cf6', sides: { top: false, right: false, bottom: true, left: false }, mirror: true, smoothing: 0.7, softness: 14, hueSpeed: 8, spin: 0 } },
  { name: 'Ambient', patch: { style: 'glow', peaks: false, height: 220, colorMode: 'gradient', color1: '#4cc9f0', color2: '#b5179e', sides: { top: true, right: true, bottom: true, left: true }, mirror: true, smoothing: 0.8, softness: 22, opacity: 0.85, hueSpeed: 10, beatPulse: 0.7, spin: 0 } },
  { name: 'Classic', patch: { style: 'bars', peaks: true, thickness: 4, gap: 0.8, height: 120, colorMode: 'solid', color1: '#ffffff', sides: { top: false, right: false, bottom: true, left: false }, mirror: true, smoothing: 0.5, softness: 4, spin: 0 } },
  { name: 'Frame', patch: { style: 'bars', peaks: false, thickness: 4, gap: 0.7, height: 90, colorMode: 'gradient', color1: '#4cc9f0', color2: '#b5179e', sides: { top: true, right: true, bottom: true, left: true }, mirror: true, smoothing: 0.6, softness: 6, spin: 0 } },
  { name: 'Sides', patch: { style: 'wave', peaks: false, thickness: 4, height: 130, colorMode: 'gradient', color1: '#2dd4bf', color2: '#8b5cf6', sides: { top: false, right: true, bottom: false, left: true }, mirror: true, smoothing: 0.65, softness: 12, spin: 0 } },
  { name: 'Sunset', patch: { style: 'wave', peaks: false, thickness: 6, height: 190, colorMode: 'gradient', color1: '#ff9f1c', color2: '#ff4d6d', sides: { top: false, right: false, bottom: true, left: false }, mirror: true, smoothing: 0.6, softness: 16, spin: 0 } },
]

const KEY = 'udaan.edgelight.v1'
const EVENT = 'edgelight:config'

export function loadEdgeConfig(): EdgeLightConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<EdgeLightConfig>
      // Saves from before the Wave and Glow styles may hold something unknown.
      const style = (['bars', 'wave', 'glow'] as const).find((s) => s === parsed.style) ?? 'bars'
      return { ...EDGE_DEFAULTS, ...parsed, style, sides: { ...EDGE_DEFAULTS.sides, ...parsed.sides } }
    }
  } catch {
    // Unreadable or blocked storage: run on defaults.
  }
  return EDGE_DEFAULTS
}

function persist(cfg: EdgeLightConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg))
  } catch {
    // Not persisting is better than failing the change.
  }
  void emit(EVENT, cfg).catch(() => {})
}

/** Subscribes to config changes from any window. */
export function onEdgeConfig(cb: (c: EdgeLightConfig) => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === KEY && cb(loadEdgeConfig())
  window.addEventListener('storage', onStorage)
  const un = listen<EdgeLightConfig>(EVENT, (e) => cb(e.payload))
  return () => {
    window.removeEventListener('storage', onStorage)
    void un.then((fn) => fn())
  }
}

/** Edit-side hook: current config plus a patch function that persists and
 * applies (including turning the overlay and its audio analysis on/off). */
export function useEdgeLight() {
  const [cfg, setCfg] = useState<EdgeLightConfig>(loadEdgeConfig)

  useEffect(() => onEdgeConfig(setCfg), [])

  const update = useCallback((patch: Partial<EdgeLightConfig>) => {
    const next = { ...loadEdgeConfig(), ...patch }
    setCfg(next)
    persist(next)
    if (patch.enabled !== undefined) void invoke('edge_light_set_enabled', { enabled: patch.enabled }).catch(() => {})
  }, [])

  const reset = useCallback(() => update({ ...EDGE_DEFAULTS, enabled: loadEdgeConfig().enabled }), [update])

  return { cfg, update, reset }
}
