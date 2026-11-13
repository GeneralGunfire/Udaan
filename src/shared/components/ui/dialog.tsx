/**
 * Re-exports the hand-built Dialog primitive under this file's existing
 * path so none of its 11 consumers need an import-path change. The actual
 * implementation (no Radix, composed from the shared focus-trap/
 * dismissable-layer/portal/scroll-lock hooks) lives in
 * src/shared/components/primitives/Dialog.tsx.
 */
export {
  Dialog,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
  DialogContent,
  type DialogContentProps,
} from '@/shared/components/primitives/Dialog'
