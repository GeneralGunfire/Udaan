import { motion, animate, useInView, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

export const ease = [0.22, 1, 0.36, 1]
export const shot = (n) => `/shots/polished/screens/${n}.jpg`
export const win = (n) => `/shots/polished/windows/${n}.png`
export const pop = (n) => `/shots/polished/popups/${n}.png`

export const Wrap = ({ children, className = '' }) => <div className={`mx-auto max-w-[1200px] px-6 md:px-10 ${className}`}>{children}</div>

/* The entrances. Each is a small starting offset; the resting state is in REST. Clips are padded 80px outward so shadows are never cut. */
const CLIP = 'inset(-80px -80px -80px -80px)'
const FROM = {
  up: { y: 14 },
  down: { y: -14 },
  rise: { y: 38 },
  left: { x: -28 },
  right: { x: 28 },
  scale: { scale: 0.965 },
  zoom: { scale: 1.05 },
  blur: { filter: 'blur(8px)', y: 8 },
  clip: { clipPath: 'inset(16% -80px -80px -80px)', y: 10 },
  wipe: { clipPath: 'inset(-80px 50% -80px 50%)' },
}
const REST = { x: 0, y: 0, scale: 1, filter: 'blur(0px)', clipPath: CLIP }
const restOf = (from) => Object.fromEntries(Object.keys(FROM[from]).map((k) => [k, REST[k]]))

/** A single entrance, once, when the block scrolls into view. `from` picks the style; with reduced motion it simply appears. */
export function Reveal({ children, delay = 0, from = 'up', className = '' }) {
  const reduce = useReducedMotion()
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, ...FROM[from] }} whileInView={{ opacity: 1, ...restOf(from) }} viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: from === 'blur' ? 0.8 : 0.7, delay, ease }}>{children}</motion.div>
  )
}

/** A group whose `Item` children arrive one after another. `now` plays on load instead of on scroll. */
export function Stagger({ children, className = '', gap = 0.07, delay = 0, now = false, as = 'div' }) {
  const Tag = motion[as]
  const reduce = useReducedMotion()
  const variants = { hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }
  const trigger = now ? { animate: 'show' } : { whileInView: 'show', viewport: { once: true, margin: '-60px' } }
  return <Tag className={className} variants={variants} initial={reduce ? 'show' : 'hidden'} {...trigger}>{children}</Tag>
}

export function Item({ children, className = '', from = 'up', as = 'div', ...rest }) {
  const Tag = motion[as]
  const variants = { hidden: { opacity: 0, ...FROM[from] }, show: { opacity: 1, ...restOf(from), transition: { duration: 0.6, ease } } }
  return <Tag className={className} variants={variants} {...rest}>{children}</Tag>
}

/** Moves its content a few pixels against the scroll, so big pictures feel set back from the page. Off for reduced motion. */
export function Parallax({ children, amount = 16, className = '' }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [amount, -amount])
  return <motion.div ref={ref} style={reduce ? undefined : { y }} className={className}>{children}</motion.div>
}

/** Counts a number from one value to another the first time it scrolls into view. */
export function CountUp({ from, to, decimals = 0, suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const reduce = useReducedMotion()
  const [v, setV] = useState(reduce ? to : from)
  useEffect(() => {
    if (!inView) return
    if (reduce) { setV(to); return }
    const c = animate(from, to, { duration: 1.5, ease, onUpdate: setV })
    return () => c.stop()
  }, [inView])
  return <span ref={ref}>{v.toFixed(decimals)}{suffix}</span>
}

export const Eyebrow = ({ children }) => <p className="text-[13px] font-semibold text-brand">{children}</p>
export const H2 = ({ children, className = '' }) => <h2 className={`text-[clamp(28px,3.2vw,42px)] font-semibold leading-[1.06] tracking-[-0.03em] ${className}`}>{children}</h2>
export const Lead = ({ children, className = '' }) => <p className={`text-[17px] leading-relaxed text-ink/60 ${className}`}>{children}</p>
