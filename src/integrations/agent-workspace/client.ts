import { invoke } from '@tauri-apps/api/core'
import type { AgentFileEntry } from './types'

/** Absolute path of the one directory the agentic loop's file tools may touch. */
export function getWorkspacePath(): Promise<string> {
  return invoke('agent_workspace_path')
}

export function readWorkspaceFile(relativePath: string): Promise<string> {
  return invoke('agent_read_file', { relativePath })
}

export function writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
  return invoke('agent_write_file', { relativePath, content })
}

export function listWorkspaceDirectory(relativePath = ''): Promise<AgentFileEntry[]> {
  return invoke('agent_list_directory', { relativePath })
}

export function deleteWorkspaceFile(relativePath: string): Promise<void> {
  return invoke('agent_delete_file', { relativePath })
}

/** Copies a user-picked file (native dialog, absolute path) into the workspace. Returns its new file name. */
export function addFileToWorkspace(sourcePath: string): Promise<string> {
  return invoke('agent_workspace_add_file', { sourcePath })
}
