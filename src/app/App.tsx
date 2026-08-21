import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AmbientBackground } from '@/shared/components/AmbientBackground'
import { TopBar } from '@/shared/components/TopBar'
import { Sidebar } from '@/shared/components/Sidebar'
import { GeneralChatView } from '@/features/general-chat/GeneralChatView'
import { PlaceholderView } from '@/shared/components/PlaceholderView'
import { SchoolView } from '@/features/school/SchoolView'
import { WorkView } from '@/features/work/WorkView'
import { CreativityView } from '@/features/creativity/CreativityView'
import { DjBoardView } from '@/features/creativity/dj-board/DjBoardView'
import { ImageEditorView } from '@/features/creativity/image-editor/ImageEditorView'
import { StudyGeneratorView } from '@/features/school/study-generator/StudyGeneratorView'
import { VideoEditorView } from '@/features/creativity/video-editor/VideoEditorView'
import { MusicPlayerView } from '@/features/creativity/music-player/MusicPlayerView'
import { ProposalGeneratorView } from '@/features/work/proposal-generator/ProposalGeneratorView'
import { ClientTrackerView } from '@/features/work/client-tracker/ClientTrackerView'
import { AutomationsView } from '@/features/automations/AutomationsView'
import { CalendarView } from '@/features/calendar/CalendarView'
import { ScheduleView } from '@/features/schedule/ScheduleView'
import { SessionsView } from '@/features/sessions/SessionsView'
import { ModelDashboardView } from '@/features/model-dashboard/ModelDashboardView'
import { AccountView } from '@/features/account/AccountView'
import { IntegrationsView } from '@/features/integrations-status/IntegrationsView'
import { SystemHealthView } from '@/features/system-health/SystemHealthView'
import { NotificationsView } from '@/features/notifications/NotificationsView'
import { ClipboardManagerView } from '@/features/clipboard-manager/ClipboardManagerView'
import { useClipboardShortcut } from '@/features/clipboard-manager/hooks/useClipboardShortcut'
import { ScreenshotToolView } from '@/features/screenshot-tool/ScreenshotToolView'
import { PdfToolView } from '@/features/pdf-tool/PdfToolView'
import { ChevronRightIcon } from '@/shared/icons'
import type { CategoryId } from './categories'

/**
 * Any navigable destination. There is no standalone "dashboard" — the app
 * opens directly on General Chat, which doubles as home.
 */
export type View =
  | { kind: 'general-chat' }
  | { kind: 'category'; id: CategoryId }
  | { kind: 'calendar' }
  | { kind: 'schedule' }
  | { kind: 'sessions' }
  | { kind: 'model-dashboard' }
  | { kind: 'account' }
  | { kind: 'integrations' }
  | { kind: 'system-health' }
  | { kind: 'notifications' }
  | { kind: 'clipboard-manager' }
  | { kind: 'screenshot-tool' }
  | { kind: 'pdf-tool' }
  | { kind: 'dj-board' }
  | { kind: 'image-editor' }
  | { kind: 'study-generator' }
  | { kind: 'video-editor' }
  | { kind: 'music-player' }
  | { kind: 'proposal-generator' }
  | { kind: 'client-tracker' }
  | { kind: 'automations' }
  | { kind: 'placeholder'; id: string; label: string }

/** Maps a non-placeholder, non-category view to the sidebar row id it should highlight. */
const SIDEBAR_ID_BY_VIEW_KIND: Partial<Record<View['kind'], string>> = {
  calendar: 'calendar',
  schedule: 'schedule',
  'general-chat': 'general-chat',
  sessions: 'task-queue',
  'model-dashboard': 'model-dashboard',
  account: 'account',
  integrations: 'integrations',
  'system-health': 'system-health',
  notifications: 'notification',
  'clipboard-manager': 'clipboard-manager',
  'screenshot-tool': 'screenshot-tool',
  'pdf-tool': 'pdf-tool',
  'dj-board': 'creativity-dj-mixer',
  'image-editor': 'creativity-image-editor',
  'study-generator': 'school-study-generator',
  'video-editor': 'creativity-video-editor',
  'music-player': 'creativity-music-player',
  'proposal-generator': 'work-proposal-generator',
  'client-tracker': 'work-client-tracker',
  automations: 'automations',
}

function activeViewIdFor(view: View): string | null {
  if (view.kind === 'placeholder') return view.id
  return SIDEBAR_ID_BY_VIEW_KIND[view.kind] ?? null
}

export default function App() {
  const [activeCategory, setActiveCategory] = useState<CategoryId | null>(null)
  const [view, setView] = useState<View>({ kind: 'general-chat' })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useClipboardShortcut(() => {
    setActiveCategory(null)
    setView({ kind: 'clipboard-manager' })
  })

  function selectCategory(id: CategoryId) {
    setActiveCategory(id)
    setView({ kind: 'category', id })
  }

  function selectPlaceholder(id: string, label: string) {
    setActiveCategory(null)
    if (id === 'calendar') {
      setView({ kind: 'calendar' })
      return
    }
    if (id === 'schedule') {
      setView({ kind: 'schedule' })
      return
    }
    if (id === 'task-queue') {
      setView({ kind: 'sessions' })
      return
    }
    if (id === 'model-dashboard') {
      setView({ kind: 'model-dashboard' })
      return
    }
    if (id === 'account') {
      setView({ kind: 'account' })
      return
    }
    if (id === 'integrations') {
      setView({ kind: 'integrations' })
      return
    }
    if (id === 'system-health') {
      setView({ kind: 'system-health' })
      return
    }
    if (id === 'notification') {
      setView({ kind: 'notifications' })
      return
    }
    if (id === 'clipboard-manager') {
      setView({ kind: 'clipboard-manager' })
      return
    }
    if (id === 'screenshot-tool') {
      setView({ kind: 'screenshot-tool' })
      return
    }
    if (id === 'pdf-tool') {
      setView({ kind: 'pdf-tool' })
      return
    }
    if (id === 'creativity-dj-mixer') {
      setView({ kind: 'dj-board' })
      return
    }
    if (id === 'creativity-image-editor') {
      setView({ kind: 'image-editor' })
      return
    }
    if (id === 'school-study-generator') {
      setView({ kind: 'study-generator' })
      return
    }
    if (id === 'creativity-video-editor') {
      setView({ kind: 'video-editor' })
      return
    }
    if (id === 'creativity-music-player') {
      setView({ kind: 'music-player' })
      return
    }
    if (id === 'work-proposal-generator') {
      setView({ kind: 'proposal-generator' })
      return
    }
    if (id === 'work-client-tracker') {
      setView({ kind: 'client-tracker' })
      return
    }
    if (id === 'automations') {
      setView({ kind: 'automations' })
      return
    }
    setView({ kind: 'placeholder', id, label })
  }

  function selectGeneralChat() {
    setActiveCategory(null)
    setView({ kind: 'general-chat' })
  }

  function renderView() {
    if (view.kind === 'general-chat') return <GeneralChatView />
    if (view.kind === 'calendar') return <CalendarView />
    if (view.kind === 'schedule') return <ScheduleView />
    if (view.kind === 'sessions') return <SessionsView />
    if (view.kind === 'model-dashboard') return <ModelDashboardView />
    if (view.kind === 'account') return <AccountView />
    if (view.kind === 'integrations') return <IntegrationsView />
    if (view.kind === 'system-health') return <SystemHealthView />
    if (view.kind === 'notifications') return <NotificationsView />
    if (view.kind === 'clipboard-manager') return <ClipboardManagerView />
    if (view.kind === 'screenshot-tool') return <ScreenshotToolView />
    if (view.kind === 'pdf-tool') return <PdfToolView />
    if (view.kind === 'dj-board') return <DjBoardView />
    if (view.kind === 'image-editor') return <ImageEditorView />
    if (view.kind === 'study-generator') return <StudyGeneratorView />
    if (view.kind === 'video-editor') return <VideoEditorView />
    if (view.kind === 'music-player') return <MusicPlayerView />
    if (view.kind === 'proposal-generator') return <ProposalGeneratorView />
    if (view.kind === 'client-tracker') return <ClientTrackerView />
    if (view.kind === 'automations') return <AutomationsView />
    if (view.kind === 'placeholder')
      return <PlaceholderView label={view.label} />

    switch (view.id) {
      case 'school':
        return <SchoolView />
      case 'work':
        return <WorkView />
      case 'creativity':
        return <CreativityView />
      case 'general':
        return <GeneralChatView />
    }
  }

  return (
    <div className="relative flex h-screen w-screen flex-col p-6 md:p-10">
      <AmbientBackground />

      <TopBar />

      <div
        className="border-glass-border relative mt-4 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border"
        style={{
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <div className="flex min-h-0 flex-1">
          <Sidebar
            activeCategory={activeCategory}
            onSelectCategory={selectCategory}
            activeViewId={activeViewIdFor(view)}
            onSelectPlaceholder={selectPlaceholder}
            onSelectGeneralChat={selectGeneralChat}
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
          />

          <main className="relative flex min-w-0 flex-1 items-center justify-center overflow-y-auto p-8">
            <AnimatePresence>
              {sidebarCollapsed && (
                <motion.button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label="Expand sidebar"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  className="glass-surface text-text-secondary hover:text-text-primary hover:bg-glass-hover absolute top-4 left-4 z-10 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-xl transition-colors duration-150"
                >
                  <ChevronRightIcon width={14} height={14} />
                </motion.button>
              )}
            </AnimatePresence>
            {renderView()}
          </main>
        </div>
      </div>
    </div>
  )
}
