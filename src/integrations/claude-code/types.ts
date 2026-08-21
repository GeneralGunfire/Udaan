export type TaskStatus = 'queued' | 'running' | 'done' | 'failed'

export interface ClaudeCodeTask {
  id: string
  prompt: string
  cwd: string
  status: TaskStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  /** Newline-joined raw stdout lines captured so far (stream-json events). */
  output: string
  error: string | null
  session_id: string | null
}

export type ClaudeCodeTaskEvent =
  | { kind: 'status'; task_id: string; status: TaskStatus }
  | { kind: 'line'; task_id: string; line: string }
  | { kind: 'stderr'; task_id: string; line: string }
