import udaanMark from '@/assets/udaan-mark.png'

interface WordmarkProps {
  showLabel?: boolean
  size?: 'sm' | 'md'
}

const SIZES = {
  sm: { mark: 'h-7 w-7', text: 'text-[14.5px]' },
  md: { mark: 'h-9 w-9', text: 'text-[16.5px]' },
}

/**
 * Brand mark. Solid filled gradient mark — reads clearly even at small
 * sizes, unlike the earlier thin-stroke glow version.
 */
export function Wordmark({ showLabel = true, size = 'md' }: WordmarkProps) {
  const { mark, text } = SIZES[size]
  return (
    <div className="flex items-center gap-2">
      <img
        src={udaanMark}
        alt="Udaan"
        className={`${mark} shrink-0 object-contain`}
      />
      {showLabel && (
        <span
          className={`font-display text-text-primary ${text} font-semibold tracking-tight`}
        >
          Udaan
        </span>
      )}
    </div>
  )
}
