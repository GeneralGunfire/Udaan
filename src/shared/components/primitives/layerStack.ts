/**
 * Module-level stack of currently-open dismissable layers (dialogs,
 * popovers, dropdown menus, submenus — anything using useDismissableLayer).
 * Solves one specific bug class: without it, pressing Escape with a
 * submenu open inside a dropdown open inside a dialog closes all three at
 * once, because three independent `keydown` listeners all fire on the
 * same event. With a stack, only the layer on top — the innermost, most
 * recently opened one — responds; Escape then closes one layer at a time,
 * which is what every desktop app actually does.
 *
 * Deliberately a plain module-level array, not React state: layer
 * registration needs to happen in an effect's mount/unmount, ordering only
 * matters at the instant a key is pressed, and no component ever needs to
 * re-render because the stack changed shape.
 */

type LayerId = symbol

const stack: LayerId[] = []

export function createLayerId(): LayerId {
  return Symbol('layer')
}

/** Call on mount (open). Returns the unregister function to call on
 *  unmount (close) — pair these the same way an effect pairs setup/teardown. */
export function registerLayer(id: LayerId): () => void {
  stack.push(id)
  return () => {
    const index = stack.indexOf(id)
    if (index !== -1) stack.splice(index, 1)
  }
}

/** True only for the layer currently on top of the stack — i.e. the one
 *  that should actually respond to a global Escape/outside-click, even
 *  though every open layer's listener fires on the same event. */
export function isTopLayer(id: LayerId): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id
}
