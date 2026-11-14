import { motion } from 'framer-motion'
import { cn } from '@/shared/lib/cn'
import { CheckIcon } from '@/shared/icons'
import { GENERATED_WALLPAPERS } from '@/os/desktop/generatedWallpapers'
import { LIVE_WALLPAPERS } from '@/os/desktop/liveWallpapers'
import { GeneratedThumb } from '@/os/ui/WallpaperThumb'
import { badgePop, springs, staggerDelay } from '@/os/motion/systemMotion'
import { prefersReducedMotion } from '@/shared/lib/motion'

/**
 * The wallpaper gallery, shared by the Wallpaper sheet and Settings.
 *
 * Both pickers used to list only the static generated set, each with its own
 * copy of the same grid. The live wallpapers were added to the engine but
 * never to either list, so there was no way to choose one — they simply did
 * not exist as far as the person using the OS was concerned. One component,
 * fed by both libraries, means a wallpaper added to either shows up
 * everywhere.
 *
 * Live wallpapers are shown by their static fallback frame, marked LIVE.
 * Animating every tile would hold a WebGL context and a render loop per tile
 * to preview a feature the person has not chosen yet.
 */

interface Item {
  id: string
  label: string
  live: boolean
}

const LIVE: Item[] = LIVE_WALLPAPERS.map((w) => ({ id: w.id, label: w.label, live: true }))
const STILL: Item[] = GENERATED_WALLPAPERS.map((w) => ({ id: w.id, label: w.label, live: false }))

function Tile({
  item,
  selected,
  onSelect,
  index,
  width,
}: {
  item: Item
  selected: boolean
  onSelect: () => void
  index: number
  width?: number
}) {
  const reduced = prefersReducedMotion()
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      title={item.live ? `${item.label} — animated` : item.label}
      onClick={onSelect}
      initial={reduced ? false : { opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...springs.gentle, delay: staggerDelay(index, 0.03, 8) }}
      whileHover={reduced ? undefined : { y: -2 }}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-[12px] outline-none',
        'ring-1 ring-(--os-border) transition-shadow duration-150 hover:shadow-(--os-shadow-md)',
        'focus-visible:ring-2 focus-visible:ring-accent',
        selected && 'ring-[3px] ring-accent',
      )}
      style={{ width: width ?? '100%', aspectRatio: '16 / 10' }}
    >
      <GeneratedThumb id={item.id} width={240} height={150} />
      {/* Name over a scrim, so it reads on a light wallpaper as well as a dark one. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-1.5 pt-6 text-left text-[12px] font-medium text-white">
        {item.label}
      </span>
      {item.live && (
        <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-[2px] text-[9.5px] font-semibold uppercase tracking-wide text-white">
          <span className="h-[5px] w-[5px] rounded-full bg-[#ff453a]" aria-hidden />
          Live
        </span>
      )}
      {selected && (
        <motion.span
          {...(reduced ? {} : badgePop)}
          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-(--color-accent-contrast) shadow-(--os-shadow-sm)"
        >
          <CheckIcon className="h-3 w-3" />
        </motion.span>
      )}
    </motion.button>
  )
}

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h3 className="text-[13px] font-semibold text-(--os-text)">{title}</h3>
      <span className="text-[11.5px] text-(--os-text-dim)">{hint}</span>
    </div>
  )
}

export function WallpaperGallery({
  value,
  onChange,
  columns = 4,
}: {
  value: string
  onChange: (id: string) => void
  columns?: number
}) {
  const grid = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
  return (
    <div className="flex flex-col gap-5">
      <section>
        <Heading title="Live" hint="Animated · follows your pointer and the time of day" />
        <div className="grid gap-2.5" style={grid}>
          {LIVE.map((item, i) => (
            <Tile key={item.id} item={item} index={i} selected={value === item.id} onSelect={() => onChange(item.id)} />
          ))}
        </div>
      </section>
      <section>
        <Heading title="Still" hint="Painted once at your screen's resolution" />
        <div className="grid gap-2.5" style={grid}>
          {STILL.map((item, i) => (
            <Tile key={item.id} item={item} index={i + LIVE.length} selected={value === item.id} onSelect={() => onChange(item.id)} />
          ))}
        </div>
      </section>
    </div>
  )
}
