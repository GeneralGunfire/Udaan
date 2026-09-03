import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window'
import { emit, listen } from '@tauri-apps/api/event'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { spring } from '@/shared/lib/motion'
import { WindowCloseIcon } from '@/shared/icons'
import {
  closeWindow,
  focusWindow,
  minimizeWindow,
  registerThumbnail,
  updateThumbnail,
  unregisterThumbnail,
  unregisterAllThumbnails,
  type OpenWindow,
} from '@/integrations/taskbar/client'
import { BellIcon, WindowMinimizeIcon } from '@/shared/icons'
import type { ShowHoverPreviewPayload, ShowTaskbarPopupPayload } from './taskbarPopupTypes'
import { QuickSettingsPanel } from './QuickSettingsPanel'

/**
 * A dedicated, on-demand Tauri window (see tauri.conf.json's
 * "taskbar-popup" entry) that renders the taskbar's hover preview and
 * right-click context menu — NOT rendered inside the taskbar dock's own
 * window like the first attempt at this feature. That approach required
 * making the taskbar window taller than its visible dock so the popup had
 * room to paint, which created a severe bug: a transparent window still
 * intercepts clicks across its ENTIRE rect regardless of what's actually
 * drawn there (Tauri has no per-pixel hit-testing), and even with
 * mouse-position-based click-through toggling, the async/racy nature of
 * that toggle occasionally left the taskbar's invisible extra height
 * stealing clicks and keystrokes meant for whatever real app was
 * underneath it (reported directly: "the taskbar is getting selected"
 * while trying to type in VS Code).
 *
 * A separate window sidesteps all of that: it's 1x1 and hidden
 * (`visible: false`) until the moment something needs to show, at which
 * point TaskbarEntry.tsx (running in the DIFFERENT taskbar window) emits
 * a `taskbar-popup:show` event with everything needed to render, and this
 * window resizes/repositions itself to fit and becomes visible. It's
 * hidden again immediately on `taskbar-popup:hide` — while hidden, it can
 * never intercept a click for anything, by construction, since a hidden
 * window receives no input events at all.
 */

// Widened from the original 260px text-list card — a real DWM thumbnail at
// a size actually worth looking at (THUMB_WIDTH below) needs more horizontal
// room than a title row ever did; this is one of the few places a size
// change is justified, since real Windows 11 hover previews are
// meaningfully wider than a menu-style flyout for exactly this reason.
const POPUP_WIDTH = 300
// Live-thumbnail pixel dimensions for a single-window (or per-row, for a
// small group) preview. 16:10-ish, big enough to actually read window
// content at a glance without ballooning the popup — matches the rough
// proportions Windows 11's own taskbar previews use.
const THUMB_WIDTH = 268
const THUMB_HEIGHT = 151
// Tightened from 14px: the popup previously read as a floating, unrelated
// card sitting somewhere above the dock ("feels disconnected from the
// taskbar" — the reported complaint this pass addresses). An 8px gap plus
// the connector notch below (which visually bridges the remaining space)
// reads as "attached to" the icon it's anchored to rather than merely
// "near" it, while still leaving enough of a seam that the popup doesn't
// look fused/overlapping with the dock's own top edge.
const POPUP_BOTTOM_MARGIN = 8
// Minimum breathing room kept between the popup and the true screen edge
// when clamping — a popup flush against the very edge of the display
// reads as clipped even at 0px of actual overlap.
const SCREEN_EDGE_MARGIN = 8
// Small triangular notch pointing down at the anchor icon — the other half
// of "feels disconnected": a plain floating rounded rectangle has no visual
// link to the specific icon it belongs to, especially with several icons
// in a row. A notch is the same affordance native Windows/macOS flyouts use
// for exactly this. Kept purely cosmetic/decorative (not part of the
// click-through-safe content rect below) — see the notch's own render
// comment for how its overlap with the card is handled so it never expands
// the window's real hit-testable area.
const NOTCH_SIZE = 8
// The notch renders as a sibling below the card with `marginTop: -1` (a
// 1px overlap so there's no visible seam between it and the card's own
// border) — its real contribution to the popup window's total content
// height is therefore its full triangle height minus that 1px overlap.
// Kept as one named constant so estimateHeight() and the real
// post-render measurement (see the useLayoutEffect below) can never
// drift out of sync with each other.
const NOTCH_HEIGHT_CONTRIBUTION = NOTCH_SIZE - 1

/**
 * `currentMonitor()` is its own IPC round-trip to Rust — calling it fresh
 * on every single show (and AGAIN on the post-measurement re-position, see
 * the layout effect below) doubled the number of awaited round-trips
 * before a popup finished settling into place, which is what made opening
 * a popup feel laggy rather than instant. The monitor a popup opens on
 * doesn't change between the estimate-pass and the measured-pass of the
 * SAME show — those two calls are milliseconds apart — so the result is
 * cached for a short window and reused, cut to zero extra round-trips for
 * the common case instead of one per positioning pass. Long enough to
 * cover both passes of one popup open, short enough that a real monitor
 * change (unplugging/replugging a display) is picked up again well before
 * it could ever go stale in a way a user would notice.
 */
let cachedMonitor: Awaited<ReturnType<typeof currentMonitor>> | null = null
let cachedMonitorAt = 0
const MONITOR_CACHE_MS = 2000

async function getMonitorCached() {
  const now = Date.now()
  if (cachedMonitor && now - cachedMonitorAt < MONITOR_CACHE_MS) return cachedMonitor
  cachedMonitor = await currentMonitor()
  cachedMonitorAt = now
  return cachedMonitor
}

/**
 * `window.scaleFactor()` is another Tauri IPC round-trip — cached for the
 * same reason getMonitorCached() is: this window's DPI scale can't change
 * without the whole window being torn down/recreated on a different
 * monitor, so there's no real freshness concern, only avoided latency.
 *
 * THE BUG THIS FIXES: every coordinate this file receives or measures —
 * `event.payload.x/y` (computed in TaskbarEntry.tsx/TaskbarWindow.tsx via
 * `getBoundingClientRect()`/`window.screenX`/`e.clientX`, all CSS/LOGICAL
 * pixels) and this window's own `getBoundingClientRect()` reads (used for
 * both the post-render re-measure AND the live DWM thumbnail rects) — is
 * in LOGICAL pixels. But `PhysicalPosition`/`PhysicalSize` (used for
 * `setPosition`/`setSize`) and `currentMonitor()`'s `position`/`size`
 * (used for on-screen clamping) are all PHYSICAL pixels. On any display
 * that ISN'T at exactly 100% Windows scaling (125%/150%/200% are all
 * common), mixing the two without converting produced a real,
 * reproducible bug: the popup rendered at the wrong size/position
 * (offset roughly proportional to the scale factor), sometimes badly
 * enough to read as "doesn't show correctly" — and the SAME unconverted
 * rects were being handed to the DWM thumbnail APIs too, which would
 * misplace/mis-size live thumbnails the same way. Every logical value in
 * this file is now run through `toPhysical()` before it's used to
 * construct a `Physical*` type or sent to a Rust command that expects
 * physical pixels.
 */
let cachedScaleFactor: number | null = null
async function getScaleFactorCached(): Promise<number> {
  if (cachedScaleFactor !== null) return cachedScaleFactor
  cachedScaleFactor = await getCurrentWindow().scaleFactor()
  return cachedScaleFactor
}

/** Converts a single logical-pixel value to physical pixels using this window's cached scale factor. */
async function toPhysical(logical: number): Promise<number> {
  const factor = await getScaleFactorCached()
  return Math.round(logical * factor)
}

/**
 * Clamps the popup's target rect to the current monitor's bounds — without
 * this, a popup anchored to a taskbar icon near the left/right edge of the
 * screen (the leftmost Udaan icon is the most common case, but any icon
 * near either edge on a narrower or off-center dock hits this too) was
 * simply positioned at `anchor - width/2`/`anchor - height`, with nothing
 * stopping that math from landing partly or fully off-screen. Radix (used
 * everywhere else popups render inside the main window's own viewport)
 * handles this automatically via its own collision detection, but this
 * popup is a REAL, separate OS-level window positioned with raw physical
 * pixel coordinates — there's no viewport to collide-detect against
 * unless it's computed here. A cut-off popup isn't just a visual glitch:
 * whatever fell off-screen (a "Close all windows" button, part of a
 * window-list row) is also physically un-clickable, since there's no
 * screen real estate there to click.
 *
 * All four arguments are expected in PHYSICAL pixels already (matching
 * `currentMonitor()`'s own units) — callers passing logical values (e.g.
 * from `event.payload.x/y`) must run them through `toPhysical()` first.
 */
async function clampToScreen(x: number, y: number, width: number, height: number): Promise<{ x: number; y: number }> {
  try {
    const monitor = await getMonitorCached()
    if (!monitor) return { x: Math.round(x), y: Math.round(y) }
    const { position, size } = monitor
    const minX = position.x + SCREEN_EDGE_MARGIN
    const maxX = position.x + size.width - width - SCREEN_EDGE_MARGIN
    const minY = position.y + SCREEN_EDGE_MARGIN
    const maxY = position.y + size.height - height - SCREEN_EDGE_MARGIN
    return {
      x: Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX))),
      y: Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY))),
    }
  } catch (err) {
    console.error('Failed to read monitor bounds for popup clamping:', err)
    return { x: Math.round(x), y: Math.round(y) }
  }
}

/**
 * Rough pre-measurement height guess per payload kind — refined for real
 * once the content is actually in the DOM (see the useLayoutEffect below).
 *
 * Real Windows 11 only shows one thumbnail per row up to 3 windows in a
 * group; beyond that it collapses to a stacked/summary view rather than N
 * full-size thumbnails (which would make the flyout enormous). This app
 * follows the same rule (see HoverPreviewContent/MAX_THUMBNAIL_ROWS below)
 * — kept in sync here so the estimate matches what actually renders.
 */
function estimateHeight(payload: ShowTaskbarPopupPayload): number {
  switch (payload.kind) {
    case 'hover-preview': {
      const headerHeight = 30
      const thumbRows = Math.min(payload.windows.length, MAX_THUMBNAIL_ROWS)
      const listRows = payload.isGroup ? payload.windows.length : 0
      // Thumbnail tile is now just THUMB_HEIGHT tall — the title/action
      // strip that used to sit below it is gone (actions now float over
      // the thumbnail itself on hover, see ThumbnailTile).
      const thumbBlockHeight = thumbRows * (THUMB_HEIGHT + 6) + 8
      const listRowHeight = 30
      // Padded a few px over the tightest-possible math on purpose: this
      // estimate sizes the REAL OS window before anything has painted, and
      // the only two outcomes are "slightly too tall" (invisible — a
      // shrink-correction below just removes empty space nobody saw) or
      // "too short" (visible — content is genuinely clipped against a
      // fixed-size, non-scrolling window until the correction lands a
      // frame later, which is what made the popup feel like it "cut off").
      // Erring tall trades an invisible one-off overestimate for
      // eliminating the visible case entirely.
      const estimatePadding = 6
      return headerHeight + thumbBlockHeight + listRows * listRowHeight + 10 + NOTCH_HEIGHT_CONTRIBUTION + estimatePadding
    }
    case 'notifications-panel':
      return 200 + NOTCH_HEIGHT_CONTRIBUTION
    case 'quick-settings':
      // Two toggle tiles (~58) + volume row (~46) + up to three stat rows
      // (~34 each) + the panel's own gaps/padding. Erring tall for the
      // same reason the hover-preview estimate does — see above.
      return 58 + 46 + 3 * 34 + 34 + NOTCH_HEIGHT_CONTRIBUTION
  }
}

/**
 * Beyond 3 windows, real Windows 11 stops rendering a full-size live
 * thumbnail per window and falls back to a compact title-list instead —
 * matched here for the same reason: N live DWM thumbnails is both visually
 * unwieldy (the flyout would need to be enormous) and resource-heavier
 * (each one is its own registered DWM composition surface). 1-3 windows
 * still get real thumbnails, exactly like the native flyout.
 */
const MAX_THUMBNAIL_ROWS = 3

export function TaskbarPopupWindow() {
  const [payload, setPayload] = useState<ShowTaskbarPopupPayload | null>(null)
  const anchorRef = useRef({ x: 0, y: 0 })
  const contentRef = useRef<HTMLDivElement>(null)

  // The real bug this fixes: TaskbarEntry.tsx (a DIFFERENT window) and
  // this window's own onMouseLeave (below) can each independently ask to
  // hide — but the cursor genuinely has to leave the trigger's bounds to
  // physically travel to this floating popup, so an IMMEDIATE hide on
  // that first request closed the popup before the mouse could ever
  // arrive, no matter how generous either side's own internal delay was.
  // The fix: hide requests are debounced HERE, in the one place that
  // actually owns visibility — a `taskbar-popup:hide` event schedules a
  // close after a real grace window rather than acting immediately, and
  // ANY fresh `taskbar-popup:show` (the same entry re-confirming hover,
  // this popup's own mouse-enter re-showing itself, or moving straight to
  // a different entry) cancels that pending close. This is robust
  // regardless of which side's timer fired first, since there's only one
  // decision point now instead of two independent ones racing.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function cancelPendingHide() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }

  useEffect(() => {
    let unlistenShow: (() => void) | undefined
    let unlistenHide: (() => void) | undefined
    let cancelled = false

    async function init() {
      unlistenShow = await listen<ShowTaskbarPopupPayload>('taskbar-popup:show', async (event) => {
        if (cancelled) return
        cancelPendingHide()
        anchorRef.current = { x: event.payload.x, y: event.payload.y }
        // Rough initial size from an estimate — avoids a visible zero-size
        // flash before the real content has rendered and can be measured.
        // Actual sizing/positioning happens for real in the layout effect
        // below, once the DOM reflects the new content.
        //
        // The size/position/show calls used to be awaited one after
        // another — each is its own Tauri IPC round-trip, so doing them
        // in series stacked their latencies and made every popup open
        // feel noticeably laggy. setSize and setPosition don't depend on
        // each other's *result*, only need to both land before the
        // window is shown, so they're fired together and awaited once —
        // same eventual state, roughly half the round-trip latency on
        // the critical path to first paint.
        const win = getCurrentWindow()
        const estimatedHeight = estimateHeight(event.payload)
        // anchorRef.current.x/y arrive as LOGICAL pixels (see toPhysical's
        // doc comment above) — converted here, alongside the popup's own
        // logical-pixel design constants, before anything touches a
        // Physical* type or clampToScreen (which compares against
        // currentMonitor()'s physical bounds).
        const scale = await getScaleFactorCached()
        const anchorXPhys = Math.round(anchorRef.current.x * scale)
        const anchorYPhys = Math.round(anchorRef.current.y * scale)
        const widthPhys = Math.round(POPUP_WIDTH * scale)
        const heightPhys = Math.round(estimatedHeight * scale)
        const marginPhys = Math.round(POPUP_BOTTOM_MARGIN * scale)
        const { x, y } = await clampToScreen(
          anchorXPhys - widthPhys / 2,
          anchorYPhys - heightPhys - marginPhys,
          widthPhys,
          heightPhys,
        )
        await Promise.all([
          win.setSize(new PhysicalSize(widthPhys, heightPhys)),
          win.setPosition(new PhysicalPosition(x, y)),
        ])
        setPayload(event.payload)
        await win.show()
      })
      unlistenHide = await listen('taskbar-popup:hide', () => {
        if (cancelled) return
        cancelPendingHide()
        // 300ms — long enough that the cursor can physically travel from
        // the taskbar icon up to the floating popup above it without the
        // popup vanishing mid-transit (the original bug this debounce
        // fixes, see the doc comment on hideTimerRef above), but short
        // enough that a genuine "moved away, done with this" doesn't read
        // as sluggish — real Windows 11 closes its own preview well under
        // half a second after the cursor truly leaves. Left unchanged from
        // the prior implementation: it was already correctly tuned: the
        // *reported* timing complaint traced to HOVER_OPEN_DELAY_MS (the
        // open side, see TaskbarEntry.tsx) and to the positioning jump
        // from the estimate/measure gap, not to this close-side debounce.
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null
          setPayload(null)
          void getCurrentWindow().hide()
          // Defensive: unregister every live DWM thumbnail whenever the
          // popup actually hides, regardless of which window/group it was
          // last showing — belt-and-suspenders alongside the per-window
          // unregister calls in HoverPreviewContent's own cleanup effect,
          // so a thumbnail can never outlive the popup being visible.
          void unregisterAllThumbnails()
          // Broadcast that the popup has actually closed, regardless of
          // WHY (mouse moved away, a close action, etc.) — lets a trigger
          // like the notifications bell button keep its own "is my panel
          // currently open" state in sync even when the popup was
          // dismissed some other way than clicking that same button again.
          void emit('taskbar-popup:hidden')
        }, 300)
      })
    }
    void init()

    return () => {
      cancelled = true
      unlistenShow?.()
      unlistenHide?.()
      cancelPendingHide()
    }
  }, [])

  // Escape closes the popup immediately — the documented accessible way
  // to dismiss a context menu/flyout on Windows, and previously missing
  // entirely here (mouse-leave was the only dismiss path). Also guards
  // against orphaned/blocking interactive state: without this, pressing
  // Escape while the popup was open did nothing, leaving it sitting on
  // top (still receiving input, since this window is real and topmost)
  // until the mouse happened to move away from it.
  useEffect(() => {
    if (!payload) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        void hideSelf()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  // A click that lands on the popup's OWN backdrop area (the padding
  // around the card, not the card itself) closes it immediately — the
  // click-outside-to-close behavior real Windows context menus/flyouts
  // have. Clicks on the card's own interactive rows are left alone; they
  // already close the popup themselves after acting (see
  // handleEntryClick/handleCloseOne etc. below).
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      void hideSelf()
    }
  }

  // Corrects the window's size/position against the REAL rendered content
  // height once it's actually in the DOM — the estimate above is only a
  // placeholder to avoid a flash before first paint. Without this
  // correction, any gap between the estimate and the true content height
  // (e.g. long window titles wrapping, font-metrics rounding) shifts the
  // popup's bottom edge slightly past where it should sit, reading as a
  // faint overlap with the taskbar icon/dock below it. useLayoutEffect
  // (not useEffect) so this runs synchronously after the DOM update,
  // before the user has a chance to see the unmeasured/estimated frame.
  useLayoutEffect(() => {
    if (!payload || !contentRef.current) return
    const rect = contentRef.current.getBoundingClientRect()
    // The card itself is measured (contentRef), then the notch's own
    // fixed footprint is added back on top — the notch is a sibling
    // element (so it can overlap the card's bottom edge by design, see
    // its render comment) rather than living inside contentRef, so it
    // never shows up in contentRef's own measured rect.
    const measuredHeight = Math.ceil(rect.height) + NOTCH_HEIGHT_CONTRIBUTION
    // Skip the whole re-measure/re-position round-trip if the estimate
    // already matched reality (the common case — estimateHeight() is
    // usually spot-on for a short menu/preview) — avoids two extra IPC
    // calls' worth of latency on every popup open for no visible change.
    if (measuredHeight === estimateHeight(payload)) return
    const win = getCurrentWindow()
    void (async () => {
      // Same logical-to-physical conversion as the initial show handler
      // above — measuredHeight/anchorRef/POPUP_WIDTH/POPUP_BOTTOM_MARGIN
      // are all still logical pixels at this point.
      const scale = await getScaleFactorCached()
      const anchorXPhys = Math.round(anchorRef.current.x * scale)
      const anchorYPhys = Math.round(anchorRef.current.y * scale)
      const widthPhys = Math.round(POPUP_WIDTH * scale)
      const heightPhys = Math.round(measuredHeight * scale)
      const marginPhys = Math.round(POPUP_BOTTOM_MARGIN * scale)
      const { x, y } = await clampToScreen(
        anchorXPhys - widthPhys / 2,
        anchorYPhys - heightPhys - marginPhys,
        widthPhys,
        heightPhys,
      )
      await Promise.all([
        win.setSize(new PhysicalSize(widthPhys, heightPhys)),
        win.setPosition(new PhysicalPosition(x, y)),
      ])
    })()
  }, [payload])

  async function handleEntryClick(win: OpenWindow) {
    await focusWindow(win.handle)
    await hideSelf()
  }

  async function handleCloseWindow(handle: number) {
    await closeWindow(handle)
    // Tell the (separate) main taskbar window to re-poll immediately
    // rather than waiting for its next scheduled tick. Don't hide THIS
    // popup — closing one window in a group shouldn't dismiss the whole
    // preview; moving the mouse away closes it normally.
    void emit('taskbar-popup:window-closed')
  }

  async function hideSelf() {
    await getCurrentWindow().hide()
    setPayload(null)
    void unregisterAllThumbnails()
    void emit('taskbar-popup:hidden')
  }

  // Mouse leaving THIS popup routes through the exact same debounced
  // hide path as a `taskbar-popup:hide` event from the taskbar window
  // (see cancelPendingHide/the listener above) — one shared decision
  // point instead of two independent timers that could each fire and
  // hide the popup out from under the other side's own grace period.
  function scheduleHideFromPopup() {
    cancelPendingHide()
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null
      void hideSelf()
    }, 300)
  }

  if (!payload) return null

  return (
    <div className="flex h-full w-full flex-col items-center justify-start p-1" onClick={handleBackdropClick}>
      <AnimatePresence>
        <motion.div
          key={payload.kind + ('processName' in payload ? payload.processName : '')}
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.97 }}
          transition={spring.standard}
          className="flex w-full flex-col items-center"
        >
          <div
            ref={contentRef}
            data-overlay-scroll
            className="flex w-full flex-col overflow-y-auto rounded-2xl border border-(--border-hairline)"
            // Safety net, not the primary sizing mechanism: the OS window
            // itself is sized from estimateHeight()/the real measurement
            // below, so this cap should never actually engage — but if a
            // measurement is ever off (unusual font metrics, a future
            // content change nobody updated the estimate for), scrolling
            // beats hard-clipping content with no way to reach it.
            style={{
              background: 'var(--surface-overlay)',
              boxShadow: 'inset 0 1px 0 var(--highlight-inset), var(--shadow-modal)',
              maxHeight: 480,
            }}
            onMouseEnter={cancelPendingHide}
            onMouseLeave={scheduleHideFromPopup}
          >
            {payload.kind === 'hover-preview' ? (
              <HoverPreviewContent payload={payload} onEntryClick={handleEntryClick} onCloseWindow={handleCloseWindow} />
            ) : payload.kind === 'quick-settings' ? (
              <QuickSettingsPanel />
            ) : (
              <NotificationsPanelContent />
            )}
          </div>
          {/* Connector notch — a small triangle pointing down at the anchor
              icon, the same affordance native flyouts use to visually
              "attach" a floating panel to whatever it's anchored to. Purely
              decorative: it's a zero-height/negative-margin element that
              overlaps the card's own bottom edge rather than adding real
              layout height below it, so it never grows this window's
              actual content rect (and therefore never grows the popup
              window's real, hit-testable size) beyond what
              estimateHeight()/the measured layout effect already account
              for — critical given this window intercepts input across its
              ENTIRE rect (see this file's top-of-file doc comment); the
              notch must ride inside the already-sized card's footprint,
              never add to it. */}
          <div
            aria-hidden
            className="shrink-0"
            style={{
              width: 0,
              height: 0,
              marginTop: -1,
              borderLeft: `${NOTCH_SIZE}px solid transparent`,
              borderRight: `${NOTCH_SIZE}px solid transparent`,
              borderTop: `${NOTCH_SIZE}px solid var(--surface-overlay)`,
              filter: 'drop-shadow(0 3px 3px rgb(0 0 0 / 24%))',
            }}
          />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function HoverPreviewContent({
  payload,
  onEntryClick,
  onCloseWindow,
}: {
  payload: ShowHoverPreviewPayload
  onEntryClick: (win: OpenWindow) => void
  onCloseWindow: (handle: number) => void
}) {
  async function handleMinimize(handle: number) {
    await minimizeWindow(handle)
    void emit('taskbar-popup:window-closed')
  }

  // Beyond MAX_THUMBNAIL_ROWS, real Windows 11 stops rendering a live
  // thumbnail per window (see estimateHeight's doc comment above for why)
  // — those windows still get a row, just a plain title row like the
  // original text-list design, rather than a thumbnail.
  const thumbnailWindows = payload.windows.slice(0, MAX_THUMBNAIL_ROWS)
  const listOnlyWindows = payload.windows.slice(MAX_THUMBNAIL_ROWS)

  return (
    <div className="flex flex-col">
      {/* Header always shown (not just for groups) — the app name reads
          as the card's title, same as a real window-preview thumbnail's
          caption, giving even a single-window preview real identity
          instead of being just a bare row. No border rule under it — a
          plain gap of empty space reads as quieter/more minimal than a
          hard divider line here, and the thumbnail cards below already
          have their own edges to establish structure. */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        {payload.windows[0].iconDataUrl ? (
          <img src={payload.windows[0].iconDataUrl} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" draggable={false} />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0 rounded bg-white/15" />
        )}
        <p className="text-text-secondary min-w-0 flex-1 truncate text-2xs font-medium">
          {payload.processName.replace(/\.exe$/i, '')}
          {payload.isGroup && <span className="text-text-tertiary"> · {payload.windows.length}</span>}
        </p>
      </div>

      <div className="flex flex-col gap-1.5 p-2 pt-0.5">
        {thumbnailWindows.map((win) => (
          <ThumbnailTile
            key={win.handle}
            win={win}
            isActive={win.handle === payload.foreground && !win.isMinimized}
            onEntryClick={onEntryClick}
            onCloseWindow={onCloseWindow}
            onMinimize={handleMinimize}
          />
        ))}
      </div>

      {listOnlyWindows.length > 0 && (
        <div className="flex flex-col gap-0.5 px-1.5 pb-1.5">
          {listOnlyWindows.map((win) => {
            const isActive = win.handle === payload.foreground && !win.isMinimized
            return (
              <div
                key={win.handle}
                className={cn(
                  'group relative flex items-center gap-2 rounded-xl border py-2 px-2.5 text-left text-xs transition-colors duration-150',
                  isActive
                    ? 'bg-white/14 border-white/14 text-text-primary'
                    : 'text-text-secondary hover:bg-white/8 hover:border-white/10 border-transparent hover:text-text-primary',
                )}
              >
                <button
                  type="button"
                  onClick={() => onEntryClick(win)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className={cn('min-w-0 flex-1 truncate', win.isMinimized && 'opacity-55')}>{win.title}</span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleMinimize(win.handle)
                    }}
                    aria-label={`Minimize ${win.title}`}
                    className="text-text-tertiary hover:bg-white/12 hover:text-text-primary flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md transition-colors duration-150"
                  >
                    <WindowMinimizeIcon width={10} height={10} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseWindow(win.handle)
                    }}
                    aria-label={`Close ${win.title}`}
                    className="text-text-tertiary hover:bg-danger/20 hover:text-danger flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md transition-colors duration-150"
                  >
                    <WindowCloseIcon width={11} height={11} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * One live-thumbnail row: a real DWM composition of `win`'s current
 * on-screen content (via `DwmRegisterThumbnail`, see
 * src-tauri/src/taskbar/mod.rs), plus a title/action strip below it —
 * closer to real Windows 11's own hover preview than the plain text row
 * this replaces.
 *
 * Registration is fully owned by this component's lifecycle: it registers
 * on mount (once the thumbnail placeholder div has actually laid out and
 * has real client coordinates to hand DWM), re-positions on layout changes
 * via the same coordinates already computed for CSS, and ALWAYS
 * unregisters on unmount — covering every way a tile can stop being shown
 * (popup closes entirely, this window drops out of MAX_THUMBNAIL_ROWS,
 * the window itself closes and the whole payload swaps). This is the
 * primary cleanup path; TaskbarPopupWindow's own hide handlers additionally
 * call `unregisterAllThumbnails()` as a defensive sweep in case a tile's
 * own unmount is ever skipped (e.g. an abrupt window-level teardown).
 *
 * On registration failure (source window closed between hover and paint,
 * DWM composition disabled, access denied) this falls back to a plain
 * icon+title placeholder instead of a broken/black rect — never crashes,
 * never leaves an obviously-broken box on screen.
 */
function ThumbnailTile({
  win,
  isActive,
  onEntryClick,
  onCloseWindow,
  onMinimize,
}: {
  win: OpenWindow
  isActive: boolean
  onEntryClick: (win: OpenWindow) => void
  onCloseWindow: (handle: number) => void
  onMinimize: (handle: number) => void
}) {
  const thumbRef = useRef<HTMLDivElement>(null)
  const thumbIdRef = useRef<number | null>(null)
  const [thumbFailed, setThumbFailed] = useState(false)

  useLayoutEffect(() => {
    let cancelled = false
    setThumbFailed(false)

    async function register() {
      const el = thumbRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      // DwmRegisterThumbnail's destination rect is in the POPUP window's
      // own client coordinates, so there's no CROSS-WINDOW translation
      // needed here (unlike the anchor-point math in TaskbarEntry.tsx,
      // which reads a position in a DIFFERENT window and hands it to this
      // one) — but getBoundingClientRect() still returns LOGICAL/CSS
      // pixels, and DWM's client-coordinate rect is PHYSICAL pixels, same
      // as everywhere else in this file. Converting here is what fixes a
      // real bug: on any non-100%-scaled display, the thumbnail was
      // registered at the wrong size/position within the popup (offset
      // and/or clipped, roughly proportional to the scale factor).
      const scale = await getScaleFactorCached()
      const left = Math.round(rect.left * scale)
      const top = Math.round(rect.top * scale)
      const right = Math.round(rect.right * scale)
      const bottom = Math.round(rect.bottom * scale)
      try {
        const thumb = await registerThumbnail(win.handle, { left, top, right, bottom })
        if (cancelled) {
          // The tile unmounted (hover moved on, popup closed) while the
          // registration round-trip was in flight — unregister immediately
          // rather than leaving an orphaned handle nothing else tracks.
          void unregisterThumbnail(win.handle)
          return
        }
        thumbIdRef.current = thumb
      } catch (err) {
        // Expected, not exceptional: the source window can close between
        // hover and this registration call, DWM composition can be off,
        // or access can be denied for an elevated/protected window. Falls
        // back to the icon+title placeholder below rather than treating
        // this as fatal.
        console.warn(`Could not register live thumbnail for "${win.title}":`, err)
        if (!cancelled) setThumbFailed(true)
      }
    }

    void register()

    return () => {
      cancelled = true
      if (thumbIdRef.current !== null) {
        void unregisterThumbnail(win.handle)
        thumbIdRef.current = null
      }
    }
    // Re-registers if the hovered window identity changes under the same
    // tile (shouldn't normally happen — `key={win.handle}` on the caller
    // already remounts per window — but handle.handle staying stable while
    // other fields change is exactly the case this guards).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.handle])

  // Keeps the live thumbnail's destination rect in sync with this tile's
  // OWN element whenever it actually moves/resizes — e.g. the popup
  // window's post-render re-measure (see TaskbarPopupWindow's
  // useLayoutEffect) can shift the whole card's position by a few pixels
  // once the true content height is known, which would otherwise leave an
  // already-registered thumbnail composited at its now-stale original
  // coordinates. `updateThumbnail` (not a full unregister+re-register) is
  // the cheaper, DWM-documented way to reposition a live registration.
  // ResizeObserver (not a resize listener on `window`) is what actually
  // catches this, since nothing here resizes the OS window itself — only
  // this tile's own layout position within it shifts.
  useEffect(() => {
    const el = thumbRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (thumbIdRef.current === null) return
      const rect = el.getBoundingClientRect()
      // Same logical-to-physical conversion as the initial registration
      // above — a resize/reposition observed here is still reported in
      // logical pixels.
      void getScaleFactorCached().then((scale) => {
        if (thumbIdRef.current === null) return
        void updateThumbnail(thumbIdRef.current, {
          left: Math.round(rect.left * scale),
          top: Math.round(rect.top * scale),
          right: Math.round(rect.right * scale),
          bottom: Math.round(rect.bottom * scale),
        }).catch((err) => {
          console.warn(`Could not reposition live thumbnail for "${win.title}":`, err)
        })
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [win.title])

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl transition-colors duration-150',
        isActive ? 'bg-white/8' : 'bg-white/3 hover:bg-white/5',
      )}
    >
      <button
        type="button"
        onClick={() => onEntryClick(win)}
        aria-label={`Switch to ${win.title}`}
        className="relative block w-full shrink-0 overflow-hidden bg-black/20"
        style={{ height: THUMB_HEIGHT, maxWidth: THUMB_WIDTH }}
      >
        {/* This div's own rect is what gets handed to DwmRegisterThumbnail
            as the destination rect (see the effect above) — the live
            thumbnail is composited by DWM directly into this window at
            these exact screen coordinates, NOT drawn as a child DOM node,
            so this element intentionally renders nothing itself when a
            thumbnail is live; it only exists to claim/measure the region
            DWM paints into. */}
        <div ref={thumbRef} className="h-full w-full" />
        {thumbFailed && (
          // Fallback when DWM couldn't register a thumbnail — the window's
          // own icon centered in the same footprint a thumbnail would have
          // occupied, so the row still reads as identifiable rather than a
          // blank/broken rect.
          <div className="absolute inset-0 flex items-center justify-center bg-white/4">
            {win.iconDataUrl ? (
              <img src={win.iconDataUrl} alt="" className="h-9 w-9 object-contain opacity-80" draggable={false} />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-md font-semibold text-white/70">
                {win.title.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        )}
        {win.isMinimized && !thumbFailed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <span className="text-text-tertiary text-2xs font-medium">Minimized</span>
          </div>
        )}
      </button>

      {/* Minimize/close float over the thumbnail's own top-right corner on
          hover, same affordance as a real Windows 11 preview, rather than
          a separate always-present strip below the thumbnail — with the
          title row gone, a mostly-empty action bar sitting there at rest
          was the remaining visual clutter this pass removes. */}
      <div className="pointer-events-none absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onMinimize(win.handle)
          }}
          aria-label={`Minimize ${win.title}`}
          className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md bg-black/50 text-white/80 backdrop-blur-sm transition-colors duration-150 hover:bg-black/70 hover:text-white"
        >
          <WindowMinimizeIcon width={10} height={10} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onCloseWindow(win.handle)
          }}
          aria-label={`Close ${win.title}`}
          className="hover:bg-danger flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-md bg-black/50 text-white/80 backdrop-blur-sm transition-colors duration-150 hover:text-white"
        >
          <WindowCloseIcon width={11} height={11} />
        </button>
      </div>
    </div>
  )
}

/**
 * Placeholder empty state — the real notification system (persisted
 * store + events pushed from across the app) is a separate, larger piece
 * of work; this establishes the panel's UI shell so the tray button has
 * something real to open now, ready to swap in live data once the
 * backend lands.
 */
function NotificationsPanelContent() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-(--border-hairline) px-3 py-2.5">
        <p className="text-text-primary min-w-0 flex-1 truncate text-xs font-semibold">Notifications</p>
      </div>
      <div className="flex flex-col items-center gap-2 px-6 py-7 text-center">
        <span className="bg-white/6 text-text-tertiary flex h-10 w-10 items-center justify-center rounded-full">
          <BellIcon width={18} height={18} />
        </span>
        <p className="text-text-secondary text-sm">No notifications</p>
        <p className="text-text-tertiary text-2xs leading-snug">You're all caught up.</p>
      </div>
    </div>
  )
}
