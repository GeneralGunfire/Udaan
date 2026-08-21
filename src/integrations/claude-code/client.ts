import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ClaudeCodeTask, ClaudeCodeTaskEvent } from './types'

const TASK_EVENT = 'claude-code://task-event'

/** Queues a new headless Claude Code run. Resolves once the task row is persisted (queued), not once it finishes. */
export function submitTask(prompt: string, cwd: string): Promise<ClaudeCodeTask> {
  return invoke('claude_code_submit_task', { prompt, cwd })
}

export function listTasks(): Promise<ClaudeCodeTask[]> {
  return invoke('claude_code_list_tasks')
}

export function getTask(id: string): Promise<ClaudeCodeTask | null> {
  return invoke('claude_code_get_task', { id })
}

/** Opens `dir` in VS Code. Backend rejects anything that isn't an existing directory. */
export function openInVSCode(dir: string): Promise<void> {
  return invoke('claude_code_open_in_vscode', { dir })
}

/** Subscribes to live task events (status changes, stdout lines, stderr lines) across all tasks. */
export function onTaskEvent(handler: (event: ClaudeCodeTaskEvent) => void): Promise<UnlistenFn> {
  return listen<ClaudeCodeTaskEvent>(TASK_EVENT, (e) => handler(e.payload))
}
