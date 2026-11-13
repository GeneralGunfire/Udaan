import { forwardRef } from 'react'
import { cn } from '@/shared/lib/cn'

/**
 * Text input and textarea, shared.
 *
 * These did not exist. Twenty-nine raw `<input>`/`<textarea>` elements
 * were styled inline across the app, each with slightly different
 * padding, radius, border colour and focus treatment — which is most of
 * why text fields looked inconsistent from page to page. Everything here
 * routes through the same tokens as `Button` and `Select`, so a field in
 * Notes and a field in File Explorer are now the same control.
 *
 * The visual language matches the rest of the app after the screensaver
 * pass: no fill at rest, a hairline that only becomes visible on hover,
 * and focus shown by the border brightening rather than by an outline
 * ring stacked outside the box. A ring around a text field competes with
 * the caret for "where am I typing" and doubles the apparent border
 * weight of every focused field on the page.
 */

const fieldBase = [
  'w-full rounded-lg border bg-transparent',
  'text-text-primary placeholder:text-text-tertiary',
  'transition-[border-color,background-color] duration-150 ease-out',
  // Rest: the border is barely there. Hover: it firms up, because at that
  // point the pointer is on it and it should read as a target.
  'border-(--border-hairline) hover:border-white/18',
  // Focus: border brightens and a very faint wash appears behind the
  // text, so the active field is obvious in a form of several without an
  // outline ring boxing it in.
  'focus:border-white/30 focus:bg-white/[0.04] focus:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-40',
  // Invalid state uses the danger token rather than a browser default,
  // which is otherwise a bright red the app's palette never uses.
  'aria-[invalid=true]:border-danger/60',
].join(' ')

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** `sm` for dense rows (a rename field inline in a list), `md` for
   * standalone form fields. */
  inputSize?: 'sm' | 'md'
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, inputSize = 'md', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        fieldBase,
        inputSize === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-3 py-2 text-sm',
        className,
      )}
      {...props}
    />
  )
})

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with content up to this many pixels, then scrolls. Omit for a
   * fixed-height field sized by `rows`. */
  maxHeight?: number
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, maxHeight, style, onChange, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      onChange={(e) => {
        if (maxHeight !== undefined) {
          // Auto-grow. Height is reset to `auto` first because
          // `scrollHeight` on an element with an explicit height only ever
          // reports that height or more — without the reset, the field
          // grows but can never shrink back when text is deleted.
          const el = e.currentTarget
          el.style.height = 'auto'
          el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
        }
        onChange?.(e)
      }}
      style={maxHeight !== undefined ? { maxHeight, ...style } : style}
      className={cn(fieldBase, 'resize-none px-3 py-2 text-sm leading-relaxed', className)}
      {...props}
    />
  )
})

/**
 * Label for a form field. Small and quiet — it names the field, it is not
 * competing with the value the user typed into it.
 */
export function FieldLabel({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-text-tertiary text-2xs font-medium tracking-wide uppercase', className)}
      {...props}
    />
  )
}
