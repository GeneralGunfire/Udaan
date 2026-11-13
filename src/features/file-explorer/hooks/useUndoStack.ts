import { useCallback, useRef, useState } from 'react'
import type { UndoableOperation } from '../lib/undoableOperations'

const MAX_HISTORY = 20

/** A few-steps-deep undo/redo stack over reversible file operations (rename/move/create/delete). */
export function useUndoStack() {
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const undoStack = useRef<UndoableOperation[]>([])
  const redoStack = useRef<UndoableOperation[]>([])

  const sync = useCallback(() => {
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }, [])

  const push = useCallback(
    (operation: UndoableOperation) => {
      undoStack.current.push(operation)
      if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
      redoStack.current = []
      sync()
    },
    [sync],
  )

  const undo = useCallback(async () => {
    const operation = undoStack.current.pop()
    if (!operation) return
    try {
      await operation.undo()
      redoStack.current.push(operation)
    } finally {
      sync()
    }
  }, [sync])

  const redo = useCallback(async () => {
    const operation = redoStack.current.pop()
    if (!operation) return
    try {
      await operation.redo()
      undoStack.current.push(operation)
    } finally {
      sync()
    }
  }, [sync])

  return { canUndo, canRedo, push, undo, redo }
}
