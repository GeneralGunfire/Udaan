import { invoke } from '@tauri-apps/api/core'
import type { ScreenshotEntry, MonitorInfo, WindowInfo } from './types'

interface RawScreenshotEntry {
  path: string
  file_name: string
  created_at: string
}

function fromRaw(raw: RawScreenshotEntry): ScreenshotEntry {
  return { path: raw.path, fileName: raw.file_name, createdAt: raw.created_at }
}

interface RawMonitorInfo {
  id: number
  name: string
  is_primary: boolean
}

export async function listMonitors(): Promise<MonitorInfo[]> {
  const raw = await invoke<RawMonitorInfo[]>('screenshot_tool_list_monitors')
  return raw.map((m) => ({ id: m.id, name: m.name, isPrimary: m.is_primary }))
}

export async function listCapturableWindows(): Promise<WindowInfo[]> {
  return invoke<WindowInfo[]>('screenshot_tool_list_windows')
}

export async function captureScreen(monitorIndex: number): Promise<ScreenshotEntry> {
  const raw = await invoke<RawScreenshotEntry>('screenshot_tool_capture_screen', {
    monitorIndex,
  })
  return fromRaw(raw)
}

export async function captureWindow(windowIndex: number): Promise<ScreenshotEntry> {
  const raw = await invoke<RawScreenshotEntry>('screenshot_tool_capture_window', {
    windowIndex,
  })
  return fromRaw(raw)
}

export async function captureRegion(
  monitorIndex: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<ScreenshotEntry> {
  const raw = await invoke<RawScreenshotEntry>('screenshot_tool_capture_region', {
    monitorIndex,
    x,
    y,
    width,
    height,
  })
  return fromRaw(raw)
}

export async function listScreenshotHistory(): Promise<ScreenshotEntry[]> {
  const raw = await invoke<RawScreenshotEntry[]>('screenshot_tool_list_history')
  return raw.map(fromRaw)
}

export async function readScreenshotBytes(filePath: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('screenshot_tool_read_file', { filePath })
  return new Uint8Array(bytes)
}

export async function copyScreenshotToClipboard(filePath: string): Promise<void> {
  await invoke('screenshot_tool_copy_to_clipboard', { filePath })
}
