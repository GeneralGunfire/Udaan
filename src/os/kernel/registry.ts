import { createElement, lazy, type ComponentType, type SVGProps } from 'react'
import {
  SearchIcon,
  WaveformIcon,
  ExplorerIcon,
  FileTextIcon,
  DiscIcon,
  NewspaperIcon,
  ChatBubbleIcon,
  CalendarIcon,
  HeadphonesIcon,
  SettingsIcon,
  LayersIcon,
} from '@/shared/icons'

export type AppId =
  | 'chat'
  | 'calendar'
  | 'omni-find'
  | 'studio'
  | 'file-explorer'
  | 'notes'
  | 'cnc-mod-switcher'
  | 'private-player'
  | 'live-dj'
  | 'news-brief'
  | 'settings'
  | 'tv'
  | 'clipboard'
  | 'photos'
  | 'storage'

export interface BaseAppProps {
  onClose: () => void
}

/** Launch arguments per app. They cross a window boundary as JSON, so they must stay serializable. */
export interface AppArgsMap {
  chat: Record<string, never>
  calendar: Record<string, never>
  'omni-find': Record<string, never>
  studio: Record<string, never>
  'file-explorer': { initialPath?: string }
  notes: Record<string, never>
  'cnc-mod-switcher': Record<string, never>
  'private-player': Record<string, never>
  'live-dj': Record<string, never>
  'news-brief': Record<string, never>
  tv: Record<string, never>
  'clipboard': Record<string, never>
  'photos': Record<string, never>
  'storage': Record<string, never>
  settings: { section?: 'personalization' | 'dock' | 'keyboard' | 'windows' | 'widgets' | 'quickstarts' | 'notifications' | 'sound' | 'system' }
}

export type AppProps<Id extends AppId> = BaseAppProps & Partial<AppArgsMap[Id]>

export interface AppDef {
  name: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** Logical px. */
  size: { width: number; height: number }
  minSize: { width: number; height: number }
  /** Tints the app's dock tile and icon plate so apps are recognisable at a glance. */
  tint: string
}

export const APP_DEFS: Record<AppId, AppDef> = {
  chat: { name: 'Chat', icon: ChatBubbleIcon, size: { width: 980, height: 720 }, minSize: { width: 520, height: 420 }, tint: '#5b8def' },
  calendar: { name: 'Calendar', icon: CalendarIcon, size: { width: 1180, height: 780 }, minSize: { width: 720, height: 520 }, tint: '#e5534b' },
  'omni-find': { name: 'OmniFind', icon: SearchIcon, size: { width: 1200, height: 800 }, minSize: { width: 720, height: 520 }, tint: '#8b6cf0' },
  studio: { name: 'Studio', icon: WaveformIcon, size: { width: 1440, height: 900 }, minSize: { width: 1024, height: 640 }, tint: '#f08a3c' },
  'file-explorer': { name: 'Files', icon: ExplorerIcon, size: { width: 1120, height: 720 }, minSize: { width: 640, height: 420 }, tint: '#3fa7e0' },
  notes: { name: 'Notes', icon: FileTextIcon, size: { width: 980, height: 700 }, minSize: { width: 560, height: 420 }, tint: '#e8c547' },
  'cnc-mod-switcher': { name: 'C&C Mods', icon: DiscIcon, size: { width: 900, height: 640 }, minSize: { width: 600, height: 440 }, tint: '#9aa0a6' },
  'private-player': { name: 'Music', icon: HeadphonesIcon, size: { width: 1280, height: 820 }, minSize: { width: 820, height: 560 }, tint: '#fa586a' },
  'live-dj': { name: 'Live DJ', icon: DiscIcon, size: { width: 1180, height: 840 }, minSize: { width: 860, height: 600 }, tint: '#b5179e' },
  'news-brief': { name: 'News', icon: NewspaperIcon, size: { width: 1040, height: 780 }, minSize: { width: 620, height: 480 }, tint: '#6f7782' },
  'clipboard': { name: 'Clipboard', icon: LayersIcon, size: { width: 820, height: 700 }, minSize: { width: 640, height: 480 }, tint: '#5e5ce6' },
  'photos': { name: 'Photos', icon: LayersIcon, size: { width: 1200, height: 820 }, minSize: { width: 640, height: 480 }, tint: '#ff9f0a' },
  'storage': { name: 'Storage', icon: LayersIcon, size: { width: 1000, height: 760 }, minSize: { width: 640, height: 480 }, tint: '#30d158' },
  tv: { name: 'TV', icon: LayersIcon, size: { width: 1600, height: 900 }, minSize: { width: 960, height: 600 }, tint: '#0a0a0c' },
  settings: { name: 'Settings', icon: SettingsIcon, size: { width: 1040, height: 720 }, minSize: { width: 720, height: 480 }, tint: '#8e8e93' },
}

export const APP_IDS = Object.keys(APP_DEFS) as AppId[]

export function isAppId(value: string | null | undefined): value is AppId {
  return !!value && value in APP_DEFS
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Each app's module graph (pdfjs, deck.gl, the Studio engine client...)
// only loads in the window that actually runs that app.
export const APP_COMPONENTS: { [Id in AppId]: ComponentType<any> } = {
  chat: lazy(() => import('@/features/general-chat/GeneralChatView').then((m) => ({ default: m.GeneralChatView }))),
  calendar: lazy(() => import('@/features/calendar/CalendarView').then((m) => ({ default: m.CalendarView }))),
  'omni-find': lazy(() => import('@/features/omni-find/OmniFindView').then((m) => ({ default: m.OmniFindView }))),
  studio: lazy(() => import('@/apps/studio').then((m) => ({ default: m.StudioApp }))),
  'file-explorer': lazy(() => import('@/features/file-explorer/FilesApp').then((m) => ({ default: m.FilesApp }))),
  notes: lazy(() => import('@/features/notes/NotesView').then((m) => ({ default: m.NotesView }))),
  'cnc-mod-switcher': lazy(() => import('@/features/cnc-mod-switcher/CncModSwitcherView').then((m) => ({ default: m.CncModSwitcherView }))),
  // The player's audio graph lives in its provider, so it loads (and only
  // ever runs) inside the Music window itself.
  'private-player': lazy(async () => {
    const [{ PrivatePlayerView }, { PlayerProvider }] = await Promise.all([
      import('@/features/private-player/PrivatePlayerView'),
      import('@/features/private-player/lib/PlayerContext'),
    ])
    return { default: (props: any) => createElement(PlayerProvider, null, createElement(PrivatePlayerView, props)) }
  }),
  'live-dj': lazy(() => import('@/features/live-dj/LiveDjView').then((m) => ({ default: m.LiveDjView }))),
  'news-brief': lazy(() => import('@/features/news-brief/NewsBriefView').then((m) => ({ default: m.NewsBriefView }))),
  'clipboard': lazy(() => import('@/os/apps/utilities/ClipboardApp').then((m) => ({ default: m.ClipboardApp }))),
  'photos': lazy(() => import('@/os/apps/utilities/PhotosApp').then((m) => ({ default: m.PhotosApp }))),
  'storage': lazy(() => import('@/os/apps/utilities/StorageApp').then((m) => ({ default: m.StorageApp }))),
  tv: lazy(() => import('@/os/apps/tv/TvApp').then((m) => ({ default: m.TvApp }))),
  settings: lazy(() => import('@/os/apps/settings/SettingsApp').then((m) => ({ default: m.SettingsApp }))),
}
/* eslint-enable @typescript-eslint/no-explicit-any */
