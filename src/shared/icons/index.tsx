import type { SVGProps } from 'react'

/**
 * Minimal inline icon set — no external icon library dependency.
 * All icons share a 20x20 viewBox, 1.5px stroke, currentColor.
 */
type IconProps = SVGProps<SVGSVGElement>

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

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="9" r="6" />
      <path d="M17 17l-3.5-3.5" />
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
