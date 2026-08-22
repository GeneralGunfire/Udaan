import { Composer } from './components/Composer'

/**
 * Home view — General Chat. A real chat layout: the message list is the
 * only scrolling region and the composer is pinned to the bottom once a
 * conversation exists. `App.tsx`'s `<main>` centers/scrolls by default for
 * other views, so this opts out with `h-full` + `overflow-hidden` and lets
 * `Composer` own its own internal scroll area — including the empty
 * state, since only `Composer` knows whether there are messages yet.
 *
 * No page-wide scrim here — tried a bottom-weighted gradient overlay
 * confined to this view's own `max-w-3xl` column, but it showed as a
 * visible hard-edged rectangle against the full-bleed wallpaper (the
 * scrim's own edges, not covering the whole panel). Reverted; per-surface
 * contrast (composer/bubbles each carry their own near-opaque fill +
 * blur, see Composer.tsx/ChatMessage.tsx) already solves legibility
 * without needing a shared background trick that would have to live at
 * the `App.tsx` panel level (out of this view's scope) to avoid that
 * seam.
 */
export function GeneralChatView() {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden px-6 py-8">
      <Composer />
    </div>
  )
}
