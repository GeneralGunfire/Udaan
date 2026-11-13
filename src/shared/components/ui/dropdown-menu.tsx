/**
 * Re-exports the hand-built DropdownMenu primitive under this file's
 * existing path so its consumers don't need an import-path change.
 * Implementation (no Radix, roving focus + typeahead + submenu context +
 * @floating-ui/dom positioning) lives in
 * src/shared/components/primitives/DropdownMenu.tsx.
 */
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  type DropdownMenuContentProps,
  type DropdownMenuItemProps,
} from '@/shared/components/primitives/DropdownMenu'
