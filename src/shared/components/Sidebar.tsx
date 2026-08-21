import { useState, type SVGProps } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CATEGORIES, type CategoryId } from '@/app/categories'
import { PLACEHOLDER_BADGES } from '@/app/placeholderData'
import { useUnreadNotificationCount } from '@/features/notifications/hooks/useNotifications'
import {
  CalendarIcon,
  GaugeIcon,
  QueueIcon,
  ChatBubbleIcon,
  BellIcon,
  UserCircleIcon,
  PlugIcon,
  PulseIcon,
  ChevronRightIcon,
  FolderIcon,
} from '@/shared/icons'

interface SidebarProps {
  activeCategory: CategoryId | null
  onSelectCategory: (id: CategoryId) => void
  activeViewId: string | null
  onSelectPlaceholder: (id: string, label: string) => void
  onSelectGeneralChat: () => void
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}

/** Workspace — cross-cutting General-category tools, not tied to a project. */
const WORKSPACE_ITEMS = [
  { id: 'schedule', label: 'Schedule', icon: CalendarIcon, badge: null },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon, badge: null },
  {
    id: 'model-dashboard',
    label: 'Model Dashboard',
    icon: GaugeIcon,
    badge: null,
  },
  {
    id: 'task-queue',
    label: 'Task Queue',
    icon: QueueIcon,
    badge: PLACEHOLDER_BADGES.taskQueue,
  },
  { id: 'account', label: 'Account', icon: UserCircleIcon, badge: null },
  { id: 'integrations', label: 'Integrations', icon: PlugIcon, badge: null },
  {
    id: 'system-health',
    label: 'System Health',
    icon: PulseIcon,
    badge: null,
  },
] as const

export function Sidebar({
  activeCategory,
  onSelectCategory,
  activeViewId,
  onSelectPlaceholder,
  onSelectGeneralChat,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  const [expandedCategory, setExpandedCategory] = useState<CategoryId | null>(
    null,
  )
  const unreadNotifications = useUnreadNotificationCount()

  function toggleCategory(id: CategoryId) {
    setExpandedCategory((prev) => (prev === id ? null : id))
  }

  return (
    <AnimatePresence initial={false}>
      {!collapsed && (
        <motion.nav
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 248, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          className="border-glass-border bg-chrome relative z-10 flex h-full shrink-0 flex-col overflow-hidden border-r backdrop-blur-2xl"
        >
          <div className="flex min-h-0 w-62 flex-1 flex-col overflow-y-auto">
            {/* Header — collapse toggle */}
            <div className="flex h-11 shrink-0 items-center justify-end px-3">
              <motion.button
                type="button"
                onClick={() => onCollapsedChange(true)}
                aria-label="Collapse sidebar"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className="text-text-tertiary hover:text-text-primary hover:bg-glass-hover flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-150"
              >
                <motion.span
                  animate={{ rotate: 180 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="flex"
                >
                  <ChevronRightIcon width={11} height={11} />
                </motion.span>
              </motion.button>
            </div>
            <div className="border-glass-border border-t" />

            <div className="flex flex-col gap-0.5 p-2">
              {/* General Chat — home view */}
              <SidebarRow
                icon={ChatBubbleIcon}
                label="General Chat"
                active={activeViewId === 'general-chat'}
                onClick={onSelectGeneralChat}
              />

              {/* Workspace — real General-category features */}
              {WORKSPACE_ITEMS.map(({ id, label, icon: Icon, badge }) => (
                <SidebarRow
                  key={id}
                  icon={Icon}
                  label={label}
                  active={activeViewId === id}
                  onClick={() => onSelectPlaceholder(id, label)}
                >
                  {badge && <CountBadge value={badge} />}
                </SidebarRow>
              ))}

              {/* Notification */}
              <SidebarRow
                icon={BellIcon}
                label="Notification"
                active={activeViewId === 'notification'}
                onClick={() =>
                  onSelectPlaceholder('notification', 'Notification')
                }
              >
                {unreadNotifications > 0 && (
                  <CountBadge value={String(unreadNotifications)} />
                )}
              </SidebarRow>

              {/* Channels — each independently expandable */}
              {CATEGORIES.map((category) => {
                const isActive = category.id === activeCategory
                const isExpanded = expandedCategory === category.id
                return (
                  <div key={category.id}>
                    <motion.button
                      type="button"
                      onClick={() => {
                        onSelectCategory(category.id)
                        toggleCategory(category.id)
                      }}
                      whileHover={{ x: 2 }}
                      whileTap={{ scale: 0.985 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                      className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-150 ${
                        isExpanded || isActive
                          ? 'bg-glass-hover text-text-primary'
                          : 'text-text-secondary hover:bg-glass'
                      }`}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: `var(${category.accentVar})`,
                        }}
                      />
                      <span className="flex-1">{category.label}</span>
                      <span className="text-text-tertiary text-[10px] font-normal">
                        {category.descriptor}
                      </span>
                      <motion.span
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        transition={{
                          type: 'spring',
                          stiffness: 400,
                          damping: 30,
                        }}
                        className="text-text-tertiary flex shrink-0"
                      >
                        <ChevronRightIcon width={12} height={12} />
                      </motion.span>
                    </motion.button>

                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{
                            type: 'spring',
                            stiffness: 400,
                            damping: 36,
                          }}
                          className="overflow-hidden"
                        >
                          <div className="border-glass-border ml-4 flex flex-col gap-0.5 border-l pt-1 pb-1 pl-2.5">
                            {category.items.map((item) => (
                              <motion.button
                                key={item.id}
                                type="button"
                                onClick={() =>
                                  onSelectPlaceholder(item.id, item.label)
                                }
                                whileHover={{ x: 2 }}
                                whileTap={{ scale: 0.98 }}
                                transition={{
                                  type: 'spring',
                                  stiffness: 500,
                                  damping: 32,
                                }}
                                className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12px] transition-colors duration-150 ${
                                  activeViewId === item.id
                                    ? 'bg-glass text-text-secondary'
                                    : 'text-text-tertiary hover:text-text-secondary hover:bg-glass'
                                }`}
                              >
                                <FolderIcon width={12} height={12} />
                                {item.label}
                              </motion.button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </div>
        </motion.nav>
      )}
    </AnimatePresence>
  )
}

function SidebarRow({
  icon: Icon,
  label,
  active,
  onClick,
  children,
}: {
  icon: React.ComponentType<SVGProps<SVGSVGElement>>
  label: string
  active?: boolean
  onClick?: () => void
  children?: React.ReactNode
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className={`group flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[13px] font-medium transition-colors duration-150 ${
        active
          ? 'bg-glass-hover text-text-primary'
          : 'text-text-secondary hover:bg-glass hover:text-text-primary'
      }`}
    >
      <Icon width={15} height={15} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {children}
    </motion.button>
  )
}

function CountBadge({ value }: { value: string }) {
  return (
    <span className="bg-brand-cyan/20 text-text-primary min-w-4.5 rounded-md px-1.5 py-0.5 text-center text-[10.5px] font-semibold tabular-nums">
      {value}
    </span>
  )
}
