/**
 * Event contract between the shell surfaces (menu bar, dock, Start, desktop) that open a popup and the one popup
 * window that shows it. Coordinates are in logical SCREEN pixels. For the panels, (x, y) is the anchor: x is the
 * centre of the button that opened it and y is the edge it hangs from. For `'point'` placement (context menus) it
 * is the exact top-left corner the menu opens from, like a native right-click menu. The popup window scales
 * everything to physical pixels itself and keeps the card on the screen.
 *
 * `placement` says where the card sits: below the menu bar, above the dock, as a full-height sheet on the right
 * (Notification Center), or exactly at a point (context menus; `point-up` opens upward from the point).
 */
export type FlyoutPlacement = 'above' | 'below' | 'sheet-right' | 'point' | 'point-up'

/** The menu bar's own button-triggered panels. */
export type PanelKind = 'notifications-panel' | 'calendar' | 'layouts' | 'network' | 'sound' | 'media'

export type FlyoutKind = PanelKind | 'context-menu'

/**
 * One entry in a `'context-menu'` popup. Plain data only (the payload crosses a window boundary), so an item
 * carries an `id` and the opener maps it back to its own callback. A nested `items` list is a sub-menu.
 */
export interface FlyoutMenuItem {
  /** Omit (and leave `header` unset) for a separator. */
  label?: string
  /** A small section title instead of a clickable item. */
  header?: boolean
  danger?: boolean
  disabled?: boolean
  /** A pop-kit icon name (see os/ui/pop/icons). */
  icon?: string
  shortcut?: string
  checked?: boolean
  items?: FlyoutMenuItem[]
  id?: string
}

export interface ShowFlyoutPayload {
  kind: FlyoutKind
  x: number
  y: number
  placement?: FlyoutPlacement
  /** Only for `'context-menu'`. */
  items?: FlyoutMenuItem[]
}

export type ShowTaskbarPopupPayload = ShowFlyoutPayload
