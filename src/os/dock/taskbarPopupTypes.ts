/**
 * Event contract between the shell surfaces (menu bar, dock) that open a
 * panel and the flyout window that shows it. Coordinates are the anchor's
 * centre (x) and edge (y) in logical screen pixels, EXCEPT for `'point'`
 * placement (context menus), where (x, y) is the exact top-left corner the
 * menu opens from, matching how a native right-click menu anchors — not
 * centred over the click like the other panels are over their trigger.
 * The flyout scales coordinates to physical itself. `placement` says where
 * the panel sits: below the menu bar, above the dock, as a full-height
 * sheet on the right (Notification Center), or exactly at a point
 * (context menus).
 */
export type FlyoutPlacement = 'above' | 'below' | 'sheet-right' | 'point'

/** The menu bar's own button-triggered panels — excludes 'context-menu',
 * which is opened ad hoc (dock icons, widgets) rather than from a
 * persistent menu-bar button with its own ref. */
export type PanelKind = 'notifications-panel' | 'calendar' | 'layouts' | 'network' | 'sound' | 'media'

export type FlyoutKind = PanelKind | 'context-menu' | 'tip'

/** One item in a `'context-menu'` flyout — mirrors ShellMenuItemDef but
 * kept dependency-free here since this file is the cross-window event
 * contract (no icon components; a `danger` flag is enough signal). */
export interface FlyoutMenuItem {
  label?: string
  danger?: boolean
  disabled?: boolean
  /** Index into the menu opener's own handler table — the event payload
   * crosses a Tauri IPC boundary, so it carries data, not closures; the
   * opener resolves this id back to the real onSelect callback. */
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
