import type { ComponentType, SVGProps } from 'react'

/**
 * Minimal inline icon set — no external icon library dependency.
 * All icons share a 20x20 viewBox, 1.5px stroke, currentColor.
 */
type IconProps = SVGProps<SVGSVGElement>

/** Shared type for anywhere an icon is passed around as a value (e.g. a
 *  catalog entry), rather than used directly as JSX. */
export type IconComponent = ComponentType<IconProps>

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 9.5L10 4l6.5 5.5" />
      <path d="M5.5 8.5V16h9V8.5" />
      <path d="M8 16v-4.5h4V16" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="9" r="6" />
      <path d="M17 17l-3.5-3.5" />
    </svg>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" />
    </svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.36 4.64l-1.42 1.42M6.06 13.94l-1.42 1.42M15.36 15.36l-1.42-1.42M6.06 6.06L4.64 4.64" />
    </svg>
  )
}

export function CompassIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M12.5 7.5l-1.8 4.2-4.2 1.8 1.8-4.2z" />
    </svg>
  )
}

export function BookOpenIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 5.5C8.5 4.3 6.3 3.7 4 3.7v10.6c2.3 0 4.5.6 6 1.8 1.5-1.2 3.7-1.8 6-1.8V3.7c-2.3 0-4.5.6-6 1.8z" />
      <path d="M10 5.5v10.6" />
    </svg>
  )
}

export function GraduationCapIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 8l8-3.5L18 8l-8 3.5L2 8z" />
      <path d="M5.5 9.8v3.5c0 1 2 2.2 4.5 2.2s4.5-1.2 4.5-2.2V9.8" />
      <path d="M17 8v4.5" />
    </svg>
  )
}

export function LayersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3l7 3.8-7 3.8-7-3.8L10 3z" />
      <path d="M3 10.8l7 3.8 7-3.8" />
      <path d="M3 14.3l7 3.8 7-3.8" />
    </svg>
  )
}

export function DatabaseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="10" cy="5" rx="6.5" ry="2.5" />
      <path d="M3.5 5v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V5" />
      <path d="M3.5 10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7.5 4.5l5.5 5.5-5.5 5.5" />
    </svg>
  )
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14.5 7.5l-6 6a2.5 2.5 0 01-3.5-3.5l6.5-6.5a4 4 0 015.7 5.7L9.7 16.7a1.5 1.5 0 01-2.1-2.1L14 8.2" />
    </svg>
  )
}

export function MicIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0011 0" />
      <path d="M10 15v2.5M7 17.5h6" />
    </svg>
  )
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base} {...props} strokeWidth={1.6}>
      <path d="M17 3L2.5 9.2c-.7.3-.6 1.3.1 1.5l5.4 1.6 1.6 5.4c.2.7 1.2.8 1.5.1L17 3z" />
      <path d="M9.6 12.1L17 3" />
    </svg>
  )
}

export function ChatBubbleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 9.5c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5-3.1 6.5-7 6.5c-.9 0-1.8-.15-2.6-.44L4 17l1.1-3.3A6.2 6.2 0 013 9.5z" />
    </svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 5.5A1.5 1.5 0 014.5 4h3.4a1.5 1.5 0 011.2.58L10.3 6H15.5A1.5 1.5 0 0117 7.5v7A1.5 1.5 0 0115.5 16h-11A1.5 1.5 0 013 14.5v-9z" />
    </svg>
  )
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base} {...props} strokeWidth={1.4}>
      <path d="M10 2.5l1.4 4.6 4.6 1.4-4.6 1.4L10 14.5l-1.4-4.6-4.6-1.4 4.6-1.4z" />
    </svg>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.36 4.64l-1.42 1.42M6.06 13.94l-1.42 1.42M15.36 15.36l-1.42-1.42M6.06 6.06L4.64 4.64" />
    </svg>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M16.5 11.8A6.8 6.8 0 018.2 3.5a7 7 0 108.3 8.3z" />
    </svg>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="7.5" cy="8.5" r="1.25" />
      <path d="M17 12.5l-4-3.5-4.5 4-2-1.5-3.5 3" />
    </svg>
  )
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="6" height="6" rx="1.2" />
      <rect x="11" y="3" width="6" height="6" rx="1.2" />
      <rect x="3" y="11" width="6" height="6" rx="1.2" />
      <rect x="11" y="11" width="6" height="6" rx="1.2" />
    </svg>
  )
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="M3 5.5l7 5.5 7-5.5" />
    </svg>
  )
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 8a5 5 0 0110 0c0 3.5 1.2 4.8 1.2 4.8H3.8S5 11.5 5 8z" />
      <path d="M8.3 15.5a1.7 1.7 0 003.4 0" />
    </svg>
  )
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="7.2" cy="7" r="2.5" />
      <path d="M2.5 16c0-2.8 2.1-4.5 4.7-4.5s4.7 1.7 4.7 4.5" />
      <circle cx="14" cy="6.5" r="2" />
      <path d="M13 11.7c1.9.3 3.5 1.7 3.5 4.3" />
    </svg>
  )
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12.5 3.5l4 4-9.3 9.3-4.6.6.6-4.6z" />
      <path d="M11 5l4 4" />
    </svg>
  )
}

export function TaskIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="2.5" width="13" height="15" rx="1.5" />
      <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" />
    </svg>
  )
}

export function ProjectIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" />
      <path d="M2.5 8h15" />
    </svg>
  )
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" />
      <path d="M6.5 11h1.2M9.4 11h1.2M12.3 11h1.2M6.5 13.6h1.2M9.4 13.6h1.2" />
    </svg>
  )
}

export function GaugeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 14a6.5 6.5 0 0113 0" />
      <path d="M10 14L13 9" />
      <path d="M10 14.5v-.01M10 14a.5.5 0 100 1 .5.5 0 000-1z" />
    </svg>
  )
}

export function QueueIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="14" height="4" rx="1" />
      <rect x="3" y="10" width="14" height="4" rx="1" opacity="0.55" />
      <rect x="3" y="16" width="8" height="1.5" rx="0.75" opacity="0.3" />
    </svg>
  )
}

export function UserCircleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="10" cy="8" r="2.4" />
      <path d="M4.8 15.2a5.6 5.6 0 0110.4 0" />
    </svg>
  )
}

export function PlugIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 8V3.5M13 8V3.5" />
      <rect x="5.5" y="8" width="9" height="5.5" rx="2" />
      <path d="M10 13.5V17M7 17h6" />
    </svg>
  )
}

export function PulseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 10.5h3.2l1.6-4.5 2.6 8 2-6.5 1.4 3h4.2" />
    </svg>
  )
}

export function CodeEditorIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 6L3 10l4 4M13 6l4 4-4 4" />
    </svg>
  )
}

export function TerminalIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="M6 8l3 2.5L6 13M11 13h3" />
    </svg>
  )
}

export function GitHubIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 2.5a7.5 7.5 0 00-2.37 14.62c.38.07.51-.16.51-.36v-1.4c-2.09.45-2.53-1-2.53-1a2 2 0 00-.83-1.1c-.68-.46.05-.45.05-.45.75.05 1.15.77 1.15.77.67 1.14 1.75.82 2.18.62a1.4 1.4 0 01.4-.87c-1.67-.19-3.42-.83-3.42-3.7a2.9 2.9 0 01.77-2 2.7 2.7 0 01.07-2s.63-.2 2.06.77a7.1 7.1 0 013.75 0c1.43-.97 2.06-.77 2.06-.77.4 1 .15 1.75.07 2a2.9 2.9 0 01.77 2c0 2.88-1.76 3.51-3.44 3.7.27.24.51.7.51 1.43v2.12c0 .2.13.44.52.36A7.5 7.5 0 0010 2.5z" />
    </svg>
  )
}

export function BrushIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14.5 3l2.5 2.5-7 7-3-1v-2l7.5-6.5z" />
      <path d="M9 11.5c0 2-1.5 2.5-1.5 2.5s2.5 1 2.5 3c0 1-1 2-3 2-1.6 0-2.5-.6-3-1.2" />
    </svg>
  )
}

export function ExplorerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 6.5a1.5 1.5 0 011.5-1.5h3l1.5 2h7a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5h-11a1.5 1.5 0 01-1.5-1.5v-8z" />
    </svg>
  )
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10h14M10 3c1.8 2 2.8 4.4 2.8 7s-1 5-2.8 7c-1.8-2-2.8-4.4-2.8-7s1-5 2.8-7z" />
    </svg>
  )
}

export function WindowMinimizeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 14h10" />
    </svg>
  )
}

export function WindowMaximizeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1" />
    </svg>
  )
}

export function WindowCloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l8 8M14 6l-8 8" />
    </svg>
  )
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="6" y="4.5" width="3" height="11" rx="1" fill="currentColor" stroke="none" />
      <rect x="11" y="4.5" width="3" height="11" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 7.5l5.5 5.5 5.5-5.5" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8.5" />
    </svg>
  )
}

export function SkipForwardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 4.5v11l7.5-5.5z" fill="currentColor" stroke="none" />
      <rect x="14.5" y="4.5" width="1.8" height="11" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SkipBackIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M14 4.5v11l-7.5-5.5z" fill="currentColor" stroke="none" />
      <rect x="3.7" y="4.5" width="1.8" height="11" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function EjectIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4l5.5 7h-11z" />
      <rect x="4.5" y="13.5" width="11" height="2" rx="0.6" />
    </svg>
  )
}

export function HeadphonesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 12.5v-2a6.5 6.5 0 0113 0v2" />
      <rect x="2.5" y="11.5" width="3.5" height="5" rx="1.5" />
      <rect x="14" y="11.5" width="3.5" height="5" rx="1.5" />
    </svg>
  )
}

export function WaveformIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 10h1.5l1-4 2 8 2-10 2 12 2-8 1 2h3" />
    </svg>
  )
}

export function DiscIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  )
}

export function FilmIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="4" width="15" height="12" rx="1.5" />
      <path d="M2.5 7.5h15M2.5 12.5h15M6.5 4v3.5M6.5 12.5V16M13.5 4v3.5M13.5 12.5V16" />
    </svg>
  )
}

export function ScissorsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="5.5" cy="6" r="2" />
      <circle cx="5.5" cy="14" r="2" />
      <path d="M7 7.3L16 15M7 12.7L16 5" />
    </svg>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3v10M6 9.5L10 13.5L14 9.5" />
      <path d="M4 15.5h12" />
    </svg>
  )
}

export function ClipboardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="4" width="10" height="14" rx="1.5" />
      <path d="M8 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M7.5 9h5M7.5 12h5M7.5 15h3" />
    </svg>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-6A1.5 1.5 0 0 0 4 4.5v6A1.5 1.5 0 0 0 5.5 12H7" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 6h11" />
      <path d="M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6" />
      <path d="M6 6l.7 9.3a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" />
      <path d="M8.3 9v4.2M11.7 9v4.2" />
    </svg>
  )
}

export function CropIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 2v12a1 1 0 0 0 1 1h11" />
      <path d="M2 6h12a1 1 0 0 1 1 1v11" />
    </svg>
  )
}

export function CameraIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6" width="15" height="10.5" rx="1.5" />
      <path d="M7 6l1.2-2h3.6L13 6" />
      <circle cx="10" cy="11.2" r="2.6" />
    </svg>
  )
}

export function FileTextIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 2.5h6l3 3v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
      <path d="M12 2.5V6h3" />
      <path d="M7 10.5h6M7 13h6M7 15.5h3.5" />
    </svg>
  )
}

export function SyncIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10a6 6 0 0 1 10.2-4.2L16 7.5" />
      <path d="M16 4v3.5h-3.5" />
      <path d="M16 10a6 6 0 0 1-10.2 4.2L4 12.5" />
      <path d="M4 16v-3.5h3.5" />
    </svg>
  )
}

export function KeyboardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
      <path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M5.5 11h.01M14.5 11h.01" strokeWidth="2.2" />
      <path d="M8 11.2h4" strokeWidth="2.2" />
    </svg>
  )
}

export function MuffleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8v4h3l4 3.5V4.5L7 8H4z" />
      <path d="M13 7.5a4 4 0 0 1 0 5" opacity="0.4" />
      <path d="M2.5 2.5l15 15" />
    </svg>
  )
}

export function BassKillIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 13.5c1.5 0 1.5-6 3-6s1.5 9 3 9 1.5-13 3-13 1.5 10 3 10 1.5-4 3-4" />
      <path d="M2.5 2.5l15 15" strokeWidth="2" />
    </svg>
  )
}

export function EchoOutIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="10" r="2.2" />
      <path d="M11 6.5a5 5 0 0 1 0 7" opacity="0.6" />
      <path d="M14.5 4a8.5 8.5 0 0 1 0 12" opacity="0.3" />
    </svg>
  )
}

export function ReverbIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="2" />
      <circle cx="10" cy="10" r="5" opacity="0.5" />
      <circle cx="10" cy="10" r="8" opacity="0.25" />
    </svg>
  )
}

export function DelayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 10a7 7 0 1 1 2.5 5.4" />
      <path d="M3 14v-3.5h3.5" />
    </svg>
  )
}

export function FilterSweepIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 15V9a3.5 3.5 0 0 1 7 0v2a3.5 3.5 0 0 0 7 0V5" />
    </svg>
  )
}

export function FlangerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 10c1-3 2-3 3-3s2 6 3 6 2-6 3-6 2 3 3 3" />
      <path d="M2.5 10c1 3 2 3 3 3s2-6 3-6 2 6 3 6 2-3 3-3" opacity="0.35" />
    </svg>
  )
}

export function BitcrushIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 13h2.5v-3H8v-3h2.5V4H13v6h2.5v3h-2.5" />
      <path d="M2.5 13v2.5" />
    </svg>
  )
}

export function PhaserIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 10c1.5-3.5 3-3.5 4.5 0s3 3.5 4.5 0 3-3.5 4.5 0" />
      <path d="M2.5 10c1.5 3.5 3 3.5 4.5 0s3-3.5 4.5 0 3 3.5 4.5 0" opacity="0.35" />
    </svg>
  )
}

export function DistortionIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 10h2l1.5-5 2 10 2-10 2 10 1.5-5h2" />
    </svg>
  )
}

export function TremoloIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 10a2 2 0 1 1 4 0 2 2 0 1 1 4 0 2 2 0 1 1 4 0 2 2 0 1 1 3 0" />
    </svg>
  )
}

export function RecordIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function MuteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8v4h3l4 3.5v-11L7 8H4z" />
      <path d="M14 8l4 4M18 8l-4 4" />
    </svg>
  )
}

export function SoloIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8v4h3l4 3.5v-11L7 8H4z" />
      <path d="M14.5 7.5a4 4 0 010 5M16.8 5.5a7 7 0 010 9" />
    </svg>
  )
}

export function PianoKeysIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="4" width="15" height="12" rx="1" />
      <path d="M6.5 4v7.5M10 4v7.5M13.5 4v7.5" />
    </svg>
  )
}

export function BassIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="14.5" r="3" />
      <path d="M9.2 12.5L15 4.5M15 4.5l2 1.2M15 4.5l1.2 2" />
    </svg>
  )
}

export function DrumsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="10" cy="7" rx="6.5" ry="2.5" />
      <path d="M3.5 7v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V7" />
      <path d="M4.5 4l-2-2.5M15.5 4l2-2.5" />
    </svg>
  )
}

export function SynthIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="5" width="15" height="10" rx="1" />
      <circle cx="6.5" cy="9" r="1.4" />
      <circle cx="10" cy="9" r="1.4" />
      <circle cx="13.5" cy="9" r="1.4" />
      <path d="M5 13.5h10" />
    </svg>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 13V4M6.5 7.5L10 4l3.5 3.5" />
      <path d="M4 14v1.5a1 1 0 001 1h10a1 1 0 001-1V14" />
    </svg>
  )
}

export function StringsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3c0 5-2.5 6-2.5 10a3.5 3.5 0 007 0V4" />
      <path d="M9.5 3.2c.3 4.6-2 5.8-2 9.6" />
      <circle cx="9.5" cy="4" r="1.1" fill="currentColor" stroke="none" />
      <path d="M13 6l5-1.5v9a2 2 0 11-1-1.7V7.2l-4 1.2" />
    </svg>
  )
}

export function PdfFileIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 2.5h6l3 3v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
      <path d="M12 2.5V6h3" />
      <path d="M6.8 14.5v-4h1.1a1.1 1.1 0 0 1 0 2.2H6.8M9.8 14.5v-4h1a1.3 1.3 0 0 1 0 4h-1z" strokeWidth="1.2" />
      <path d="M12.8 10.5h1.6M12.8 12.3h1.4" strokeWidth="1.2" />
    </svg>
  )
}

export function GenericFileIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 2.5h6l3 3v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" />
      <path d="M12 2.5V6h3" />
    </svg>
  )
}

export function GridStepIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="2.5" width="4" height="4" rx="0.6" />
      <rect x="8" y="2.5" width="4" height="4" rx="0.6" />
      <rect x="13.5" y="2.5" width="4" height="4" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="2.5" y="8" width="4" height="4" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="8" y="8" width="4" height="4" rx="0.6" />
      <rect x="13.5" y="8" width="4" height="4" rx="0.6" />
      <rect x="2.5" y="13.5" width="4" height="4" rx="0.6" />
      <rect x="8" y="13.5" width="4" height="4" rx="0.6" fill="currentColor" stroke="none" />
      <rect x="13.5" y="13.5" width="4" height="4" rx="0.6" />
    </svg>
  )
}

export function GuitarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="13.5" r="4" />
      <path d="M9.5 10.5L15 4M15 4l-3 .5M15 4l-.5 3" />
      <path d="M6 13.5h2M6 15h2" opacity="0.5" />
    </svg>
  )
}

export function HarpIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 3c-1.5 4-1.5 10 0 14M15 3c1.5 4 1.5 10 0 14" />
      <path d="M6 3.5h8M6.3 17.5h7.4" />
      <path d="M7.5 5v11M9.5 4.5v12M11.5 4.5v12M13.5 5v11" opacity="0.6" />
    </svg>
  )
}

export function XylophoneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="4" width="3" height="10" rx="1" />
      <rect x="6.7" y="5.2" width="2.6" height="8.6" rx="1" />
      <rect x="10.4" y="6.4" width="2.4" height="7.2" rx="1" />
      <rect x="13.9" y="7.4" width="2.2" height="6.2" rx="1" />
      <rect x="17.1" y="8.2" width="1" height="5.6" rx="0.5" opacity="0.6" />
    </svg>
  )
}

export function BatteryIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6.5" width="13" height="7" rx="1.5" />
      <path d="M17 8.5v3" strokeLinecap="round" />
    </svg>
  )
}

export function BatteryChargingIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6.5" width="13" height="7" rx="1.5" />
      <path d="M17 8.5v3" strokeLinecap="round" />
      <path d="M10.5 7.5L8 10.5h2.5L8.5 13" />
    </svg>
  )
}

export function WifiIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8a8.5 8.5 0 0112 0" opacity="0.4" />
      <path d="M6.5 10.8a5 5 0 017 0" opacity="0.7" />
      <path d="M9 13.5a2 2 0 012 0" />
      <circle cx="10" cy="15.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function WifiOffIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8a8.5 8.5 0 0112 0" opacity="0.3" />
      <path d="M6.5 10.8a5 5 0 017 0" opacity="0.5" />
      <circle cx="10" cy="15.5" r="1" fill="currentColor" stroke="none" />
      <path d="M2.5 2.5l15 15" />
    </svg>
  )
}

export function VolumeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8v4h3l4 3.5v-11L7 8H4z" />
      <path d="M13 7.5a4 4 0 010 5" opacity="0.7" />
      <path d="M15.3 5.5a7.5 7.5 0 010 9" opacity="0.4" />
    </svg>
  )
}

export function VolumeMuteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8v4h3l4 3.5v-11L7 8H4z" />
      <path d="M14 8l4 4M18 8l-4 4" />
    </svg>
  )
}

export function ShuffleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6h2.5l7 8H16M3 14h2.5l2.7-3.1" />
      <path d="M13.3 6H16m0 0v2.7M16 6l-3.7 4.2" />
      <path d="M13.3 14H16m0 0v-2.7M16 14l-1.8-2" />
    </svg>
  )
}

export function RepeatIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 7h8a2.5 2.5 0 012.5 2.5V11" />
      <path d="M6.5 5L5 7l1.5 2" />
      <path d="M15 13H7a2.5 2.5 0 01-2.5-2.5V9" />
      <path d="M13.5 15L15 13l-1.5-2" />
    </svg>
  )
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 16.5s-6.5-4-6.5-9A3.75 3.75 0 0110 5.3 3.75 3.75 0 0116.5 7.5c0 5-6.5 9-6.5 9z" />
    </svg>
  )
}

export function HeartFilledIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 16.5s-6.5-4-6.5-9A3.75 3.75 0 0110 5.3 3.75 3.75 0 0116.5 7.5c0 5-6.5 9-6.5 9z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function NewspaperIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="4.5" width="12" height="11" rx="1" />
      <path d="M14.5 7h2a1 1 0 011 1v7a1.5 1.5 0 01-1.5 1.5h-13" />
      <path d="M5 7.5h6M5 10h6M5 12.5h4" />
    </svg>
  )
}

export function LandmarkIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8l7-4.5L17 8" />
      <path d="M3 8h14" />
      <path d="M4.5 8v7M8 8v7M12 8v7M15.5 8v7" />
      <path d="M2.5 17h15" />
    </svg>
  )
}

export function ShieldAlertIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 2.5l6.5 2.5v4.5c0 4.5-2.8 7.3-6.5 8.5-3.7-1.2-6.5-4-6.5-8.5V5l6.5-2.5z" />
      <path d="M10 7v4M10 13.5v.01" />
    </svg>
  )
}

export function FlaskIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 3h4M8.5 3v4.5L4.3 14.8A1.5 1.5 0 005.6 17h8.8a1.5 1.5 0 001.3-2.2L11.5 7.5V3" />
      <path d="M6.3 12.5h7.4" />
    </svg>
  )
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6.5" width="15" height="9.5" rx="1.5" />
      <path d="M7 6.5V5a1.5 1.5 0 011.5-1.5h3A1.5 1.5 0 0113 5v1.5" />
      <path d="M2.5 10.5h15" />
    </svg>
  )
}

/** Loop / repeat region — two arrows tracing a cycle. */
export function LoopIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8V7a3 3 0 013-3h9" />
      <path d="M13.5 1.5L16 4l-2.5 2.5" />
      <path d="M16 12v1a3 3 0 01-3 3H4" />
      <path d="M6.5 18.5L4 16l2.5-2.5" />
    </svg>
  )
}

/** Metronome — a pendulum in a tapered case. */
export function MetronomeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7.5 3h5l3 14h-11z" />
      <path d="M10 15V6" />
      <path d="M5.5 12h9" />
    </svg>
  )
}

/** Magnet — grid snapping on/off. */
export function MagnetIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 4v6a6 6 0 0012 0V4" />
      <path d="M4 4h4v6a2 2 0 004 0V4h4" />
    </svg>
  )
}

/** Lock — protected/restricted sidebar sections. */
export function LockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="5" y="9" width="10" height="8" rx="1.75" />
      <path d="M7 9V6.5a3 3 0 016 0V9" />
    </svg>
  )
}

export function ScholarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" />
      <path d="M6.5 11.5h7M6.5 13.5h4.5" />
    </svg>
  )
}
