import { Composer } from './components/Composer'

/**
 * Home view — General Chat. A real chat layout: the message list is the
 * only scrolling region and the composer is pinned to the bottom once a
 * conversation exists. `App.tsx`'s `<main>` centers/scrolls by default for
 * other views, so this opts out with `h-full` + `overflow-hidden` and lets
 * `Composer` own its own internal scroll area — including the empty
 * state, since only `Composer` knows whether there are messages yet.
 *
 * Width: this wrapper only bounds the column at the largest sizes
 * (ultrawide guard); `Composer` itself now owns the actual responsive
 * max-width so the logo/suggestions/composer share one axis instead of
 * two independently-capped containers (this file was `max-w-3xl`,
 * `Composer` was `max-w-2xl` — the mismatch read as misaligned edges).
 *
 * The localized readability treatment lives in `Composer.tsx` itself
 * (scoped to just the content block, not this full-height panel) — a
 * bottom-weighted gradient confined to *this* wrapper was tried and
 * reverted in an earlier pass because it showed as a visible hard-edged
 * rectangle against the full-bleed wallpaper when the wrapper's own
 * height (full panel, via `justify-center` centering) didn't match the
 * actual content height.
 */
export function GeneralChatView() {
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden px-6 py-8">
      <Composer />
    </div>
  )
}
