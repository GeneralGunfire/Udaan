/**
 * Re-exports the hand-built Popover primitive under this file's existing
 * path so its consumer doesn't need an import-path change. Implementation
 * (no Radix, @floating-ui/dom for positioning, shared dismissable-layer
 * hook) lives in src/shared/components/primitives/Popover.tsx.
 */
export {
  Popover,
  PopoverTrigger,
  PopoverAnchor,
  PopoverContent,
  type PopoverContentProps,
} from '@/shared/components/primitives/Popover'
