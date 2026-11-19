import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

/**
 * Realistic devices built from real 3D transforms. Anything passed as children is the screen.
 * Laptop: a true hinged lid (rotateX) over a flat deck, so it genuinely opens in 3D.
 */
export function Laptop({ children, w = 720, className = '', openAngle = 8, tilt = 22, delay = 0 }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-10%' })
  const H = w * 0.585       // lid height (screen close to 16:9)
  const D = w * 0.6         // deck depth
  const bz = w * 0.016      // bezel
  const key = w * 0.04
  const line = Math.max(2, w * 0.004)
  const containerH = H + D * Math.sin((tilt * Math.PI) / 180) + 30

  return (
    <div ref={ref} className={`relative ${className}`} style={{ width: w, height: containerH, perspective: w * 3.4 }}>
      {/* contact shadow */}
      <div className="absolute left-[6%] right-[6%] rounded-[50%] bg-black/30 blur-2xl" style={{ bottom: 0, height: w * 0.05 }} />
      <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: H, transformStyle: 'preserve-3d', transformOrigin: `50% ${H}px`, transform: `rotateX(${-tilt}deg)` }}>
        {/* deck (lies flat, extends toward the viewer from the hinge) */}
        <div style={{ position: 'absolute', left: 0, top: H, width: w, height: D, transformOrigin: 'top', transform: 'rotateX(90deg)', borderRadius: `0 0 ${w * 0.022}px ${w * 0.022}px`,
          background: 'linear-gradient(180deg,#e2e4e8 0%,#d0d3d8 60%,#c4c7cc 100%)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.7), inset 0 -2px 6px rgba(0,0,0,.12)' }}>
          <div style={{ position: 'absolute', left: '5%', right: '5%', top: '6%', height: '47%', borderRadius: w * 0.012, background: '#101216', boxShadow: 'inset 0 2px 8px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.6)' }}>
            <div style={{ position: 'absolute', inset: w * 0.008, borderRadius: w * 0.006, backgroundColor: '#272a31',
              backgroundImage: `linear-gradient(90deg,#0a0b0e ${line}px,transparent ${line}px),linear-gradient(0deg,#0a0b0e ${line}px,transparent ${line}px),linear-gradient(180deg,rgba(255,255,255,.07),transparent)`,
              backgroundSize: `${key}px ${key * 0.92}px,${key}px ${key * 0.92}px,100% 100%` }} />
          </div>
          <div style={{ position: 'absolute', left: '33%', width: '34%', bottom: '7%', height: '27%', borderRadius: w * 0.012, background: 'linear-gradient(180deg,#d6d9dd,#cbced3)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.1), inset 0 1px 0 rgba(255,255,255,.8)' }} />
        </div>
        {/* front lip gives the deck thickness */}
        <div style={{ position: 'absolute', left: 0, top: H, width: w, height: w * 0.012, transform: `translateZ(${D}px)`, background: 'linear-gradient(180deg,#b9bcc1,#9fa3a9)', borderRadius: `0 0 ${w * 0.03}px ${w * 0.03}px` }} />

        {/* lid: hinged at its bottom edge, closed = -90deg */}
        <motion.div style={{ position: 'absolute', left: 0, top: 0, width: w, height: H, transformOrigin: 'bottom', transformStyle: 'preserve-3d' }}
          initial={{ rotateX: -90 }} animate={{ rotateX: inView ? openAngle : -90 }} transition={{ duration: 2.1, delay, ease: [0.22, 1, 0.36, 1] }}>
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', borderRadius: w * 0.026, background: '#08090b', boxShadow: '0 0 0 1.5px #b9bcc2, 0 0 120px rgba(70,130,255,.28)' }}>
            <div style={{ position: 'absolute', inset: bz, borderRadius: w * 0.008, overflow: 'hidden', background: '#000' }}>{children}</div>
            <i style={{ position: 'absolute', top: bz * 0.4, left: '50%', width: 5, height: 5, marginLeft: -2.5, borderRadius: 5, background: '#1c2230', boxShadow: '0 0 0 1px #2a3040' }} />
            <div className="pointer-events-none absolute inset-0" style={{ borderRadius: w * 0.026, background: 'linear-gradient(115deg,rgba(255,255,255,.2) 0%,rgba(255,255,255,0) 32%)' }} />
          </div>
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', borderRadius: w * 0.026, background: 'linear-gradient(145deg,#eceef1,#c6cacf 60%,#b8bcc2)', display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.7)' }}>
            <img src="/logo/udaan-black.png" alt="" style={{ width: w * 0.1, opacity: 0.32 }} />
          </div>
        </motion.div>
      </div>
    </div>
  )
}

/** A thin-bezel display on an aluminium stand. Width follows the parent (fluid); the screen is 16:9. */
export function Monitor({ children, className = '' }) {
  return (
    <div className={`relative w-full ${className}`}>
      {/* panel: aluminium edge, black glass bezel, screen */}
      <div className="relative rounded-[18px] p-[5px]" style={{ background: 'linear-gradient(180deg,#e9eaed,#c6c9ce)', boxShadow: '0 1px 0 rgba(255,255,255,.9) inset, 0 40px 70px -30px rgba(20,30,60,.35), 0 12px 24px -12px rgba(20,30,60,.25)' }}>
        <div className="rounded-[14px] bg-[#0b0b0d] p-[1.1%]">
          <div className="relative aspect-video overflow-hidden rounded-[6px] bg-black">{children}</div>
        </div>
        <div className="pointer-events-none absolute inset-[5px] rounded-[14px]" style={{ background: 'linear-gradient(115deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,0) 28%)' }} />
      </div>
      {/* stand */}
      <div className="mx-auto h-[clamp(36px,6vw,64px)] w-[17%]" style={{ background: 'linear-gradient(90deg,#b9bcc2,#eceef0 45%,#c4c7cc 70%,#aeb2b8)', clipPath: 'polygon(8% 0,92% 0,100% 100%,0 100%)' }} />
      <div className="mx-auto h-[7px] w-[30%] rounded-b-[6px] rounded-t-[2px]" style={{ background: 'linear-gradient(180deg,#e2e4e7,#b4b8be)', boxShadow: '0 10px 18px -6px rgba(20,30,60,.35)' }} />
    </div>
  )
}
