import { create } from 'zustand'

export interface Toast {
  id: number
  title: string
  body?: string
  tone: 'info' | 'error'
}

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }))
let nextId = 1

export function toast(title: string, body?: string, tone: Toast['tone'] = 'info') {
  const id = nextId++
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, title, body, tone }] }))
  setTimeout(() => dismissToast(id), 5000)
}

export function dismissToast(id: number) {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

export function toastError(title: string, err: unknown) {
  toast(title, err instanceof Error ? err.message : String(err), 'error')
}
