import type { ChatTool, ChatToolCall } from '@/integrations/omniroute'
import { readWorkspaceFile, writeWorkspaceFile, listWorkspaceDirectory, deleteWorkspaceFile } from './client'

/**
 * The agentic loop's tool set for this first version — file read/write/
 * list/delete inside the sandboxed workspace only. Real containment is
 * enforced Rust-side (see src-tauri/src/agent_workspace/mod.rs); these
 * definitions only describe the surface to the model. Deliberately no
 * shell/command-execution tool yet — that's a separate, larger risk
 * surface deferred to its own security-focused session.
 */
export const AGENT_WORKSPACE_TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads the text contents of a file inside the agent workspace.',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: 'Path relative to the workspace root, e.g. "notes.txt"' },
        },
        required: ['relative_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Creates or overwrites a file inside the agent workspace with the given text content.',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: 'Path relative to the workspace root, e.g. "notes.txt"' },
          content: { type: 'string', description: 'The full text content to write' },
        },
        required: ['relative_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'Lists the files and subdirectories inside a directory in the agent workspace.',
      parameters: {
        type: 'object',
        properties: {
          relative_path: {
            type: 'string',
            description: 'Path relative to the workspace root, e.g. "" for the workspace root itself, or "reports"',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Deletes a file (not a directory) inside the agent workspace.',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: 'Path relative to the workspace root' },
        },
        required: ['relative_path'],
      },
    },
  },
]

export interface AgentToolCallOutcome {
  /** Human-readable label for the in-progress UI, e.g. "Reading notes.txt". */
  label: string
  /** Plain-text result fed back to the model as a `tool` message. */
  result: string
  /** False if the tool call was rejected/failed (containment violation, missing file, malformed args, etc.). */
  ok: boolean
}

function describeArgs(args: Record<string, unknown>): string {
  const path = typeof args.relative_path === 'string' ? args.relative_path : ''
  return path
}

/** Executes one tool call against the sandboxed workspace. Never throws — failures come back as `ok: false`. */
export async function executeAgentToolCall(call: ChatToolCall): Promise<AgentToolCallOutcome> {
  const { name, arguments: args } = call.function

  if (args.__malformed) {
    return {
      label: `Malformed ${name} call`,
      result: `The arguments for "${name}" were not valid JSON and could not be used.`,
      ok: false,
    }
  }

  try {
    switch (name) {
      case 'read_file': {
        const path = describeArgs(args)
        const content = await readWorkspaceFile(path)
        return { label: `Read ${path}`, result: content, ok: true }
      }
      case 'write_file': {
        const path = describeArgs(args)
        const content = typeof args.content === 'string' ? args.content : ''
        await writeWorkspaceFile(path, content)
        return { label: `Wrote ${path}`, result: `Wrote ${content.length} characters to "${path}".`, ok: true }
      }
      case 'list_directory': {
        const path = describeArgs(args)
        const entries = await listWorkspaceDirectory(path)
        const listing =
          entries.length === 0
            ? '(empty directory)'
            : entries.map((e) => `${e.is_dir ? '[dir] ' : ''}${e.name}`).join('\n')
        return { label: `Listed ${path || 'workspace root'}`, result: listing, ok: true }
      }
      case 'delete_file': {
        const path = describeArgs(args)
        await deleteWorkspaceFile(path)
        return { label: `Deleted ${path}`, result: `Deleted "${path}".`, ok: true }
      }
      default:
        return { label: `Unknown tool "${name}"`, result: `Unknown tool: "${name}".`, ok: false }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { label: `${name} failed`, result: `Tool "${name}" failed: ${message}`, ok: false }
  }
}
