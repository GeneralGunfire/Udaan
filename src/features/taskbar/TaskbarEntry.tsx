import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { emit } from '@tauri-apps/api/event'
import { cn } from '@/shared/lib/cn'
import { pressableIcon } from '@/shared/lib/motion'
import type { OpenWindow } from '@/integrations/taskbar/client'
import type { ShowHoverPreviewPayload } from './taskbarPopupTypes'

// A real, deliberate hover — not a quick pass-over while moving the mouse
// toward something else — before the preview opens. Also directly fixes a
// reported bug: with the old ~150ms delay, clicking the preview's own
// close (X) button raced against the preview opening/closing again as the
// cursor crossed the physical gap between the taskbar's window and the
// separate popup window (see TaskbarPopupWindow.tsx), reading as a
// flicker/glitch right as you tried to click it. That race is now fixed
// at its real source — TaskbarPopupWindow.tsx debounces ALL hide requests
// by 300ms regardless of which side asked — so this delay no longer needs
// to be long enough to dodge the race itself; it only needs to distinguish
// "passing over on the way elsewhere" from "actually pausing here," which
// a real Windows taskbar reads in well under a second.
const HOVER_OPEN_DELAY_MS = 500

/**
 * Shared icon-button footprint for EVERY taskbar section — Start, running
 * apps, and the tray (mute/bell/clock) all import these same two
 * constants rather than picking their own sizes, so the row reads as one
 * uniform grid instead of icons visibly shrinking/growing across
 * sections (a real reported bug: the tray previously used ad-hoc
 * h-9/h-4.5 values instead of these shared constants).
 */
export const TASKBAR_ICON_BUTTON = 'h-14 w-14'
export const TASKBAR_ICON_GLYPH = 'h-7 w-7'

export interface WindowGroup {
  /** Stable grouping key — process name, so all windows from one app share one taskbar icon (matches how the real Windows taskbar groups). */
  processName: string
  windows: OpenWindow[]
}

/**
 * Hover-intent OPEN only needs a deliberate hold here (see
 * HOVER_OPEN_DELAY_MS) — CLOSE is emitted immediately on mouse-leave, with
 * no local delay, because the actual hide grace period now lives entirely
 * in TaskbarPopupWindow.tsx (a separate window) rather than being split
 * across both sides. That centralization is what fixes the real bug: the
 * mouse must physically leave this icon's bounds to travel toward the
 * popup floating above it, so a hide request WILL fire the instant that
 * happens no matter what — the popup is the one place that can correctly
 * decide "is the cursor now somewhere else that also wants me open" (its
 * own hover, or a fresh show event for a different entry) before actually
 * disappearing, since it's the only side that can observe both.
 */
function useHoverIntent(onOpen: () => void) {
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleOpen = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    openTimerRef.current = setTimeout(onOpen, HOVER_OPEN_DELAY_MS)
  }, [onOpen])
  const cancelOpen = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current)
    openTimerRef.current = null
  }, [])

  return { scheduleOpen, cancelOpen }
}

/**
 * One taskbar icon, representing either a single window or a group of
 * windows from the same process (Windows-style grouping — multiple
 * Explorer/Chrome/VS Code windows collapse into one icon).
 *
 * Hover preview and the right-click context menu are NOT rendered here —
 * they're a separate on-demand Tauri window (see TaskbarPopupWindow.tsx),
 * triggered by emitting `taskbar-popup:show`/`taskbar-popup:hide` events
 * with this entry's screen position and window list. Rendering them
 * inside the taskbar dock's own window was tried and reverted: it
 * required making the dock's window taller than its visible strip so the
 * popup had room to paint, and a transparent window intercepts clicks
 * across its ENTIRE rect regardless of what's actually drawn there —
 * which intermittently stole clicks/keystrokes meant for other apps. A
 * separate window that's hidden (and therefore receives zero input) until
 * the exact moment it's needed has no such risk.
 *
 * Running-state is shown as a small dot ABOVE the icon (not a pill
 * crowding its bottom edge) — brighter/filled cyan when the group's
 * active window has focus, dim/hollow when running but unfocused.
 */
export function TaskbarEntry({
  group,
  foreground,
  onEntryClick,
}: {
  group: WindowGroup
  foreground: number
  onEntryClick: (win: OpenWindow) => void
}) {
  const [iconFailed, setIconFailed] = useState(false)
  // Hover is tracked as explicit React state rather than relying on CSS
  // `:hover`/`group-hover:` — a real, reported bug: `:hover` is computed
  // by the OS/webview from live cursor position, and cross-window focus
  // changes (clicking this icon focuses a DIFFERENT top-level window,
  // which is exactly what every click here does) can steal focus/repaint
  // without the browser ever delivering a `mouseleave` to this element
  // first, leaving the CSS hover state visually "stuck" on until the
  // cursor happens to physically move again. Explicit state driven by
  // real mouseenter/mouseleave/pointercancel/blur handlers below is
  // guaranteed to clear even when that happens, since it's cleared
  // proactively rather than only in response to a `:hover` recomputation
  // that may never come.
  const [isHovered, setIsHovered] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const isGroup = group.windows.length > 1
  const primary = group.windows[0]
  const anyActive = group.windows.some((w) => w.handle === foreground && !w.isMinimized)
  const anyMinimizedOnly = !anyActive && group.windows.some((w) => w.handle === foreground)

  function anchorPoint() {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    // getBoundingClientRect is relative to THIS window's own viewport —
    // convert to physical screen coordinates by adding the taskbar
    // window's own screen position, since the popup window needs an
    // absolute position, not one relative to the dock.
    return { x: window.screenX + rect.left + rect.width / 2, y: window.screenY + rect.top }
  }

  const showHoverPreview = useCallback(() => {
    const { x, y } = anchorPoint()
    const payload: ShowHoverPreviewPayload = {
      kind: 'hover-preview',
      x,
      y,
      processName: group.processName,
      isGroup,
      windows: group.windows,
      foreground,
    }
    void emit('taskbar-popup:show', payload)
    // anchorPoint reads buttonRef/window.screen* directly rather than
    // through props/state, so it's intentionally not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, isGroup, foreground])

  const { scheduleOpen, cancelOpen } = useHoverIntent(showHoverPreview)

  function handleMouseEnter() {
    setIsHovered(true)
    scheduleOpen()
  }

  function scheduleClose() {
    setIsHovered(false)
    setIsPressed(false)
    cancelOpen()
    void emit('taskbar-popup:hide')
  }

  // Real-Windows click semantics: a running app that's currently
  // focused-and-restored minimizes on click; a running-but-unfocused
  // (or minimized) app comes to focus/restores instead. A grouped icon
  // with no window currently focused just cycles to the next window,
  // matching "focus the app" when no specific window has been picked
  // from the flyout yet.
  function handleClick() {
    void emit('taskbar-popup:hide')
    setIsPressed(false)
    if (isGroup) {
      const activeIdx = group.windows.findIndex((w) => w.handle === foreground)
      const next = group.windows[(activeIdx + 1) % group.windows.length]
      onEntryClick(next)
    } else {
      onEntryClick(primary)
    }
  }

  function handleMiddleClick(e: React.MouseEvent) {
    if (e.button !== 1) return
    e.preventDefault()
    // Middle-click opens a NEW instance/window rather than toggling the
    // existing one — matches real Windows taskbar behavior for apps that
    // support multiple windows. `onEntryClick` with a synthetic "no
    // matching handle" target would just re-focus an existing window, so
    // this launches independently via the same process the app itself
    // would use to open a new window: re-invoking focus on a fabricated
    // miss is wrong, so this asks the OS to start a fresh instance of the
    // process instead.
    void emit('taskbar:new-instance', { processName: group.processName })
  }

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={scheduleClose}
    >
      <motion.button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onAuxClick={handleMiddleClick}
        onPointerDown={(e) => {
          if (e.button === 0) setIsPressed(true)
        }}
        onPointerUp={() => setIsPressed(false)}
        // Safety net for the stuck-hover bug: if the pointer capture is
        // cancelled (e.g. the OS steals it for a drag-to-reorder gesture,
        // or focus moves to another top-level window mid-press without a
        // clean mouseup ever reaching this element) both hover and press
        // are force-cleared rather than possibly staying lit forever.
        onPointerCancel={() => {
          setIsHovered(false)
          setIsPressed(false)
        }}
        onFocus={() => setIsHovered(true)}
        onBlur={() => {
          setIsPressed(false)
          setIsHovered(false)
        }}
        whileHover={pressableIcon.whileHover}
        whileTap={pressableIcon.whileTap}
        transition={pressableIcon.transition}
        aria-label={isGroup ? `${group.processName} (${group.windows.length})` : primary.title}
        aria-pressed={anyActive}
        className={cn(
          TASKBAR_ICON_BUTTON,
          'relative flex shrink-0 items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/40',
        )}
      >
        {/* The active/hover background box is intentionally smaller than
            the button's own full h-14 w-14 footprint (inset on all sides,
            not edge-to-edge) so it reads as a discrete highlight sitting
            inside the slot rather than a tile that touches the dock's own
            top/bottom edges. Driven entirely by explicit isHovered/
            isPressed state (not CSS :hover/group-hover) — see the
            isHovered doc comment above for why. */}
        <span
          className={cn(
            'pointer-events-none absolute inset-1.5 rounded-xl border transition-colors duration-150',
            anyActive
              ? isPressed
                ? 'bg-white/18 border-white/16'
                : 'bg-white/14 border-white/12'
              : anyMinimizedOnly
                ? 'bg-white/7 border-transparent'
                : isHovered
                  ? 'bg-white/10 border-white/10'
                  : 'border-transparent bg-transparent',
          )}
          aria-hidden
        />
        {primary.iconDataUrl && !iconFailed ? (
          <img
            key={primary.iconDataUrl}
            src={primary.iconDataUrl}
            alt=""
            onError={() => setIconFailed(true)}
            className={cn(
              TASKBAR_ICON_GLYPH,
              'object-contain transition-opacity duration-150',
              !isGroup && primary.isMinimized ? 'opacity-45' : 'opacity-100',
            )}
            style={{ imageRendering: 'crisp-edges' }}
            draggable={false}
          />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15 text-base font-semibold text-white/80">
            {group.processName.charAt(0).toUpperCase()}
          </span>
        )}

        {/* Grouped-window count badge — corner-anchored but kept fully
            INSIDE the button's own bounds (no negative offset) rather than
            poking above/outside it. The dock card that contains this
            button clips overflow (see TaskbarWindow.tsx), and with the
            larger dock the button sits close enough to the card's own top
            edge that a badge floating outside the button was getting cut
            off there — an inset badge can never run into that regardless
            of dock sizing. */}
        {isGroup && (
          <span className="bg-brand-cyan text-bg-base absolute top-0.5 right-0.5 flex h-5 w-5 items-center justify-center rounded-full text-2xs font-bold ring-2 ring-[#0a0d13]">
            {group.windows.length}
          </span>
        )}

        {/* Running/focused indicator — a short bar riding the BOTTOM edge
            of the icon (Windows-11-style), not a small dot floating above
            it — at real taskbar scale a dot reads as barely-there, while a
            bar gives the whole icon a confident anchored base. Widens and
            brightens when the group's active window has focus; short and
            dim when running but unfocused. `layoutId` glides it between
            entries on focus change instead of snapping. No glow/box-shadow
            on the active state — a plain solid bar reads as "this one's
            active" without the icon standing out from the rest of the
            dock. */}
        {(anyActive || anyMinimizedOnly) && (
          <motion.span
            layoutId={`taskbar-indicator-${group.processName}`}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className={cn(
              'absolute -bottom-1.5 left-1/2 h-1 -translate-x-1/2 rounded-full',
              anyActive ? 'w-6 bg-brand-cyan' : 'w-2.5 bg-white/35',
            )}
            aria-hidden
          />
        )}
      </motion.button>
    </div>
  )
}
