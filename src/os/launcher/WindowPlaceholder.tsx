import { useEffect, useState } from 'react'
import { shell, type ShellWindow } from '@/os/kernel/shell'
import { AppIcon } from '@/os/ui/icons/AppIcon'

const iconCache = new Map<string, string | null>()

/** Stand-in for a window DWM can't preview (minimized): its icon and a label. */
export function WindowPlaceholder({ w, width, height }: { w: ShellWindow; width: number; height: number }) {
  const [icon, setIcon] = useState<string | null>(() => (w.exePath ? (iconCache.get(w.exePath) ?? null) : null))
  useEffect(() => {
    if (w.appId || !w.exePath || iconCache.has(w.exePath)) return
    const path = w.exePath
    void shell.fileIcons([path]).then((r) => {
      iconCache.set(path, r[path] ?? null)
      setIcon(r[path] ?? null)
    })
  }, [w.appId, w.exePath])
  const size = Math.min(56, height * 0.45)
  return (
    <span className="absolute left-[6px] top-[6px] flex flex-col items-center justify-center gap-2 rounded-[8px] bg-white/[0.07]" style={{ width, height }}>
      {w.appId ? <AppIcon appId={w.appId} size={size} /> : icon && <img src={icon} alt="" style={{ width: size, height: size }} />}
      <span className="text-[11px] text-white/55">Minimized</span>
    </span>
  )
}
