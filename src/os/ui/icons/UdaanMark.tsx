/**
 * Udaan's mark: the single-colour wing ("udaan" means flight).
 *
 * It is drawn as a mask filled with `currentColor`, so it is white on a dark surface and black on a light
 * one with no second asset: it follows whatever text colour it sits in. Use `className` or a wrapping
 * element's `color` to set it.
 */
export function UdaanMark({
  size,
  className,
}: {
  size: number
  className?: string
  /** Kept for existing callers: there is now one black-and-white mark. */
  tone?: 'mono' | 'brand'
}) {
  const mask = 'url(/logo/udaan-mark.png)'
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        flexShrink: 0,
        backgroundColor: 'currentColor',
        WebkitMaskImage: mask,
        maskImage: mask,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  )
}
