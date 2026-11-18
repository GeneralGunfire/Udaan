import * as CM from '@radix-ui/react-context-menu'
import type { ComponentType, ReactNode, SVGProps } from 'react'
import { cn } from '@/shared/lib/cn'
import { CheckIcon, ChevronRightIcon } from '@/shared/icons'
import { Surface } from '@/os/ui/pop/Surface'

export const ContextMenu = CM.Root
export const ContextMenuTrigger = CM.Trigger

// The desktop's right-click menu wears the same card as every other menu (see os/ui/pop): dark glass, accent highlight.
// The desktop's right-click menu is the same liquid-glass card as every other menu (os/ui/pop): the Radix element only
// positions it, the card itself is a Surface, so the "Popups" glass settings in Settings control it too.
const panel = 'z-[60] min-w-[236px] text-[13px] text-[#faf8f4] outline-none data-[state=open]:animate-[os-menu-in_140ms_cubic-bezier(0,0,0,1)]'

const item =
  'relative flex h-[30px] cursor-default select-none items-center gap-2.5 rounded-[9px] px-2.5 outline-none ' +
  'data-[highlighted]:bg-(--u-accent,#3072f0) data-[highlighted]:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

function Leading({ icon: I }: { icon?: Icon }) {
  return <span className="flex w-4 shrink-0 justify-center">{I && <I className="h-4 w-4 opacity-85" />}</span>
}

export function ContextMenuContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <CM.Portal>
      <CM.Content collisionPadding={8} className={cn(panel, className)}>
        <Surface radius={14} className="p-1.5" style={{ minWidth: 236 }}>{children}</Surface>
      </CM.Content>
    </CM.Portal>
  )
}

export function ContextMenuItem({
  icon,
  shortcut,
  danger,
  disabled,
  onSelect,
  children,
}: {
  icon?: Icon
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <CM.Item disabled={disabled} onSelect={onSelect} className={cn(item, danger && 'text-[#ff8b82] data-[highlighted]:bg-[#d9453c] data-[highlighted]:text-white')}>
      <Leading icon={icon} />
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="pl-6 text-[12px] opacity-55">{shortcut}</span>}
    </CM.Item>
  )
}

export function ContextMenuCheckItem({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  children: ReactNode
}) {
  return (
    <CM.CheckboxItem checked={checked} onCheckedChange={onCheckedChange} onSelect={(e) => e.preventDefault()} className={item}>
      <span className="flex w-4 shrink-0 justify-center">
        <CM.ItemIndicator>
          <CheckIcon className="h-3.5 w-3.5" />
        </CM.ItemIndicator>
      </span>
      <span className="flex-1">{children}</span>
    </CM.CheckboxItem>
  )
}

export function ContextMenuRadioGroup<T extends string>({
  value,
  onValueChange,
  options,
}: {
  value: T
  onValueChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <CM.RadioGroup value={value} onValueChange={(v) => onValueChange(v as T)}>
      {options.map((o) => (
        <CM.RadioItem key={o.value} value={o.value} className={item}>
          <span className="flex w-4 shrink-0 justify-center">
            <CM.ItemIndicator>
              <span className="block h-1.5 w-1.5 rounded-full bg-current" />
            </CM.ItemIndicator>
          </span>
          <span className="flex-1">{o.label}</span>
        </CM.RadioItem>
      ))}
    </CM.RadioGroup>
  )
}

export function ContextMenuSub({ icon, label, children }: { icon?: Icon; label: string; children: ReactNode }) {
  return (
    <CM.Sub>
      <CM.SubTrigger className={cn(item, 'data-[state=open]:bg-white/10')}>
        <Leading icon={icon} />
        <span className="flex-1">{label}</span>
        <ChevronRightIcon className="h-3.5 w-3.5 opacity-60" />
      </CM.SubTrigger>
      <CM.Portal>
        <CM.SubContent sideOffset={4} collisionPadding={8} className={panel}>
          <Surface radius={14} className="p-1.5" style={{ minWidth: 236 }}>{children}</Surface>
        </CM.SubContent>
      </CM.Portal>
    </CM.Sub>
  )
}

export function ContextMenuSeparator() {
  return <CM.Separator className="mx-2 my-1 h-px bg-white/10" />
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return <CM.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">{children}</CM.Label>
}
