import { useEffect, useRef, useState } from 'react'
import { Reveal, Wrap, Eyebrow, H2, Lead } from '../ui.jsx'

/**
 * The Udaan advert. Plays by itself (silent) while it is on screen and pauses when it scrolls away.
 * "Play with sound" restarts it from the beginning with sound and shows the controls.
 */
export default function Advert() {
  const ref = useRef(null)
  const box = useRef(null)
  const [sound, setSound] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const v = ref.current
    if (!v || !box.current) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !reduce) v.play().catch(() => {})
        else v.pause()
      },
      { threshold: 0.45 },
    )
    io.observe(box.current)
    return () => io.disconnect()
  }, [])

  const withSound = () => {
    const v = ref.current
    if (!v) return
    v.muted = false
    v.loop = false
    v.currentTime = 0
    v.controls = true
    setSound(true)
    v.play().catch(() => {})
  }

  if (failed) return null
  return (
    <section id="advert" className="bg-white py-20 md:py-24">
      <Wrap className="text-center">
        <Reveal>
          <Eyebrow>Watch</Eyebrow>
          <H2 className="mt-3">See Udaan in a minute.</H2>
          <Lead className="mx-auto mt-4 max-w-lg">Your desktop, rebuilt around you. Sixty seconds, start to finish.</Lead>
        </Reveal>
        <Reveal delay={0.05} from="zoom" className="mx-auto mt-10 max-w-[960px]">
          <div ref={box} className="relative overflow-hidden rounded-[22px] bg-black shadow-[0_36px_70px_-30px_rgba(20,30,60,.55)] ring-1 ring-black/5">
            <video
              ref={ref}
              className="block aspect-video w-full"
              src="/video/udaan-advert.mp4"
              poster="/video/udaan-advert-poster.jpg"
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="The Udaan advert"
              onError={() => setFailed(true)}
            />
            {!sound && (
              <button
                type="button"
                onClick={withSound}
                className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-[13.5px] font-medium text-ink shadow-lg backdrop-blur transition hover:bg-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                Play with sound
              </button>
            )}
          </div>
        </Reveal>
      </Wrap>
    </section>
  )
}
