import { useCallback, useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/shared/components/ui/button'
import { FolderIcon, UploadIcon, ChevronRightIcon } from '@/shared/icons'
import { spring } from '@/shared/lib/motion'
import { getWorkspacePath, listWorkspaceDirectory, addFileToWorkspace, type AgentFileEntry } from '@/integrations/agent-workspace'

/**
 * Collapsible panel showing the agent workspace's current contents, so the
 * user isn't guessing what the tool-calling loop can see — plus a simple
 * "Add file" button (native picker -> copy into the workspace) since the
 * workspace starts empty and needs a way to get real files into it.
 */
export function WorkspacePanel() {
  const [open_, setOpen] = useState(false)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [entries, setEntries] = useState<AgentFileEntry[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    Promise.all([getWorkspacePath(), listWorkspaceDirectory('')])
      .then(([path, list]) => {
        setWorkspacePath(path)
        setEntries(list)
      })
      .catch((err) => console.error('Failed to load agent workspace:', err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (open_) refresh()
  }, [open_, refresh])

  async function handleAddFile() {
    const selected = await open({ multiple: false })
    if (typeof selected !== 'string') return
    try {
      await addFileToWorkspace(selected)
      refresh()
    } catch (err) {
      console.error('Failed to add file to workspace:', err)
    }
  }

  return (
    <div className="border-(--border-hairline) mb-2 border-b pb-1 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-text-secondary hover:text-text-primary hover:bg-surface-hover flex w-full items-center gap-1.5 rounded-lg px-3 py-2"
      >
        <motion.span animate={{ rotate: open_ ? 90 : 0 }} transition={spring.micro} className="flex">
          <ChevronRightIcon width={10} height={10} />
        </motion.span>
        <FolderIcon width={13} height={13} />
        <span>Agent workspace</span>
        <span className="text-text-tertiary ml-auto">{entries.length > 0 ? `${entries.length} item(s)` : ''}</span>
      </button>

      <AnimatePresence initial={false}>
        {open_ && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.standard}
            className="overflow-hidden"
          >
            <div className="border-(--border-hairline) flex flex-col gap-2 border-t px-3 py-2.5">
              {workspacePath && (
                <p className="text-text-tertiary">
                  Drop files here via Windows Explorer, or use "Add file" below:
                  <br />
                  <span
                    className="text-text-secondary block truncate text-left font-mono"
                    dir="rtl"
                    title={workspacePath}
                  >
                    <bdi>{workspacePath}</bdi>
                  </span>
                </p>
              )}

              {loading ? (
                <p className="text-text-secondary">Loading…</p>
              ) : entries.length === 0 ? (
                <p className="text-text-secondary">Empty — nothing here yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {entries.map((e) => (
                    <li key={e.name} className="text-text-secondary flex items-center gap-1.5">
                      {e.is_dir ? <FolderIcon width={11} height={11} /> : null}
                      {e.name}
                    </li>
                  ))}
                </ul>
              )}

              <Button
                type="button"
                variant="secondary"
                size="pill-sm"
                onClick={handleAddFile}
                className="w-fit rounded-lg"
              >
                <UploadIcon width={12} height={12} />
                Add file to workspace
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
