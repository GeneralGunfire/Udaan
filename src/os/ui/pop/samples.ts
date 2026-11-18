import type { ReactNode } from 'react'
import type { AppId } from '@/os/kernel/registry'

/** Pretend data for the design gallery and for tests. The real popups will be fed by the engine. */
export interface Note {
  id: string
  app: string
  /** An Udaan app: its own icon is used. Anything else gets a coloured monogram tile. */
  appId?: AppId
  tint?: string
  title: string
  body?: string
  time: string
  kind?: 'normal' | 'critical'
  actions?: string[]
  unread?: boolean
  /** The real OS draws the sender's own icon (a picture, an app icon). Overrides appId and tint. */
  renderIcon?: (size: number) => ReactNode
}

export const SAMPLE_NOTES: Note[] = [
  { id: 'n1', app: 'Chat', appId: 'chat', title: 'Mira', body: 'Are we still on for dinner tonight? I booked the corner table for seven.', time: 'now', actions: ['Reply', 'Mute'], unread: true },
  { id: 'n2', app: 'Calendar', appId: 'calendar', title: 'Design review in 10 minutes', body: 'Studio room 2 · Aisha, Dev and Tom are already there.', time: '2m', actions: ['Join', 'Snooze'], unread: true },
  { id: 'n3', app: 'Anvil', appId: 'anvil', title: 'Backup failed', body: 'Forged could not reach the database on port 5432. The last good backup is from yesterday, 18:02.', time: '9m', kind: 'critical', actions: ['Retry', 'Details'], unread: true },
  { id: 'n4', app: 'Downloads', tint: '#3fa7e0', title: 'Download complete', body: 'udaan-wallpapers.zip · 128 MB', time: '14m', actions: ['Open', 'Show in folder'] },
  { id: 'n5', app: 'Chat', appId: 'chat', title: 'Mira', body: 'Also, did you see the new wallpapers? 😄', time: '1h' },
  { id: 'n6', app: 'News', appId: 'news-brief', title: 'Your morning brief is ready', body: 'Seven stories, three minutes.', time: '3h', actions: ['Read'] },
  { id: 'n7', app: 'Files', appId: 'file-explorer', title: '3 files copied to Backups', body: 'Reports · 41 MB', time: '5h' },
  { id: 'n8', app: 'Music', appId: 'private-player', title: 'Now playing', body: 'Late Night Drive · Neon Harbour', time: 'Yesterday' },
]

export const SAMPLE_NETWORKS = [
  { name: 'Home', secured: true, level: 4, connected: true, detail: '5 GHz · 866 Mbps' },
  { name: 'Home-Guest', secured: true, level: 4 },
  { name: 'Neighbour_2G', secured: true, level: 2 },
  { name: 'Corner Coffee', secured: false, level: 3 },
  { name: 'DIRECT-7f-Printer', secured: true, level: 1 },
]

export const SAMPLE_EVENTS = [
  { time: '09:30', title: 'Stand-up', place: 'Meet', tint: '#5b8def', done: true },
  { time: '11:00', title: 'Design review', place: 'Studio room 2', tint: '#e5534b' },
  { time: '14:00', title: 'Dentist', place: 'Rosebank', tint: '#2fb46b' },
  { time: '16:30', title: 'Gym', place: '', tint: '#f08a3c' },
]

export const SAMPLE_RECENTS = [
  { name: 'Quarterly report.pdf', where: 'Documents', when: '12 min ago', icon: 'file' as const },
  { name: 'Budget 2026.xlsx', where: 'Work', when: '1 h ago', icon: 'file' as const },
  { name: 'holiday-02.jpg', where: 'Pictures', when: 'Yesterday', icon: 'image' as const },
  { name: 'Meeting notes', where: 'Notes', when: 'Yesterday', icon: 'pencil' as const },
]

export const SOUND_PRESETS = ['Flat', 'Music', 'Cinematic', 'Bass', 'Dialogue', 'Night', 'Clarity', 'Custom'] as const
